// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-clone-original.cpp, src/live_effects/lpe-clone-original.h
/*
 * Copyright (C) Johan Engelen 2012 <j.b.c.engelen@alumnus.utwente.nl>
 */
import type { PathVector } from '@inkscape-web/geom';
import { _, N_ } from '../i18n.ts';
import { SPItem } from '../object/sp-item.ts';
import { SPGroup } from '../object/sp-item-group.ts';
import { type SPLPEItem, sp_lpe_item_update_patheffect } from '../object/sp-lpe-item.ts';
import { SP_OBJECT_MODIFIED_FLAG, type SPObject } from '../object/sp-object.ts';
import { SPPath } from '../object/sp-path.ts';
import { SPShape } from '../object/sp-shape.ts';
import { sp_svg_write_path } from '../svg/svg-path.ts';
import { EnumDataConverter } from '../util/enums.ts';
import {
  spReprCssAttrAddFromString,
  spReprCssAttrNew,
  spReprCssProperty,
  spReprCssSetProperty,
  spReprCssWriteString,
} from '../xml/repr-css.ts';
import { LPEBSpline, sp_bspline_do_effect } from './lpe-bspline.ts';
import { LPESpiro, sp_spiro_do_effect } from './lpe-spiro.ts';
import { GroupBBoxEffect } from './lpegroupbbox.ts';
import type { LivePathEffectObject } from './lpeobject.ts';
import { BoolParam } from './parameter/bool.ts';
import { EnumParam } from './parameter/enum.ts';
import type { Parameter, ParamWidget } from './parameter/parameter.ts';
import { OriginalSatelliteParam } from './parameter/satellite.ts';
import { TextParam } from './parameter/text.ts';

export enum Clonelpemethod {
  CLM_NONE,
  CLM_D,
  CLM_ORIGINALD,
  CLM_BSPLINESPIRO,
  CLM_END,
}

const CLMConverter = new EnumDataConverter<Clonelpemethod>(
  [
    { id: Clonelpemethod.CLM_NONE, label: N_('Transformation Only'), key: 'none' },
    { id: Clonelpemethod.CLM_D, label: N_('Original Shape + LPEs'), key: 'd' },
    { id: Clonelpemethod.CLM_ORIGINALD, label: N_('Original Shape Only'), key: 'originald' },
    { id: Clonelpemethod.CLM_BSPLINESPIRO, label: N_('Spiro or BSpline Only'), key: 'bsplinespiro' },
  ],
  Clonelpemethod.CLM_END,
);

/** The comma-separated names of a list, trimmed, without empty ones (upstream g_strsplit + g_strstrip). */
const names = (list: string): string[] =>
  list
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

/**
 * Clone original (upstream LPECloneOriginal): the item takes the shape and the chosen attributes
 * and style properties of a linked item.
 * TODO: text as original (getNormalizedBpath), removing the effect of a clone made by "Clone
 * original" (upstream getHolderRemove and doOnRemove make an svg:use).
 */
export class LPECloneOriginal extends GroupBBoxEffect {
  readonly linkeditem: OriginalSatelliteParam;
  readonly method: EnumParam<Clonelpemethod>;
  readonly attributes: TextParam;
  readonly css_properties: TextParam;
  readonly allow_transforms: BoolParam;
  old_attributes = '';
  old_css_properties = '';
  linked = '';
  sync = false;

  constructor(lpeobject: LivePathEffectObject) {
    super(lpeobject);
    this.linkeditem = new OriginalSatelliteParam(
      _('Linked Object:'),
      _('Select the object to use as the source for original data.'),
      'linkeditem',
      this,
    );
    this.method = new EnumParam(
      _('Shape'),
      _(
        'Choose how path geometry is synchronized from the original object: Transformations only, original path data, path with Live Path Effects, or Spiro/BSpline shapes only.',
      ),
      'method',
      CLMConverter,
      this,
      Clonelpemethod.CLM_D,
    );
    this.allow_transforms = new BoolParam(
      _('Allow Transformations'),
      _('This allows you to change the position, scale, and rotation of the clone.'),
      'allow_transforms',
      this,
      true,
    );
    this.attributes = new TextParam(
      _('Attributes'),
      _(
        "Attributes of the original object that the clone should copy, written as a comma-separated list e.g. 'transform, style, clip-path, X, Y'.",
      ),
      'attributes',
      this,
      '',
    );
    this.css_properties = new TextParam(
      _('CSS Properties'),
      _(
        "Specify which CSS properties the clone should copy from the original object, using a comma-separated list (for example: 'fill, filter, opacity').",
      ),
      'css_properties',
      this,
      '',
    );
    //0.92 compatibility
    const lpeobj = this.getLPEObj();
    const linkedpath = lpeobj.getAttribute('linkedpath');
    if (linkedpath) {
      lpeobj.setAttribute('linkeditem', linkedpath);
      lpeobj.removeAttribute('linkedpath');
      lpeobj.setAttribute('method', 'bsplinespiro');
      lpeobj.setAttribute('allow_transforms', 'false');
    }
    this.linked = lpeobj.getAttribute('linkeditem') ?? '';
    this.registerParameter(this.linkeditem);
    this.registerParameter(this.method);
    this.registerParameter(this.allow_transforms);
    this.registerParameter(this.attributes);
    this.registerParameter(this.css_properties);
    this.attributes.param_hide_canvas_text();
    this.css_properties.param_hide_canvas_text();
  }

  protected override doOnOpen(_lpeitem: SPLPEItem): boolean {
    // we need to inform when all items are ready to read svg relink clones
    // previously couldn't be because clones are not ready (load later)
    this.linkeditem.start_listening(this.linkeditem.getObject());
    return false;
  }

  /** Unlink the shape: keep the transformation link only (upstream syncOriginal). */
  syncOriginal(): void {
    if (this.method.get_value() === Clonelpemethod.CLM_NONE || !this.sp_lpe_item) return;
    this.sync = true;
    sp_lpe_item_update_patheffect(this.sp_lpe_item, false, true);
    this.method.param_set_value(Clonelpemethod.CLM_NONE);
    this.method.write_to_SVG();
    this.refresh_widgets = true;
    sp_lpe_item_update_patheffect(this.sp_lpe_item, false, true);
    // TODO: switch the node tool off and on, to show the new path.
  }

  override newWidget(): { param: Parameter | null; widget: ParamWidget }[] {
    const widgets = super.newWidget();
    widgets.push({
      param: null,
      widget: {
        kind: 'buttons',
        buttons: [{ label: _('Unlink Shape - Transformation Only'), onClick: () => this.syncOriginal() }],
      },
    });
    return widgets;
  }

  cloneAttributes(
    origin: SPObject | null,
    dest: SPObject | null,
    attributes: string,
    css_properties: string,
    init: boolean,
  ): void {
    const document = this.getSPDoc();
    if (!document || !origin || !dest) return;
    const root = dest === this.sp_lpe_item;
    const group_origin = origin instanceof SPGroup ? origin : null;
    const group_dest = dest instanceof SPGroup ? dest : null;
    if (group_origin && group_dest && group_origin.getItemCount() === group_dest.getItemCount()) {
      group_origin.childList().forEach((child, index) => {
        this.cloneAttributes(child, group_dest.nthChild(index), attributes, css_properties, init);
      });
    } else if ((!group_origin && group_dest) || (group_origin && !group_dest)) {
      console.warn(
        'LPE Clone Original: for this path effect to work properly, the same type and the same number of children are required',
      );
      return;
    }
    //Attributes
    const shape_origin = origin instanceof SPShape ? origin : null;
    const shape_dest = dest instanceof SPShape ? dest : null;
    const path_dest = dest instanceof SPPath;
    for (const attribute of names(this.old_attributes)) dest.removeAttribute(attribute);
    const method = this.method.get_value();
    for (const attribute of names(attributes)) {
      if (shape_dest && shape_origin) {
        if (attribute === 'd') {
          let c: PathVector | null = null;
          if (method === Clonelpemethod.CLM_BSPLINESPIRO) {
            c = shape_origin.curveForEdit();
            if (c && 'path_effect_list' in origin) {
              for (const lperef of (origin as SPLPEItem).getEffectList()) {
                const lpe = lperef.lpeobject?.get_lpe();
                if (lpe instanceof LPEBSpline) {
                  c = sp_bspline_do_effect(c, 0, [], lpe.uniform.get_value());
                } else if (lpe instanceof LPESpiro) {
                  c = sp_spiro_do_effect(c);
                }
              }
            }
          } else if (method === Clonelpemethod.CLM_ORIGINALD) {
            c = shape_origin.curveForEdit();
          } else if (method === Clonelpemethod.CLM_D) {
            c = shape_origin.curve();
          }
          if (c && method !== Clonelpemethod.CLM_NONE) {
            const str = sp_svg_write_path(c);
            if (this.sync) {
              if (path_dest) dest.setAttribute('inkscape:original-d', str);
              else dest.setAttribute('d', str);
            }
            shape_dest.setCurveInsync(c);
            dest.setAttribute('d', str);
          } else if (method !== Clonelpemethod.CLM_NONE) {
            dest.removeAttribute(attribute);
          }
        } else {
          dest.setAttribute(attribute, origin.getAttribute(attribute));
        }
      } else {
        dest.setAttribute(attribute, origin.getAttribute(attribute));
      }
    }
    if (!this.allow_transforms.get_value() || !root) {
      dest.setAttribute('transform', origin.getAttribute('transform'));
      dest.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
    }

    const css_origin = spReprCssAttrNew();
    spReprCssAttrAddFromString(css_origin, origin.getAttribute('style'));
    let css_dest = spReprCssAttrNew();
    spReprCssAttrAddFromString(css_dest, dest.getAttribute('style'));
    if (init) css_dest = css_origin;
    for (const attribute of names(this.old_css_properties)) spReprCssSetProperty(css_dest, attribute, null);
    for (const attribute of names(css_properties)) {
      const origin_attribute = spReprCssProperty(css_origin, attribute, '');
      spReprCssSetProperty(css_dest, attribute, origin_attribute ? origin_attribute : null);
    }
    const css_str = spReprCssWriteString(css_dest);
    dest.setAttribute('style', css_str || null);
  }

  protected override doBeforeEffect(lpeitem: SPLPEItem): void {
    const document = this.getSPDoc();
    if (!document) return;
    if (
      !this.is_load &&
      !this.isOnClipboard() &&
      this.linkeditem.lperef.isAttached() &&
      !this.linkeditem.lperef.getObject()
    ) {
      this.linkeditem.unlink();
      return;
    }
    let init = false;
    if (!this.linkeditem.linksToItem()) {
      this.linkeditem.read_from_SVG();
      init = true;
    }
    if (!this.linkeditem.linksToItem()) {
      this.linked = '';
      return;
    }
    if (!this.linkeditem.isConnected() && this.linkeditem.getObject()) {
      this.linkeditem.start_listening(this.linkeditem.getObject());
      if (this.sp_lpe_item) sp_lpe_item_update_patheffect(this.sp_lpe_item, false, false, true);
      return;
    }
    const orig = this.linkeditem.getObject();
    if (!(orig instanceof SPItem)) return;
    const dest = this.sp_lpe_item;
    if (!dest) return;
    const id = this.getLPEObj().getAttribute('linkeditem') ?? '';
    init = init || this.linked === '' || id !== this.linked;
    // TODO: text as original (getNormalizedBpath).
    let attr = 'd,';
    if (this.linked !== id && !this.is_load) dest.setAttribute('transform', null);
    this.original_bbox(lpeitem, false, true);
    const attributes_str = this.attributes.param_getSVGValue();
    attr += `${attributes_str},`;
    if (attr.length && !attributes_str) attr = attr.slice(0, -1);
    const style_attr = `${this.css_properties.param_getSVGValue()},`;
    this.cloneAttributes(orig, dest, attr, style_attr, init);
    this.old_css_properties = this.css_properties.param_getSVGValue();
    this.old_attributes = this.attributes.param_getSVGValue();
    this.sync = false;
    this.linked = id;
  }

  protected override doOnRemove(_lpeitem: SPLPEItem | null): void {
    this.linkeditem.quit_listening();
    this.linkeditem.unlink();
  }

  override doEffect(curve: PathVector): PathVector {
    const shape = this.getCurrentShape();
    if (!shape) return curve;
    if (!shape.curveBeforeLPE()) this.syncOriginal();
    if (this.method.get_value() !== Clonelpemethod.CLM_NONE) {
      const current_curve = shape.curve();
      if (current_curve) return current_curve;
    }
    return curve;
  }
}
