// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-bool.cpp, src/live_effects/lpe-bool.h
/*
 * Boolean operation live path effect
 *
 * Copyright (C) 2016-2017 Michael Soegtrop
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import type { Affine, PathVector } from '@inkscape-web/geom';
import { attributeName, SPAttr } from '../attributes.ts';
import { _, N_ } from '../i18n.ts';
import { i2anc_affine, SPItem } from '../object/sp-item.ts';
import { SPGroup } from '../object/sp-item-group.ts';
import { type SPLPEItem, sp_lpe_item_update_patheffect } from '../object/sp-lpe-item.ts';
import type { SPObject } from '../object/sp-object.ts';
import { SPShape } from '../object/sp-shape.ts';
import { SPText } from '../object/sp-text.ts';
import { BooleanOp, FillRule, sp_pathvector_boolop } from '../path/path-boolop.ts';
import { SPStyleSrc } from '../style-internal.ts';
import { sp_svg_write_path } from '../svg/svg-path.ts';
import { EnumDataConverter } from '../util/enums.ts';
import type { Node } from '../xml/node.ts';
import {
  spReprCssAttr,
  spReprCssAttrNew,
  spReprCssChange,
  spReprCssProperty,
  spReprCssSetProperty,
  spReprCssUnsetProperty,
} from '../xml/repr-css.ts';
import { Effect, LPEAction } from './effect.ts';
import type { LivePathEffectObject } from './lpeobject.ts';
import { BoolParam } from './parameter/bool.ts';
import { EnumParam } from './parameter/enum.ts';
import { HiddenParam } from './parameter/hidden.ts';
import { OriginalSatelliteParam } from './parameter/satellite.ts';

// Define an extended boolean operation type (the first values are those of BooleanOp)
export enum bool_op_ex {
  bool_op_ex_union = 0,
  bool_op_ex_inters = 1,
  bool_op_ex_diff = 2,
  bool_op_ex_symdiff = 3,
  bool_op_ex_cut = 4,
  bool_op_ex_cut_both,
  bool_op_ex_count,
}

function to_bool_op(val: bool_op_ex): BooleanOp {
  return val as number as BooleanOp;
}

// Note on naming of operations:
// bool_op_cut is called "Division" in the manu, see sp_selected_path_cut
// bool_op_slice is called "Cut path" in the menu, see sp_selected_path_slice
// (upstream comments out the slice operations because they do not work properly)
const BoolOpConverter = new EnumDataConverter<bool_op_ex>([
  { id: bool_op_ex.bool_op_ex_union, label: N_('union'), key: 'union' },
  { id: bool_op_ex.bool_op_ex_inters, label: N_('intersection'), key: 'inters' },
  { id: bool_op_ex.bool_op_ex_diff, label: N_('difference'), key: 'diff' },
  { id: bool_op_ex.bool_op_ex_symdiff, label: N_('symmetric difference'), key: 'symdiff' },
  { id: bool_op_ex.bool_op_ex_cut, label: N_('division'), key: 'cut' },
  { id: bool_op_ex.bool_op_ex_cut_both, label: N_('division both'), key: 'cut-both' },
]);

const FillTypeConverter = new EnumDataConverter<FillRule>([
  { id: FillRule.fill_oddEven, label: N_('even-odd'), key: 'oddeven' },
  { id: FillRule.fill_nonZero, label: N_('non-zero'), key: 'nonzero' },
  { id: FillRule.fill_positive, label: N_('positive'), key: 'positive' },
  { id: FillRule.fill_justDont, label: N_('take from object'), key: 'from-curve' },
]);

const HIDDER_FILTER = 'selectable_hidder_filter';

function GetFillTyp(item: SPItem | null): FillRule {
  if (!item) return FillRule.fill_nonZero;
  const css = spReprCssAttr(item.getRepr(), 'style');
  const val = spReprCssProperty(css, 'fill-rule', null);
  if (val === 'nonzero') return FillRule.fill_nonZero;
  if (val === 'evenodd') return FillRule.fill_oddEven;
  return FillRule.fill_nonZero;
}

/**
 * Boolean operation (upstream LPEBool): the union, intersection, difference, ... of the path with
 * a linked operand item, which is hidden with a filter. TODO: rmv_inner (needs livarot
 * ConvertToForme; upstream does not register the parameter).
 */
export class LPEBool extends Effect {
  readonly operand_item: OriginalSatelliteParam;
  readonly bool_operation: EnumParam<bool_op_ex>;
  readonly fill_type_this: EnumParam<FillRule>;
  readonly fill_type_operand: EnumParam<FillRule>;
  readonly swap_operands: BoolParam;
  readonly rmv_inner: BoolParam;
  readonly filter: HiddenParam;
  onremove = false;
  operand: SPItem | null = null;
  division: SPGroup | null = null;
  division_both: SPGroup | null = null;
  division_other: SPGroup | null = null;
  operand_id = '';
  division_id = '';
  division_other_id = '';
  _hp: PathVector = [];
  reverse = false;

  constructor(lpeobject: LivePathEffectObject) {
    super(lpeobject);
    this.operand_item = new OriginalSatelliteParam(
      _('Operand path:'),
      _('Operand for the boolean operation'),
      'operand-path',
      this,
    );
    this.bool_operation = new EnumParam(
      _('Operation:'),
      _('Boolean Operation'),
      'operation',
      BoolOpConverter,
      this,
      bool_op_ex.bool_op_ex_union,
    );
    this.swap_operands = new BoolParam(
      _('Swap operands'),
      _('Swap operands (useful e.g. for difference)'),
      'swap-operands',
      this,
    );
    this.rmv_inner = new BoolParam(
      _('Remove inner'),
      _(
        'For cut operations: remove inner (non-contour) lines of cutting path to avoid invisible extra points',
      ),
      'rmv-inner',
      this,
    );
    this.fill_type_this = new EnumParam(
      _('Fill type this:'),
      _('Fill type (winding mode) for this path'),
      'filltype-this',
      FillTypeConverter,
      this,
      FillRule.fill_justDont,
    );
    this.fill_type_operand = new EnumParam(
      _('Fill type operand:'),
      _('Fill type (winding mode) for operand path'),
      'filltype-operand',
      FillTypeConverter,
      this,
      FillRule.fill_justDont,
    );
    this.filter = new HiddenParam('Filter', 'Previous filter', 'filter', this, '', true);
    this.registerParameter(this.operand_item);
    this.registerParameter(this.bool_operation);
    this.registerParameter(this.swap_operands);
    //registerParameter(&rmv_inner);
    this.registerParameter(this.fill_type_this);
    this.registerParameter(this.filter);
    this.registerParameter(this.fill_type_operand);
    this.show_orig_path = true;
    this.satellitestoclipboard = true;
    const operand = this.operand_item.getObject();
    this.operand = operand instanceof SPItem ? operand : null;
    if (this.operand) this.operand_id = this.operand.getId() ?? '';
  }

  protected override doOnOpen(_lpeitem: SPLPEItem): boolean {
    if (!this.is_load || this.is_applied) return false;
    const version = this.lpeversion.param_getSVGValue();
    if (version < '1.2') this.lpeversion.param_setValue('1.2', true);
    this.operand_item.start_listening(this.operand_item.getObject());
    // TODO: connect_selection_changed (the operand follows the selection on the desktop).
    return false;
  }

  add_filter(): void {
    const operand = this.operand_item.getObject();
    if (!(operand instanceof SPItem)) return;
    const repr = operand.getRepr();
    const filt = operand.style?.getFilter() ?? null;
    const filt_id = filt?.getId() ?? null;
    if (filt && filt_id && filt_id !== HIDDER_FILTER) this.filter.param_setValue(filt_id, true);
    if (!filt || (filt_id && filt_id !== HIDDER_FILTER)) {
      const css = spReprCssAttrNew();
      spReprCssSetProperty(css, 'filter', `url(#${HIDDER_FILTER})`);
      spReprCssChange(repr, css, 'style');
    }
  }

  remove_filter(operand: SPObject | null): void {
    if (!operand) return;
    const repr = operand.getRepr();
    const filt = operand.style?.getFilter() ?? null;
    if (filt && filt.getId() === HIDDER_FILTER) {
      const css = spReprCssAttrNew();
      const filtstr = this.filter.param_getSVGValue();
      if (filtstr !== '') {
        spReprCssSetProperty(css, 'filter', `url(#${filtstr})`);
        this.filter.param_setValue('');
      } else {
        spReprCssUnsetProperty(css, 'filter');
      }
      spReprCssChange(repr, css, 'style');
    }
  }

  protected override doAfterEffect(_lpeitem: SPLPEItem, _curve: PathVector | null): void {
    if (this.onremove) this.onremove = false;
  }

  protected override doBeforeEffect(_lpeitem: SPLPEItem): void {
    const document = this.getSPDoc();
    if (!document) return;
    this._hp = [];
    const xml_doc = document.getReprDoc();
    const elemref = document.getObjectById(HIDDER_FILTER);
    if (!elemref) {
      const boolfilter = xml_doc.createElement('svg:filter');
      boolfilter.setAttribute('id', HIDDER_FILTER);
      boolfilter.setAttribute('width', '1');
      boolfilter.setAttribute('height', '1');
      boolfilter.setAttribute('x', '0');
      boolfilter.setAttribute('y', '0');
      boolfilter.setAttribute('style', 'color-interpolation-filters:sRGB;');
      boolfilter.setAttribute('inkscape:label', 'LPE boolean visibility');
      /* Create <path> */
      const primitive = xml_doc.createElement('svg:feComposite');
      primitive.setAttribute('id', 'boolops_hidder_primitive');
      primitive.setAttribute('result', 'composite1');
      primitive.setAttribute('operator', 'arithmetic');
      primitive.setAttribute('in2', 'SourceGraphic');
      primitive.setAttribute('in', 'BackgroundImage');
      document.getDefs()?.getRepr().addChild(boolfilter, null);
      boolfilter.addChild(primitive, null);
    } else {
      for (const obj of elemref.childList()) {
        if (obj.getId() !== 'boolops_hidder_primitive') obj.deleteObject(true);
      }
    }
    if (
      !this.is_load &&
      !this.isOnClipboard() &&
      this.operand_item.lperef.isAttached() &&
      this.operand_item.lperef.getObject() === null
    ) {
      this.operand_item.unlink();
      return;
    }
    const asItem = (o: SPObject | null) => (o instanceof SPItem ? o : null);
    let current_operand = asItem(this.operand_item.getObject());
    if (this.onremove && current_operand) {
      this.operand_id = current_operand.getId() ?? '';
      return;
    }
    this.operand = asItem(this.operand_id ? document.getObjectById(this.operand_id) : null);
    if (!this.operand_item.linksToItem()) {
      this.operand_item.read_from_SVG();
      current_operand = asItem(this.operand_item.getObject());
    }
    if (!current_operand && !this.operand) return;
    if (!current_operand) this.operand_item.unlink();
    if (current_operand && !this.operand) {
      this.operand_id = current_operand.getId() ?? '';
      if (this.sp_lpe_item) sp_lpe_item_update_patheffect(this.sp_lpe_item, false, false, true);
      return;
    }
    if (current_operand && !this.operand_item.isConnected()) {
      this.operand_item.start_listening(current_operand);
      if (this.sp_lpe_item) sp_lpe_item_update_patheffect(this.sp_lpe_item, false, false, true);
      return;
    }
    if (current_operand) {
      const id = current_operand.getId();
      if (!id || !document.getObjectById(id)) {
        this.operand_item.unlink();
        this.operand = null;
        this.operand_id = '';
        current_operand = null;
      } else {
        this.operand_id = id;
      }
    }
    // TODO: when the item and its operand (also a boolean operation) are both selected on the
    // desktop, upstream updates the operand first.
    if (!current_operand) {
      if (this.operand) this.remove_filter(this.operand);
      this.operand = null;
      this.operand_id = '';
    }
    if (current_operand && this.operand !== current_operand) {
      if (this.operand) this.remove_filter(this.operand);
      this.operand = current_operand;
      this.remove_filter(this.operand);
      if (this.is_load && this.sp_lpe_item) sp_lpe_item_update_patheffect(this.sp_lpe_item, true, true);
    }
    if (current_operand) {
      const op = this.bool_operation.get_value();
      if (this.is_visible.get_value() && op !== bool_op_ex.bool_op_ex_cut_both) this.add_filter();
      else this.remove_filter(current_operand);
    }
  }

  /**
   * Upstream moves the operand with the item when the operand is not selected on the desktop.
   * TODO: the core has no desktop selection, so the operand stays.
   */
  protected override transform_multiply(_postmul: Affine, _set: boolean): void {}

  get_union(root: SPObject, object: SPObject, _from_original_d = false): PathVector {
    let res: PathVector = [];
    let clippv: PathVector = [];
    if (object instanceof SPItem) {
      const clip_path = object.getClipObject();
      if (clip_path) {
        for (const clip of clip_path.childList()) {
          if (clip instanceof SPShape) {
            const curve = _from_original_d ? clip.curveForEdit() : clip.curve();
            if (curve) clippv = curve;
          }
        }
      }
    }
    const union = (a: PathVector, b: PathVector, fa: FillRule, fb: FillRule): PathVector =>
      a.length === 0 ? b : sp_pathvector_boolop(a, b, BooleanOp.bool_op_union, fa, fb);
    if (object instanceof SPGroup) {
      for (const iter of object.item_list()) {
        res = union(
          res,
          this.get_union(root, iter, _from_original_d),
          FillRule.fill_oddEven,
          FillRule.fill_oddEven,
        );
      }
    }
    if (object instanceof SPShape) {
      const curve = _from_original_d ? object.curveForEdit() : object.curve();
      if (curve) {
        const a = i2anc_affine(object, root.parent);
        const tmp = curve.map((p) => p.transformed(a));
        res = union(res, tmp, FillRule.fill_oddEven, GetFillTyp(object));
      }
    }
    if (object instanceof SPText) {
      const a = i2anc_affine(object, root.parent);
      const tmp = object.getNormalizedBpath().map((p) => p.transformed(a));
      res = union(res, tmp, FillRule.fill_oddEven, FillRule.fill_oddEven);
    }
    if (clippv.length) {
      res = sp_pathvector_boolop(
        clippv,
        res,
        BooleanOp.bool_op_diff,
        FillRule.fill_oddEven,
        FillRule.fill_oddEven,
      );
    }
    return res;
  }

  override doEffect(curve: PathVector): PathVector {
    let path_in = curve;
    let current_operand: SPObject | null = this.operand_item.getObject();
    if (current_operand && current_operand === this.current_shape) {
      console.warn('operand and current shape are the same');
      this.operand_item.param_set_default();
      return curve;
    }
    if (this.onremove) current_operand = this.getSPDoc()?.getObjectById(this.operand_id) ?? null;
    if (!(current_operand instanceof SPItem) || !this.sp_lpe_item) return curve;
    const op = this.bool_operation.get_value();
    let swap = this.swap_operands.get_value();
    if (op === bool_op_ex.bool_op_ex_cut_both) swap = false;

    const current_affine = this.sp_lpe_item.transform;
    const operand_pv = this.get_union(current_operand, current_operand);
    if (operand_pv.length === 0) return curve;
    path_in = path_in.map((p) => p.transformed(current_affine));

    const path_a = swap ? path_in : operand_pv;
    const path_b = swap ? operand_pv : path_in;
    const inverse = current_affine.inverse();
    this._hp = [...path_a, ...path_b].map((p) => p.transformed(inverse));
    const item = this.operand_item.getObject();
    const fill_this =
      this.fill_type_this.get_value() !== FillRule.fill_justDont
        ? this.fill_type_this.get_value()
        : GetFillTyp(this.current_shape);
    const fill_operand =
      this.fill_type_operand.get_value() !== FillRule.fill_justDont
        ? this.fill_type_operand.get_value()
        : GetFillTyp(item instanceof SPItem ? item : null);

    const fill_a = swap ? fill_this : fill_operand;
    const fill_b = swap ? fill_operand : fill_this;

    // TODO: rmv_inner (sp_pathvector_boolop_remove_inner).
    let path_out: PathVector;
    this.helperLineSatellites = false;
    if (op === bool_op_ex.bool_op_ex_cut) {
      path_out = sp_pathvector_boolop(
        path_a,
        path_b,
        this.onremove ? BooleanOp.bool_op_diff : to_bool_op(op),
        fill_a,
        fill_b,
      );
    } else if (op === bool_op_ex.bool_op_ex_cut_both) {
      if (this.onremove) {
        path_out = sp_pathvector_boolop(path_a, path_b, BooleanOp.bool_op_diff, fill_a, fill_b);
      } else {
        this.helperLineSatellites = true;
        path_out = sp_pathvector_boolop(path_a, path_b, BooleanOp.bool_op_diff, fill_a, fill_b);
        const tmp = sp_pathvector_boolop(path_a, path_b, BooleanOp.bool_op_inters, fill_a, fill_b);
        path_out = [...path_out, ...tmp];
      }
    } else {
      path_out = sp_pathvector_boolop(path_a, path_b, to_bool_op(op), fill_a, fill_b);
    }
    return path_out.map((p) => p.transformed(inverse));
  }

  protected override addCanvasIndicators(_lpeitem: SPLPEItem, hp_vec: PathVector[]): void {
    hp_vec.push(this._hp);
  }

  dupleNode(origin: SPObject, element_type: string): Node {
    const dest = origin.getRepr().document().createElement(element_type);
    dest.setAttribute('transform', origin.getAttribute('transform'));
    dest.setAttribute('d', origin.getAttribute('d'));
    dest.setAttribute('style', origin.getAttribute('style'));
    dest.setAttribute('mask', origin.getAttribute('mask'));
    dest.setAttribute('clip-path', origin.getAttribute('clip-path'));
    dest.setAttribute('class', origin.getAttribute('class'));
    dest.setAttribute('style', origin.getAttribute('style'));
    for (const iter of origin.style?.properties() ?? []) {
      if (iter.style_src !== SPStyleSrc.UNSET) {
        const key = iter.id;
        if (key !== SPAttr.FONT && key !== SPAttr.D && key !== SPAttr.MARKER) {
          const name = attributeName(key);
          const attr = name ? origin.getAttribute(name) : null;
          if (name && attr) dest.setAttribute(name, attr);
        }
      }
    }
    return dest;
  }

  fractureit(operandit: SPObject, unionpv: PathVector): void {
    // 1.2 feature no need to legacy bool
    const lpeitem = this.sp_lpe_item;
    const doc = this.getSPDoc();
    if (!lpeitem?.parent || !doc) return;
    const operandit_item = operandit instanceof SPItem ? operandit : null;
    const fill_a =
      this.fill_type_this.get_value() !== FillRule.fill_justDont
        ? this.fill_type_this.get_value()
        : GetFillTyp(operandit_item);
    const fill_b =
      this.fill_type_operand.get_value() !== FillRule.fill_justDont
        ? this.fill_type_operand.get_value()
        : GetFillTyp(operandit_item);
    const divisionit = doc.getObjectById(this.division_id);
    if (operandit instanceof SPGroup) {
      const dest = this.dupleNode(operandit, 'svg:g');
      dest.setAttribute('transform', null);
      if (!this.division_other) {
        this.division_other = lpeitem.parent.appendChildRepr(dest) as SPGroup;
        this.division_other_id = this.division_other.getId() ?? '';
        this.division_other.parent?.reorder(this.division_other, divisionit);
      } else {
        this.division_other = this.division_other.appendChildRepr(dest) as SPGroup;
      }
      const dest2 = this.dupleNode(operandit, 'svg:g');
      dest2.setAttribute('transform', null);
      if (!this.division_both) {
        this.division_both = lpeitem.parent.appendChildRepr(dest2) as SPGroup;
        this.division_both.parent?.reorder(this.division_both, this.division_other);
      } else {
        this.division_both = this.division_both.appendChildRepr(dest2) as SPGroup;
      }
      for (const child of [...operandit.children]) {
        if (child instanceof SPItem) this.fractureit(child, unionpv);
      }
    }
    if (operandit instanceof SPShape) {
      const c = operandit.curve();
      if (c) {
        const a = i2anc_affine(operandit, lpeitem.parent);
        const curve = c.map((p) => p.transformed(a));
        const intesect = sp_pathvector_boolop(unionpv, curve, BooleanOp.bool_op_inters, fill_a, fill_b);
        const dest = this.dupleNode(operandit, 'svg:path');
        dest.setAttribute('d', sp_svg_write_path(intesect));
        dest.setAttribute('transform', null);
        if (!this.division_other) this.division_other = lpeitem.parent as SPGroup;
        const divisionitem = this.division_other.appendChildRepr(dest);
        if (!this.division_other_id) {
          if (divisionitem) this.division_other.reorder(divisionitem, divisionit);
          this.division_other_id = dest.attribute('id') ?? '';
        }
        const operandit_pathv = sp_pathvector_boolop(unionpv, curve, BooleanOp.bool_op_diff, fill_a, fill_b);
        const dest2 = this.dupleNode(operandit, 'svg:path');
        dest2.setAttribute('transform', null);
        dest2.setAttribute('d', sp_svg_write_path(operandit_pathv));
        if (!this.division_both) {
          this.division_both = lpeitem.parent as SPGroup;
          const divisionitem2 = this.division_both.appendChildRepr(dest2);
          if (divisionitem2) this.division_both.reorder(divisionitem2, divisionitem);
        } else {
          this.division_both.appendChildRepr(dest2);
        }
      }
    }
  }

  divisionit(operand_a: SPObject, operand_b: SPObject, unionpv: PathVector): void {
    const lpeitem = this.sp_lpe_item;
    if (!lpeitem?.parent) return;
    const fill_a =
      this.fill_type_this.get_value() !== FillRule.fill_justDont
        ? this.fill_type_this.get_value()
        : GetFillTyp(operand_a instanceof SPItem ? operand_a : null);
    const fill_b =
      this.fill_type_operand.get_value() !== FillRule.fill_justDont
        ? this.fill_type_operand.get_value()
        : GetFillTyp(operand_b instanceof SPItem ? operand_b : null);
    if (operand_b instanceof SPGroup) {
      const dest = this.dupleNode(operand_b, 'svg:g');
      dest.setAttribute('transform', null);
      if (!this.division) {
        this.division = lpeitem.parent.appendChildRepr(dest) as SPGroup;
        this.division_id = this.division.getId() ?? '';
        this.division.parent?.reorder(this.division, lpeitem);
      } else {
        this.division = this.division.appendChildRepr(dest) as SPGroup;
      }
      for (const child of [...operand_b.children]) {
        if (child instanceof SPItem) this.divisionit(operand_a, child, unionpv);
      }
    }
    if (operand_b instanceof SPShape) {
      if (!this.division) this.division = lpeitem.parent as SPGroup;
      const c = operand_b.curveForEdit();
      if (c) {
        const a = i2anc_affine(operand_b, lpeitem.parent);
        const curve = c.map((p) => p.transformed(a));
        const intesect = sp_pathvector_boolop(unionpv, curve, BooleanOp.bool_op_inters, fill_a, fill_b);
        const dest = this.dupleNode(operand_b, 'svg:path');
        dest.setAttribute('d', sp_svg_write_path(intesect));
        dest.setAttribute('transform', null);
        const item = this.division.appendChildRepr(dest);
        if (item && !this.division_id) this.division_id = item.getId() ?? '';
      }
    }
  }

  protected override doOnRemove(lpeitem: SPLPEItem | null): void {
    // set "keep paths" hook on sp-lpe-item.cpp
    this.remove_filter(this.operand_item.getObject());
    const doc = this.getSPDoc();
    const operand = this.operand_id ? doc?.getObjectById(this.operand_id) : null;
    if (!(operand instanceof SPItem) || !this.keep_paths || !lpeitem || !this.sp_lpe_item || !doc) return;
    const op = this.bool_operation.get_value();
    if (op === bool_op_ex.bool_op_ex_cut || op === bool_op_ex.bool_op_ex_cut_both) {
      const pos = (o: SPObject) => o.getRepr().position();
      this.reverse = pos(lpeitem) > pos(operand);
      this.division = null;
      let unionpv = this.get_union(operand, operand);
      this.divisionit(operand, this.sp_lpe_item, unionpv);
      this.onremove = true;
      sp_lpe_item_update_patheffect(this.sp_lpe_item, false, true);
      if (op === bool_op_ex.bool_op_ex_cut_both) {
        const a = doc.getObjectById(this.division_id);
        if (a instanceof SPItem) {
          unionpv = this.get_union(this.sp_lpe_item, this.sp_lpe_item, true);
          this.fractureit(operand, unionpv);
          const b = doc.getObjectById(this.division_other_id);
          if (b instanceof SPItem && this.reverse) b.lowerOne();
        }
      }
      // we reset variables because LPE is not removed on undo so I need to get clean on redo
      this.division = null;
      this.division_both = null;
      this.division_other = null;
      this.operand_id = '';
      this.division_id = '';
      this.division_other_id = '';
      this.onremove = false;
    }
    if (this.is_visible.get_value()) this.processObjects(LPEAction.LPE_ERASE);
  }

  // TODO: Migrate the tree next function to effect.cpp/h to avoid duplication
  override doOnVisibilityToggled(_lpeitem: SPLPEItem): void {
    const operand = this.operand_item.getObject();
    if (operand instanceof SPItem && !this.is_visible.get_value()) this.remove_filter(operand);
  }
}
