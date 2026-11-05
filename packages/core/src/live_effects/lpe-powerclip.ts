// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-powerclip.cpp, src/live_effects/lpe-powerclip.h
/*
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { Affine, type Curve, Path, type PathVector, Translate } from '@inkscape-web/geom';
import { _ } from '../i18n.ts';
import type { ObjectSet } from '../object/object-set.ts';
import { SPGroup } from '../object/sp-item-group.ts';
import { SPLPEItem } from '../object/sp-lpe-item.ts';
import { SP_OBJECT_WRITE_EXT, SP_OBJECT_WRITE_NO_CHILDREN } from '../object/sp-object.ts';
import { SPShape } from '../object/sp-shape.ts';
import { SPUse } from '../object/sp-use.ts';
import { BooleanOp, FillRule, sp_pathvector_boolop } from '../path/path-boolop.ts';
import { Preferences } from '../preferences.ts';
import { SPCSSDisplay } from '../style-enums.ts';
import { sp_svg_write_path } from '../svg/svg-path.ts';
import { Effect } from './effect.ts';
import { EffectType } from './effect-enum.ts';
import type { LivePathEffectObject } from './lpeobject.ts';
import { BoolParam } from './parameter/bool.ts';
import { MessageParam } from './parameter/message.ts';

/** Signed area (2geom convention, as Geom::centroid) of the path closed by a straight line. */
function signed_area(path: Path): number {
  const pts = [path.initialPoint()];
  for (const c of path.curves() as readonly Curve[]) {
    const n = c.isLineSegment() ? 1 : 64;
    for (let i = 1; i <= n; i++) pts.push(c.pointAt(i / n));
  }
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i] as (typeof pts)[number];
    const q = pts[(i + 1) % pts.length] as (typeof pts)[number];
    a += p.y * q.x - p.x * q.y;
  }
  return a / 2;
}

/** Geom::path_direction(): true for fill, false for hole (the sign of the area). */
function path_direction(p: Path): boolean {
  if (p.empty()) return false;
  return signed_area(p) > 0;
}

function sp_bbox_without_clip(lpeitem: SPLPEItem): Path {
  const bbox = lpeitem.visualBounds(Affine.identity(), true, false, true);
  return bbox ? Path.fromRect(bbox.expandBy(5)) : new Path();
}

function sp_get_recursive_pathvector(
  item: SPLPEItem,
  res: PathVector,
  dir: boolean,
  inverse: boolean,
): PathVector {
  if (item instanceof SPGroup) {
    for (const child of item.item_list()) {
      if (child instanceof SPLPEItem) res = sp_get_recursive_pathvector(child, res, dir, inverse);
    }
  }
  if (item instanceof SPShape) {
    const curve = item.curve();
    if (curve) {
      for (let path of curve) {
        if (!path.empty()) {
          const pathdir = path_direction(path);
          if (pathdir === dir && inverse) path = path.reversed();
          res.push(path.transformed(item.i2dtAffine()));
        }
      }
    }
  }
  return res;
}

/** Power clip (upstream LPEPowerClip): inverse, hide or flatten the clip of the item. */
export class LPEPowerClip extends Effect {
  readonly inverse: BoolParam;
  readonly flatten: BoolParam;
  readonly hide_clip: BoolParam;
  readonly message: MessageParam;
  #updating = false;
  #legacy = false;

  constructor(lpeobject: LivePathEffectObject) {
    super(lpeobject);
    this.hide_clip = new BoolParam(_('Hide clip'), _('Hide clip'), 'hide_clip', this, false);
    this.inverse = new BoolParam(_('Inverse clip'), _('Inverse clip'), 'inverse', this, true);
    this.flatten = new BoolParam(
      _('Flatten clip'),
      _('Flatten clip, see fill rule once convert to paths'),
      'flatten',
      this,
      false,
    );
    this.message = new MessageParam(
      _('Info Box'),
      _('Important messages'),
      'message',
      this,
      _(
        'Use fill-rule evenodd on <b>fill and stroke</b> dialog if no flatten result after convert clip to paths.',
      ),
    );
    this.registerParameter(this.inverse);
    this.registerParameter(this.flatten);
    this.registerParameter(this.hide_clip);
    this.registerParameter(this.message);
    this.message.write_to_SVG(); // resert old legacy uneeded data
    // legazy fix between 0.92.4 launch and 1.0beta1
    const repr = this.getRepr();
    if (repr?.attribute('is_inverse')) {
      repr.removeAttribute('is_inverse');
      this.#legacy = true;
    }
  }

  getClipPathvector(): PathVector {
    const res: PathVector = [];
    let res_hlp: PathVector = [];
    const lpeitem = this.sp_lpe_item;
    if (!lpeitem) return res;
    const clip_path = lpeitem.getClipObject();
    if (clip_path) {
      const clip_path_list = clip_path.childList();
      clip_path_list.pop();
      if (clip_path_list.length) {
        for (const clip of clip_path_list) {
          if (!(clip instanceof SPLPEItem)) continue;
          res_hlp = sp_get_recursive_pathvector(clip, res_hlp, false, this.inverse.get_value());
          if (this.is_load && this.#legacy) clip.doWriteTransform(Translate(0, -999999));
          const display = clip.style?.display;
          if (!display?.set || display.value !== SPCSSDisplay.SP_CSS_DISPLAY_NONE) {
            clip.setAttribute('display', 'none');
            clip.updateRepr(SP_OBJECT_WRITE_NO_CHILDREN | SP_OBJECT_WRITE_EXT);
          }
        }
        if (this.is_load && this.#legacy) {
          const t = Translate(0, -999999);
          res_hlp = res_hlp.map((p) => p.transformed(t));
          this.#legacy = false;
        }
      }
    }
    const bbox = sp_bbox_without_clip(lpeitem);
    if (this.hide_clip.get_value()) return [bbox];
    if (this.inverse.get_value() && this.isVisible()) res.push(bbox);
    res.push(...res_hlp);
    return res;
  }

  add(): void {
    const document = this.getSPDoc();
    const lpeitem = this.sp_lpe_item;
    if (!document || !lpeitem) return;
    let clip_path = lpeitem.getClipObject();
    if (!clip_path) {
      lpeitem.removeCurrentPathEffect(false);
      return;
    }
    const xml_doc = document.getReprDoc();
    let parent = clip_path.getRepr();
    const childitems = clip_path.childList();
    const last = childitems[childitems.length - 1];
    const childitem = last instanceof SPLPEItem ? last : null;
    if (childitem && childitem.getRepr().attribute('class') === 'powerclip') {
      const newclip = `clipath_${this.getId()}`;
      const uri = `url(#${newclip})`;
      parent = clip_path.getRepr().duplicate(xml_doc);
      parent.setAttribute('id', newclip);
      const added = document.getDefs()?.appendChildRepr(parent) ?? null;
      lpeitem.setAttribute('clip-path', uri);
      if (added) {
        clip_path = added as typeof clip_path;
        const childitems2 = added.childList();
        const childitemdel = childitems2[childitems2.length - 1];
        if (childitemdel instanceof SPLPEItem) {
          childitemdel.setAttribute('id', this.getId());
          return;
        }
      }
    }
    const clip_path_node = xml_doc.createElement('svg:path');
    parent.appendChild(clip_path_node);
    const elemref = document.getObjectByRepr(clip_path_node);
    if (elemref) {
      elemref.setAttribute('style', childitem ? childitem.getAttribute('style') : 'fill-rule:evenodd');
      elemref.setAttribute('class', 'powerclip');
      elemref.setAttribute('id', this.getId());
      elemref.setAttribute('d', sp_svg_write_path(this.getClipPathvector()));
    } else {
      lpeitem.removeCurrentPathEffect(false);
    }
  }

  getId(): string {
    return `lpe_${this.getLPEObj().getId()}`;
  }

  upd(): void {
    const document = this.getSPDoc();
    if (!document || !this.sp_lpe_item) return;
    const elemref = document.getObjectById(this.getId());
    if (elemref) {
      elemref.setAttribute('d', sp_svg_write_path(this.getClipPathvector()));
      elemref.updateRepr(SP_OBJECT_WRITE_NO_CHILDREN | SP_OBJECT_WRITE_EXT);
    } else {
      this.add();
    }
  }

  protected override doBeforeEffect(_lpeitem: SPLPEItem): void {
    if (!this.#updating) this.upd();
  }

  protected override doOnRemove(_lpeitem: SPLPEItem | null): void {
    const document = this.getSPDoc();
    if (!document) return;
    const prefs = Preferences.get();
    if (this.keep_paths || prefs.getBool('/options/onungroup', false)) {
      const first = this.sp_lpe_item?.getClipObject()?.childList()[0];
      if (first instanceof SPLPEItem) first.deleteObject();
      return;
    }
    this.#updating = true;
    document.getObjectById(this.getId())?.deleteObject();
    const clip_path = this.sp_lpe_item?.getClipObject();
    if (clip_path) {
      for (const clip of clip_path.childList()) {
        if (!(clip instanceof SPLPEItem)) continue;
        const display = clip.style?.display;
        if (!display || display.set || display.value === SPCSSDisplay.SP_CSS_DISPLAY_NONE) {
          clip.setAttribute('display', 'block');
          clip.updateRepr(SP_OBJECT_WRITE_NO_CHILDREN | SP_OBJECT_WRITE_EXT);
        }
      }
    }
  }

  protected override doEffect_path(path_in: PathVector): PathVector {
    let path_out = path_in;
    if (this.flatten.get_value()) {
      const c_pv = this.getClipPathvector();
      // (upstream Geom::PathIntersectionGraph, which is even-odd)
      if (c_pv.length && path_out.length) {
        path_out = sp_pathvector_boolop(
          c_pv,
          path_out,
          BooleanOp.bool_op_inters,
          FillRule.fill_oddEven,
          FillRule.fill_oddEven,
        );
      }
    }
    return path_out;
  }

  override doOnVisibilityToggled(_lpeitem: SPLPEItem): void {
    this.upd();
  }
}

/** Remove the Power clip effect from the selected items (Object > Clip > Release). */
export function sp_remove_powerclip(sel: ObjectSet): void {
  if (sel.isEmpty()) return;
  for (const lpeitem of [...sel.items()].reverse()) {
    if (!(lpeitem instanceof SPLPEItem) || !(lpeitem.hasPathEffect() && lpeitem.pathEffectsEnabled()))
      continue;
    for (const lperef of [...lpeitem.path_effect_list]) {
      const lpeobj = lperef.lpeobject;
      if (!lpeobj) {
        console.warn('SPLPEItem::performPathEffect - NULL lpeobj in list!');
        return;
      }
      if (lpeobj.effecttype === EffectType.POWERCLIP) {
        lpeitem.setCurrentPathEffect(lperef);
        lpeitem.removeCurrentPathEffect(false);
        break;
      }
    }
  }
}

/** Apply the Power clip effect with inverse to the selected items that have a clip (Object > Clip > Set Inverse). */
export function sp_inverse_powerclip(sel: ObjectSet): void {
  const document = sel.document();
  if (sel.isEmpty() || !document) return;
  for (const lpeitem of [...sel.items()].reverse()) {
    if (!(lpeitem instanceof SPLPEItem)) continue;
    const clip_path = lpeitem.getClipObject();
    if (!clip_path) continue;
    if (clip_path.childList().some((iter) => iter instanceof SPUse)) {
      console.warn('We can`t add inverse clip on clones');
      return;
    }
    Effect.createAndApply(EffectType.POWERCLIP, document, lpeitem);
    lpeitem.getCurrentLPE()?.getRepr()?.setAttribute('inverse', 'true');
  }
}
