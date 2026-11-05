// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-measure-segments.cpp, src/live_effects/lpe-measure-segments.h
/*
 * Author(s):
 *   Jabiertxo Arraiza Cenoz <jabier.arraiza@marker.es>
 * Some code and ideas migrated from dimensioning.py by
 * Johannes B. Rutzmoser, johannes.rutzmoser (at) googlemail (dot) com
 * https://github.com/Rutzmoser/inkscape_dimensioning
 *
 * Copyright (C) 2014 Author(s)
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import {
  type Affine,
  are_near,
  atan2,
  cross,
  deg_from_rad,
  distance,
  LineSegment,
  middle_point,
  Path,
  type PathVector,
  Point,
  PathVector as PV,
  Rotate,
  rad_from_deg,
  Translate,
} from '@inkscape-web/geom';
import { Color } from '../colors/color.ts';
import { DocumentUndo } from '../document-undo.ts';
import { pathv_to_linear_and_cubic_beziers } from '../helper/geom.ts';
import { _, N_ } from '../i18n.ts';
import { PangoStretch, PangoStyle, pango_font_description_from_string } from '../libnrtype/font-factory.ts';
import { SPFlowtext } from '../object/sp-flowtext.ts';
import { i2anc_affine, SPItem } from '../object/sp-item.ts';
import { SPGroup } from '../object/sp-item-group.ts';
import {
  type SPLPEItem,
  sp_lpe_item_enable_path_effects,
  sp_lpe_item_update_patheffect,
} from '../object/sp-lpe-item.ts';
import { SPPath } from '../object/sp-path.ts';
import { SPShape } from '../object/sp-shape.ts';
import { SPText } from '../object/sp-text.ts';
import { Preferences } from '../preferences.ts';
import { svgNumber } from '../svg/stringstream.ts';
import { sp_svg_transform_write } from '../svg/svg-affine.ts';
import { convertUnit, svgLengthUnitAbbr } from '../svg/svg-length.ts';
import { sp_svg_write_path } from '../svg/svg-path.ts';
import { EnumDataConverter } from '../util/enums.ts';
import type { Node } from '../xml/node.ts';
import {
  type SPCSSAttr,
  spReprCssAttrAddFromString,
  spReprCssAttrNew,
  spReprCssChange,
  spReprCssSetProperty,
  spReprCssSetPropertyDouble,
  spReprCssSetPropertyString,
  spReprCssUnsetProperty,
  spReprCssWriteString,
} from '../xml/repr-css.ts';
import { Effect, LPEAction } from './effect.ts';
import type { LivePathEffectObject } from './lpeobject.ts';
import { BoolParam } from './parameter/bool.ts';
import { ColorPickerParam } from './parameter/colorpicker.ts';
import { EnumParam } from './parameter/enum.ts';
import { FontButtonParam } from './parameter/fontbutton.ts';
import { MessageParam } from './parameter/message.ts';
import { type Parameter, ScalarParam } from './parameter/parameter.ts';
import { SatelliteArrayParam } from './parameter/satellitearray.ts';
import { TextParam } from './parameter/text.ts';
import { UnitParam } from './parameter/unit.ts';

export enum OrientationMethod {
  OM_HORIZONTAL,
  OM_VERTICAL,
  OM_PARALLEL,
  OM_END,
}

const OMConverter = new EnumDataConverter<OrientationMethod>(
  [
    { id: OrientationMethod.OM_HORIZONTAL, label: N_('Horizontal'), key: 'horizontal' },
    { id: OrientationMethod.OM_VERTICAL, label: N_('Vertical'), key: 'vertical' },
    { id: OrientationMethod.OM_PARALLEL, label: N_('Parallel'), key: 'parallel' },
  ],
  OrientationMethod.OM_END,
);

const CSS_STRETCH = [
  'ultra-condensed',
  'extra-condensed',
  'condensed',
  'semi-condensed',
  'normal',
  'semi-expanded',
  'expanded',
  'extra-expanded',
  'ultra-expanded',
];

/** Angle of the vector from a to b (upstream Geom::Ray(a, b).angle(); a zero vector for near points). */
function rayAngle(a: Point, b: Point): number {
  const v = b.sub(a);
  return atan2(are_near(v, new Point(0, 0)) ? new Point(0, 0) : v);
}

/** `angle` in [0, 2 pi[ (std::fmod and a correction of negative values). */
function normalizeAngle(angle: number): number {
  angle %= 2 * Math.PI;
  return angle < 0 ? angle + 2 * Math.PI : angle;
}

/** Upstream getAngle(): the angle at p2 in the corner p1 p2 p3, 0 when no overlap handling is needed. */
function getAngle(p1: Point, p2: Point, p3: Point, flip_side: boolean, fix_overlaps: number): number {
  const ccw_toggle = cross(p1.sub(p2), p3.sub(p2)) < 0;
  // angle_between(Ray(p2, p1), Ray(p3, p1), ccw_toggle): the rays' vectors are p1 - p2 and p1 - p3
  const v1 = p1.sub(p2);
  const v2 = p1.sub(p3);
  let angle = Math.atan2(cross(v1, v2), v1.dot(v2));
  if (angle < 0) angle += 2 * Math.PI;
  if (!ccw_toggle) angle = 2 * Math.PI - angle;
  if (
    deg_from_rad(angle) < fix_overlaps ||
    deg_from_rad(angle) > 180 ||
    (ccw_toggle && flip_side) ||
    (!ccw_toggle && !flip_side)
  ) {
    angle = 0;
  }
  return angle;
}

/** The point of a path vector at the time t, which counts the curves of all paths (upstream PathVector::pointAt). */
function pathvectorPointAt(pv: PathVector, t: number): Point {
  let curve_index = Math.floor(t);
  let rest = t - curve_index;
  let path_index = 0;
  for (; path_index < pv.length; path_index++) {
    const s = (pv[path_index] as Path).size();
    if (s > curve_index) break;
    // special case for the last point
    if (s === curve_index && path_index + 1 === pv.length) {
      curve_index--;
      rest = 1;
      break;
    }
    curve_index -= s;
  }
  return (
    (pv[path_index] as Path).curves()[curve_index] ?? (pv[path_index] as Path).closingSegment()
  ).pointAt(rest);
}

/** The nodes of the path vector (upstream PathVector::nodes()). */
function pathvectorNodes(pv: PathVector): Point[] {
  const result: Point[] = [];
  for (const path of pv) {
    for (let j = 0; j < path.sizeClosed(); j++) result.push(path.at(j).initialPoint());
  }
  return result;
}

/** The nodes of an item that the projection uses (upstream getNodes()). */
function getNodes(
  item: SPItem,
  transform: Affine,
  onbbox: boolean,
  centers: boolean,
  bboxonly: boolean,
  angle_projection: number,
): Point[] {
  let current_nodes: Point[] = [];
  const transformNodes = (nodes: Point[], m: Affine) => nodes.map((n) => n.transformed(m));
  // TODO handle clones/use
  if (item instanceof SPGroup) {
    for (const sub_item of item.item_list()) {
      current_nodes.push(
        ...transformNodes(
          getNodes(sub_item, sub_item.transform, onbbox, centers, bboxonly, angle_projection),
          transform,
        ),
      );
    }
  } else if (item instanceof SPShape && !bboxonly) {
    const c = item.curve();
    if (c) current_nodes = transformNodes(pathvectorNodes(c), transform);
  } else if ((item instanceof SPText || item instanceof SPFlowtext) && !bboxonly) {
    // the nodes of the outlines of the glyphs
    current_nodes = transformNodes(pathvectorNodes(item.getNormalizedBpath()), transform);
  } else {
    onbbox = true;
  }
  if (onbbox || centers) {
    const bbox = item.geometricBounds();
    if (bbox && onbbox) {
      current_nodes.push(bbox.corner(0).transformed(transform));
      current_nodes.push(bbox.corner(2).transformed(transform));
      if (
        !are_near(angle_projection, 0.0) &&
        !are_near(angle_projection, 90.0) &&
        !are_near(angle_projection, 180.0) &&
        !are_near(angle_projection, 360.0)
      ) {
        current_nodes.push(bbox.corner(1).transformed(transform));
        current_nodes.push(bbox.corner(3).transformed(transform));
      }
    }
    if (bbox && centers) current_nodes.push(bbox.midpoint().transformed(transform));
  }
  return current_nodes;
}

/**
 * The size of a font description string, in pt (Pango::FontDescription::get_size() / SCALE): the
 * number at the end, 0 for none.
 */
function fontSizePt(fontspec: string): number {
  const m = /(\d+(?:\.\d+)?)\s*$/.exec(fontspec.trim());
  return m ? Number(m[1]) : 0;
}

/** Set the CSS font properties of a font specification (upstream FontLister::fill_css). */
function fillCssFromFontSpec(css: SPCSSAttr, fontspec: string): void {
  const descr = pango_font_description_from_string(fontspec);
  const family = /^[A-Za-z][\w-]*(?:\s+[A-Za-z][\w-]*)*$/.test(descr.family)
    ? descr.family
    : `'${descr.family}'`;
  spReprCssSetProperty(css, 'font-family', family);
  spReprCssSetProperty(
    css,
    'font-style',
    descr.style === PangoStyle.PANGO_STYLE_ITALIC
      ? 'italic'
      : descr.style === PangoStyle.PANGO_STYLE_OBLIQUE
        ? 'oblique'
        : 'normal',
  );
  spReprCssSetProperty(
    css,
    'font-weight',
    descr.weight === 400 ? 'normal' : descr.weight === 700 ? 'bold' : String(descr.weight),
  );
  spReprCssSetProperty(
    css,
    'font-stretch',
    CSS_STRETCH[descr.stretch ?? PangoStretch.PANGO_STRETCH_NORMAL] ?? 'normal',
  );
  spReprCssSetProperty(css, 'font-variant', descr.variant === 1 ? 'small-caps' : 'normal');
  spReprCssSetProperty(css, '-inkscape-font-specification', fontspec);
}

/** Move the item to just after the target in the parent of the target (upstream SPItem::moveTo(target, false)). */
function moveToAfter(item: SPItem, target: SPItem): void {
  const our_ref = item.getRepr();
  const target_ref = target.getRepr();
  if (target_ref === our_ref) return;
  if (target_ref.parent() !== our_ref.parent()) {
    our_ref.parent()?.removeChild(our_ref);
    target_ref.parent()?.addChild(our_ref, target_ref);
  } else {
    our_ref.parent()?.changeOrder(our_ref, target_ref);
  }
}

/**
 * Measure segments (upstream LPEMeasureSegments): dimension lines with arrows and labels for the
 * segments of the path, made of objects in the document. With the projection the lines show the
 * distances of the nodes of the path (and of linked items) in a direction.
 * TODO: the list of linked items in the dialog and linking the selected items, localized number
 * formats, a font chooser, the display unit of legacy documents (root width unit instead).
 */
export class LPEMeasureSegments extends Effect {
  readonly unit: UnitParam;
  readonly orientation: EnumParam<OrientationMethod>;
  readonly coloropacity: ColorPickerParam;
  readonly fontbutton: FontButtonParam;
  readonly precision: ScalarParam;
  readonly fix_overlaps: ScalarParam;
  readonly position: ScalarParam;
  readonly text_top_bottom: ScalarParam;
  readonly helpline_distance: ScalarParam;
  readonly helpline_overlap: ScalarParam;
  readonly line_width: ScalarParam;
  readonly scale: ScalarParam;
  readonly format: TextParam;
  readonly blacklist: TextParam;
  readonly whitelist: BoolParam;
  readonly showindex: BoolParam;
  readonly arrows_outside: BoolParam;
  readonly flip_side: BoolParam;
  readonly scale_sensitive: BoolParam;
  readonly local_locale: BoolParam;
  readonly rotate_anotation: BoolParam;
  readonly hide_back: BoolParam;
  readonly hide_arrows: BoolParam;
  readonly smallx100: BoolParam;
  readonly linked_items: SatelliteArrayParam;
  readonly distance_projection: ScalarParam;
  readonly angle_projection: ScalarParam;
  readonly active_projection: BoolParam;
  readonly avoid_overlapping: BoolParam;
  readonly onbbox: BoolParam;
  readonly bboxonly: BoolParam;
  readonly centers: BoolParam;
  readonly maxmin: BoolParam;
  readonly helpdata: MessageParam;
  /** The ids of the objects the effect made. */
  items: string[] = [];
  color = new Color(0x000000ff);
  legacy = false;
  fontsize = 0;
  prevfontsize = 0;
  anotation_width = 0;
  previous_size = 0;
  prevunit = '';
  arrow_gap = 0;
  prevsatellitecount = 0;
  prev_active_projection = false;

  constructor(lpeobject: LivePathEffectObject) {
    super(lpeobject);
    this.unit = new UnitParam(_('Unit'), _('Unit of measurement'), 'unit', this, 'mm');
    this.orientation = new EnumParam(
      _('Orientation'),
      _('Orientation of the line and labels'),
      'orientation',
      OMConverter,
      this,
      OrientationMethod.OM_PARALLEL,
      false,
    );
    this.coloropacity = new ColorPickerParam(
      _('Color and opacity'),
      _('Set color and opacity of the dimensions'),
      'coloropacity',
      this,
      new Color(0x000000ff),
    );
    this.fontbutton = new FontButtonParam(_('Font'), _('Select font for labels'), 'fontbutton', this);
    this.precision = new ScalarParam(
      _('Precision'),
      _('Number of digits after the decimal point'),
      'precision',
      this,
      2,
    );
    this.fix_overlaps = new ScalarParam(
      _('Merge overlaps °'),
      _(
        'Minimum angle at which overlapping dimension lines are merged into one, use 180° to disable merging',
      ),
      'fix_overlaps',
      this,
      0,
    );
    this.position = new ScalarParam(
      _('Position'),
      _('Distance of dimension line from the path'),
      'position',
      this,
      5,
    );
    this.text_top_bottom = new ScalarParam(
      _('Label position'),
      _('Distance of the labels from the dimension line'),
      'text_top_bottom',
      this,
      0,
    );
    this.helpline_distance = new ScalarParam(
      _('Help line distance'),
      _('Distance of the perpendicular lines from the path'),
      'helpline_distance',
      this,
      0.0,
    );
    this.helpline_overlap = new ScalarParam(
      _('Help line elongation'),
      _("Distance of the perpendicular lines' ends from the dimension line"),
      'helpline_overlap',
      this,
      2.0,
    );
    this.line_width = new ScalarParam(
      _('Line width'),
      _('Dimension line width in mm. DIN standard: 0.25 or 0.35 mm'),
      'line_width',
      this,
      0.25,
    );
    this.scale = new ScalarParam(_('Scale'), _('Scaling factor'), 'scale', this, 1.0);
    // TRANSLATORS: Don't translate "{measure}" and "{unit}" variables.
    this.format = new TextParam(
      _('Label format'),
      _('Label text format, available variables: {measure}, {unit}'),
      'format',
      this,
      '{measure}{unit}',
    );
    this.blacklist = new TextParam(
      _('Blacklist segments'),
      _(
        'Comma-separated list of indices of segments that should not be measured. You can use another LPE with different parameters to measure these.',
      ),
      'blacklist',
      this,
      '',
    );
    this.whitelist = new BoolParam(
      _('Invert blacklist'),
      _('Use the blacklist as whitelist'),
      'whitelist',
      this,
      false,
    );
    this.showindex = new BoolParam(
      _('Show segment index'),
      _('Display the index of the segments in the text label for easier blacklisting'),
      'showindex',
      this,
      false,
    );
    this.arrows_outside = new BoolParam(
      _('Arrows outside'),
      _('Draw arrows pointing in the opposite direction outside the dimension line'),
      'arrows_outside',
      this,
      false,
    );
    this.flip_side = new BoolParam(
      _('Flip side'),
      _('Draw dimension lines and labels on the other side of the path'),
      'flip_side',
      this,
      false,
    );
    this.scale_sensitive = new BoolParam(
      _('Scale sensitive'),
      _('When the path is grouped and the group is then scaled, adjust the dimensions.'),
      'scale_sensitive',
      this,
      true,
    );
    this.local_locale = new BoolParam(
      _('Localize number format'),
      _("Use localized number formatting, e.g. '1,0' instead of '1.0' with German locale"),
      'local_locale',
      this,
      true,
    );
    this.rotate_anotation = new BoolParam(
      _('Rotate labels'),
      _('Labels are parallel to the dimension line'),
      'rotate_anotation',
      this,
      true,
    );
    this.hide_back = new BoolParam(
      _('Hide line under label'),
      _('Hide the dimension line where the label overlaps it'),
      'hide_back',
      this,
      true,
    );
    this.hide_arrows = new BoolParam(
      _('Hide arrows'),
      _("Don't show any arrows"),
      'hide_arrows',
      this,
      false,
    );
    // active for 1.1
    this.smallx100 = new BoolParam(
      // The msgid is Pango markup (translations have it); the dialog shows plain text.
      _('Multiply values &lt; 1').replaceAll('&lt;', '<'),
      _('Multiply values smaller than 1 by 100 and leave out the unit'),
      'smallx100',
      this,
      false,
    );
    this.linked_items = new SatelliteArrayParam(
      _('Linked objects:'),
      _('Objects whose nodes are projected onto the path and generate new measurements'),
      'linked_items',
      this,
      true,
    );
    this.distance_projection = new ScalarParam(
      _('Distance'),
      _('Distance of the dimension lines from the outermost node (mm)'),
      'distance_projection',
      this,
      20.0,
    );
    this.angle_projection = new ScalarParam(
      _('Angle of projection'),
      _('Angle of projection in 90° steps'),
      'angle_projection',
      this,
      0.0,
    );
    this.active_projection = new BoolParam(
      _('Activate projection'),
      _('Activate projection mode'),
      'active_projection',
      this,
      false,
    );
    this.avoid_overlapping = new BoolParam(
      _('Avoid label overlap'),
      _('Rotate labels if the segment is shorter than the label'),
      'avoid_overlapping',
      this,
      true,
    );
    this.onbbox = new BoolParam(
      _('Measure bounding box'),
      _('Add measurements for the geometrical bounding box'),
      'onbbox',
      this,
      false,
    );
    this.bboxonly = new BoolParam(
      _('Only bounding box'),
      _('Measure only the geometrical bounding box'),
      'bboxonly',
      this,
      false,
    );
    this.centers = new BoolParam(
      _('Add object center'),
      _('Add the projected object center'),
      'centers',
      this,
      false,
    );
    this.maxmin = new BoolParam(
      _('Only max and min'),
      _('Compute only max/min projection values'),
      'maxmin',
      this,
      false,
    );
    this.helpdata = new MessageParam(_('Help'), _('Measure segments help'), 'helpdata', this, '', '');

    // set to true the parameters you want to be changed his default values
    this.registerParameter(this.unit);
    this.registerParameter(this.orientation);
    this.registerParameter(this.coloropacity);
    this.registerParameter(this.fontbutton);
    this.registerParameter(this.precision);
    this.registerParameter(this.fix_overlaps);
    this.registerParameter(this.position);
    this.registerParameter(this.text_top_bottom);
    this.registerParameter(this.helpline_distance);
    this.registerParameter(this.helpline_overlap);
    this.registerParameter(this.line_width);
    this.registerParameter(this.scale);
    this.registerParameter(this.format);
    this.registerParameter(this.blacklist);
    this.registerParameter(this.active_projection);
    this.registerParameter(this.whitelist);
    this.registerParameter(this.showindex);
    this.registerParameter(this.arrows_outside);
    this.registerParameter(this.flip_side);
    this.registerParameter(this.scale_sensitive);
    this.registerParameter(this.local_locale);
    this.registerParameter(this.rotate_anotation);
    this.registerParameter(this.hide_back);
    this.registerParameter(this.hide_arrows);
    // active for 1.1
    this.registerParameter(this.smallx100);
    this.registerParameter(this.linked_items);
    this.registerParameter(this.distance_projection);
    this.registerParameter(this.angle_projection);
    this.registerParameter(this.avoid_overlapping);
    this.registerParameter(this.onbbox);
    this.registerParameter(this.bboxonly);
    this.registerParameter(this.centers);
    this.registerParameter(this.maxmin);
    this.registerParameter(this.helpdata);

    let format_value = Preferences.get().getString('/live_effects/measure-line/format');
    if (format_value === '') format_value = '{measure}{unit}';
    this.format.param_update_default(format_value);

    this.format.param_hide_canvas_text();
    this.blacklist.param_hide_canvas_text();
    this.precision.param_set_range(0, 100);
    this.precision.param_set_increments(1, 1);
    this.precision.param_set_digits(0);
    this.precision.param_make_integer();
    this.fix_overlaps.param_set_range(0, 180);
    this.fix_overlaps.param_set_increments(1, 1);
    this.fix_overlaps.param_set_digits(0);
    this.fix_overlaps.param_make_integer();
    this.position.param_set_range(-Number.MAX_VALUE, Number.MAX_VALUE);
    this.position.param_set_increments(1, 1);
    this.position.param_set_digits(2);
    this.scale.param_set_range(-Number.MAX_VALUE, Number.MAX_VALUE);
    this.scale.param_set_increments(1, 1);
    this.scale.param_set_digits(4);
    this.text_top_bottom.param_set_range(-Number.MAX_VALUE, Number.MAX_VALUE);
    this.text_top_bottom.param_set_increments(1, 1);
    this.text_top_bottom.param_set_digits(2);
    this.line_width.param_set_range(0, Number.MAX_VALUE);
    this.line_width.param_set_increments(0.1, 0.1);
    this.line_width.param_set_digits(2);
    this.helpline_distance.param_set_range(-Number.MAX_VALUE, Number.MAX_VALUE);
    this.helpline_distance.param_set_increments(1, 1);
    this.helpline_distance.param_set_digits(2);
    this.helpline_overlap.param_set_range(-Number.MAX_VALUE, Number.MAX_VALUE);
    this.helpline_overlap.param_set_increments(1, 1);
    this.helpline_overlap.param_set_digits(2);
    this.distance_projection.param_set_range(-Number.MAX_VALUE, Number.MAX_VALUE);
    this.distance_projection.param_set_increments(1, 1);
    this.distance_projection.param_set_digits(5);
    this.angle_projection.param_set_range(0.0, 360.0);
    this.angle_projection.param_set_increments(90.0, 90.0);
    this.angle_projection.param_set_digits(2);
  }

  /** The unit that upstream gets from the display unit of the document (of the width for legacy documents). */
  #legacyUnit(): string {
    const document = this.getSPDoc();
    return document ? svgLengthUnitAbbr(document.root.width.unit) : 'px';
  }

  /** Length in px per length in the unit of the user units of the document. */
  #docScale(): number {
    return this.getSPDoc()?.getDocumentScale().x ?? 1;
  }

  createArrowMarker(mode: string): void {
    const document = this.getSPDoc();
    if (!document || !this.sp_lpe_item?.getId()) return;
    const lpobjid = this.getLPEObj().getId() ?? '';
    const itemid = this.sp_lpe_item.getId() as string;

    const css = spReprCssAttrNew();
    spReprCssSetPropertyString(css, 'fill', 'context-stroke');
    spReprCssSetPropertyDouble(css, 'fill-opacity', this.coloropacity.get_value().getOpacity());
    spReprCssSetPropertyString(css, 'stroke', 'none');

    const xml_doc = document.getReprDoc();
    const elemref = document.getObjectById(mode);
    if (elemref) {
      const arrow = elemref.getRepr();
      arrow.setAttribute('sodipodi:insensitive', 'true');
      arrow.removeAttribute('transform');
      const arrow_data = arrow.firstChild();
      if (arrow_data) {
        arrow_data.removeAttribute('transform');
        spReprCssChange(arrow_data, css, 'style');
      }
    } else {
      const arrow = xml_doc.createElement('svg:marker');
      arrow.setAttribute('id', mode);
      arrow.setAttribute('class', `${itemid} ${lpobjid} measure-arrow-marker`);
      arrow.setAttributeOrRemoveIfEmpty('inkscape:stockid', mode);
      arrow.setAttribute('orient', 'auto');
      arrow.setAttribute('refX', '0.0');
      arrow.setAttribute('refY', '0.0');

      arrow.setAttribute('sodipodi:insensitive', 'true');
      /* Create <path> */
      const arrow_path = xml_doc.createElement('svg:path');
      if (mode === 'ArrowDIN-start') {
        arrow_path.setAttribute('d', 'M -8,0 8,-2.11 8,2.11 z');
      } else if (mode === 'ArrowDIN-end') {
        arrow_path.setAttribute('d', 'M 8,0 -8,2.11 -8,-2.11 z');
      } else if (mode === 'ArrowDINout-start') {
        arrow_path.setAttribute('d', 'M 0,0 -16,2.11 -16,0.5 -26,0.5 -26,-0.5 -16,-0.5 -16,-2.11 z');
      } else {
        arrow_path.setAttribute('d', 'M 0,0 16,-2.11 16,-0.5 26,-0.5 26,0.5 16,0.5 16,2.11 z');
      }
      arrow_path.setAttributeOrRemoveIfEmpty('class', `${itemid} ${lpobjid} measure-arrow`);
      arrow_path.setAttribute('id', `${mode}_path`);
      spReprCssChange(arrow_path, css, 'style');
      arrow.appendChild(arrow_path);
      document.getDefs()?.appendChildRepr(arrow);
    }
    this.items.push(mode);
  }

  createTextLabel(
    pos: Point,
    counter: number,
    length: number,
    angle: number,
    remove: boolean,
    valid: boolean,
  ): void {
    const document = this.getSPDoc();
    if (!document || !this.sp_lpe_item?.getId()) return;
    const xml_doc = document.getReprDoc();
    const lpobjid = this.getLPEObj().getId() ?? '';
    const itemid = this.sp_lpe_item.getId() as string;
    const id = `text-on-${counter}-${lpobjid}`;
    let elemref = document.getObjectById(id);
    let rtext: Node;
    let rtspan: Node;
    let rstring: Node;
    const classlabel = `${itemid} ${lpobjid} measure-label`;
    if (elemref) {
      if (!(elemref instanceof SPText)) {
        // This is no longer a text object, probably converted to path on export.
        // Don't try to update it!
        return;
      }
      rtext = elemref.getRepr();
      rtext.setAttributeSvgDouble('x', pos.x);
      rtext.setAttributeSvgDouble('y', pos.y);
      rtext.setAttribute('sodipodi:insensitive', 'true');
      rtext.removeAttribute('transform');
      rtspan = rtext.firstChild() as Node;
      rstring = rtspan.firstChild() as Node;
      rtspan.removeAttribute('x');
      rtspan.removeAttribute('y');
      rtext.setAttribute('class', classlabel);
    } else {
      rtext = xml_doc.createElement('svg:text');
      rtext.setAttribute('xml:space', 'preserve');
      rtext.setAttribute('id', id);
      rtext.setAttribute('class', classlabel);
      rtext.setAttribute('sodipodi:insensitive', 'true');
      rtext.removeAttribute('transform');
      rtext.setAttributeSvgDouble('x', pos.x);
      rtext.setAttributeSvgDouble('y', pos.y);
      rtspan = xml_doc.createElement('svg:tspan');
      rtspan.setAttribute('sodipodi:role', 'line');
      rtspan.removeAttribute('x');
      rtspan.removeAttribute('y');
      elemref = document.getRoot().appendChildRepr(rtext);
      rtext.appendChild(rtspan);
      rstring = xml_doc.createTextNode('');
      rtspan.appendChild(rstring);
    }
    const css = spReprCssAttrNew();
    fillCssFromFontSpec(css, this.fontbutton.param_getSVGValue());
    spReprCssSetPropertyString(css, 'fill', this.color.toString(false));
    spReprCssSetPropertyDouble(css, 'fill-opacity', this.color.getOpacity());
    spReprCssSetProperty(css, 'font-size', `${svgNumber(this.fontsize)}px`);
    spReprCssUnsetProperty(css, '-inkscape-font-specification');
    if (remove) spReprCssSetProperty(css, 'display', 'none');
    spReprCssChange(rtext, css, 'style');
    spReprCssChange(rtspan, css, 'style');
    rtspan.removeAttribute('transform');
    if (this.legacy) {
      length = convertUnit(length, this.#legacyUnit(), this.unit.get_abbreviation());
    } else {
      length = convertUnit(length, 'px', this.unit.get_abbreviation()) * this.#docScale();
    }
    // (the number format is always the classic one: no locale in the browser)
    let x100 = false;
    let length_str: string;
    // active for 1.1
    if (this.smallx100.get_value() && length < 1) {
      length *= 100;
      x100 = true;
      length_str = length.toFixed(Math.max(0, this.precision.get_value() - 2));
    } else {
      length_str = length.toFixed(Math.max(0, this.precision.get_value()));
    }
    let label_value = this.format.param_getSVGValue();
    label_value = label_value.replace('{measure}', () => length_str);
    label_value = label_value.replace('{unit}', () => (x100 ? '' : this.unit.get_abbreviation()));

    if (this.showindex.get_value()) label_value = `[${counter}] ${label_value}`;
    if (!valid) label_value = _('Non Uniform Scale');
    rstring.setContent(label_value);
    if (elemref instanceof SPText) {
      elemref.rebuildLayout();
      const bounds = elemref.geometricBounds();
      if (bounds) {
        this.anotation_width = bounds.width();
        rtext.setAttributeSvgDouble('x', pos.x - this.anotation_width / 2.0);
        rtspan.removeAttribute('style');
      }
    }

    let transform = '';
    if (this.rotate_anotation.get_value()) {
      let affine = Translate(pos).inverse();
      angle = normalizeAngle(angle);
      if (angle >= rad_from_deg(90) && angle < rad_from_deg(270)) {
        angle = normalizeAngle(angle + rad_from_deg(180));
      }
      affine = affine.multiply(Rotate(angle)).multiply(Translate(pos));
      transform = sp_svg_transform_write(affine);
    }
    rtext.setAttributeOrRemoveIfEmpty('transform', transform);
  }

  createLine(
    start: Point,
    end: Point,
    name: string,
    counter: number,
    main: boolean,
    remove: boolean,
    _arrows = false,
  ): void {
    const document = this.getSPDoc();
    if (!document || !this.sp_lpe_item?.getId()) return;
    const lpobjid = this.getLPEObj().getId() ?? '';
    const itemid = this.sp_lpe_item.getId() as string;
    const id = `${name}${counter}-${lpobjid}`;
    const xml_doc = document.getReprDoc();
    let elemref = document.getObjectById(id);
    if (!main) {
      const angle = rayAngle(start, end);
      start = start.add(Point.polar(angle, this.helpline_distance.get_value()));
      end = end.add(Point.polar(angle, this.helpline_overlap.get_value()));
    }
    const line_pathv: PathVector = [];

    const k = distance(start, end) / 2.0 - this.anotation_width / 1.7;
    if (
      main &&
      Math.abs(this.text_top_bottom.get_value()) < this.fontsize / 1.5 &&
      this.hide_back.get_value() &&
      k > 0
    ) {
      const angle = rayAngle(end, start);
      const first = new Path(start);
      first.appendCurve(new LineSegment(start, start.sub(Point.polar(angle, k))));
      line_pathv.push(first);
      const second_start = end.add(Point.polar(angle, k));
      const second = new Path(second_start);
      second.appendCurve(new LineSegment(second_start, end));
      line_pathv.push(second);
    } else {
      const line_path = new Path(start);
      line_path.appendCurve(new LineSegment(start, end));
      line_pathv.push(line_path);
    }
    let line: Node;
    if (elemref) {
      line = elemref.getRepr();
      line.setAttribute('d', sp_svg_write_path(line_pathv));
      line.removeAttribute('transform');
    } else {
      line = xml_doc.createElement('svg:path');
      line.setAttributeOrRemoveIfEmpty('id', id);
      if (main) {
        line.setAttribute('class', `${itemid} ${lpobjid} measure-DIM-line measure-line`);
      } else {
        line.setAttribute('class', `${itemid} ${lpobjid} measure-helper-line measure-line`);
      }
      line.setAttribute('d', sp_svg_write_path(line_pathv));
    }

    line.setAttribute('sodipodi:insensitive', 'true');

    let style = '';
    if (remove) style = 'display:none;';
    if (main) {
      line.setAttribute('inkscape:label', 'dinline');
      if (!this.hide_arrows.get_value()) {
        if (this.arrows_outside.get_value()) {
          style += 'marker-start:url(#ArrowDINout-start);marker-end:url(#ArrowDINout-end);';
        } else {
          style += 'marker-start:url(#ArrowDIN-start);marker-end:url(#ArrowDIN-end);';
        }
      }
    } else {
      line.setAttribute('inkscape:label', 'dinhelpline');
    }
    let stroke_width: number;
    if (this.legacy) {
      stroke_width = convertUnit(
        this.line_width.get_value(),
        this.unit.get_abbreviation(),
        this.#legacyUnit(),
      );
    } else {
      stroke_width = convertUnit(this.line_width.get_value(), 'mm', 'px') / this.#docScale();
    }
    style += `stroke-width:${svgNumber(stroke_width)}`;

    const css = spReprCssAttrNew();
    spReprCssAttrAddFromString(css, style);
    spReprCssSetPropertyString(css, 'stroke', this.color.toString(false));
    spReprCssSetPropertyDouble(css, 'stroke-opacity', this.color.getOpacity());
    spReprCssChange(line, css, 'style');

    if (!elemref) elemref = document.getRoot().appendChildRepr(line);
  }

  protected override doOnApply(lpeitem: SPLPEItem): void {
    if (!(lpeitem instanceof SPShape)) {
      console.warn('LPE measure line can only be applied to shapes (not groups).');
      lpeitem.removeCurrentPathEffect(false);
      return;
    }
    const document = this.getSPDoc();
    if (!document) return;
    DocumentUndo.scopedInsensitive(document, () => {
      const root = document.rroot;
      let styleNode: Node | null = null;
      let textNode: Node | null = null;
      for (let i = 0; i < root.childCount(); ++i) {
        const child = root.nthChild(i) as Node;
        if (child.name() === 'svg:style') {
          styleNode = child;
          for (let j = 0; j < child.childCount(); ++j) {
            if ((child.nthChild(j) as Node).type() === 'text') textNode = child.nthChild(j);
          }
          if (textNode === null) {
            // Style element found but does not contain text node!
            console.warn('LPEMeasureSegments::doOnApply(): No text node!');
            textNode = document.getReprDoc().createTextNode('');
            child.appendChild(textNode);
          }
        }
      }

      if (styleNode === null) {
        // Style element not found, create one
        styleNode = document.getReprDoc().createElement('svg:style');
        textNode = document.getReprDoc().createTextNode('');
        root.addChild(styleNode, null);
        styleNode.appendChild(textNode);
      }
      // To fix old measuring files pre 1.0
      let styleContent = textNode?.content() ?? '';
      if (!styleContent.includes('.measure-arrow\n{\n')) {
        styleContent += '\n.measure-arrow\n{\n}';
        styleContent += '\n.measure-label\n{\n\n}';
        styleContent += '\n.measure-line\n{\n}';
        textNode?.setContent(styleContent);
      }
    });
    this.linked_items.update_satellites();
    this.lpeversion.param_setValue('1.3.1', true);
    this.legacy = false;
  }

  /** Whether the segment i is measured: it is not on the blacklist, or on the whitelist (upstream isWhitelist). */
  isWhitelist(i: number, listsegments: string, whitelist: boolean): boolean {
    const found = listsegments.includes(`${i},`);
    return whitelist ? found : !found;
  }

  protected override doOnOpen(_lpeitem: SPLPEItem): boolean {
    if (!this.is_load || this.is_applied) return false;
    if (this.active_projection.get_value()) this.linked_items.start_listening();
    return true;
  }

  /** The first point of the path with the id (upstream extractFirstPoint). */
  #extractFirstPoint(dest: Point, lpobjid: string, prefix: string, idx: number): Point {
    const path = this.getSPDoc()?.getObjectById(`${prefix}${idx}-${lpobjid}`);
    if (path instanceof SPPath) {
      const curve = path.curve();
      const first = curve?.[0];
      if (first) return first.initialPoint();
    }
    return dest;
  }

  protected override doBeforeEffect(lpeitem: SPLPEItem): void {
    if (this.isOnClipboard()) return;
    if (this.is_load) {
      this.legacy = this.lpeversion.param_getSVGValue() < '1.3.1';
      let msg = _(
        '<b><big>General</big></b>\nDisplay and position dimension lines and labels\n\n<b><big>Projection</big></b>\nShow a line with measurements based on the selected items\n\n<b><big>Options</big></b>\nOptions for color, precision, label formatting and display\n\n<b><big>Tips</big></b>\n<b><i>Custom styling:</i></b> To further customize the styles, use the XML editor to find out the class or ID, then use the Style dialog to apply a new style.\n<b><i>Blacklists:</i></b> allow to hide some segments or projection steps.\n<b><i>Multiple Measure LPEs:</i></b> In the same object, in conjunction with blacklists,this allows for labels and measurements with different orientations or additional projections.\n<b><i>Set Defaults:</i></b> For every LPE, default values can be set at the bottom.',
      );
      if (this.legacy) {
        // helpdata is a message parameter, we must not need write this data into the SVG so we empty balue in this legacy files
        this.helpdata.write_to_SVG(); // resert old legacy uneeded data
        msg =
          _(
            '<b><big>IMPORTANT</big></b>\nThis LPE was added in an older version.\nThe LPE will be kept, but we recommend you remove and re-add it for better results.\n',
          ) + msg;
      }
      this.helpdata.param_update_default(msg);
    }
    if (this.linked_items.data().length === 0) {
      this.linked_items.read_from_SVG();
      if (this.linked_items.data().length > 0) this.linked_items.update_satellites();
    }
    const splpeitem = lpeitem;
    const lpobjid = this.getLPEObj().getId() ?? '';
    const document = this.getSPDoc();
    if (!document) return;
    let active = this.linked_items.data().length === 0;
    for (const lpereference of this.linked_items.data()) {
      if (lpereference.isAttached() && lpereference.getObject() !== null) active = true;
    }
    if (!active && !this.is_load && this.prev_active_projection) {
      this.linked_items.clear();
      this.prevsatellitecount = 0;
      return;
    }
    this.prev_active_projection = this.active_projection.get_value();
    // Avoid crashes on previews
    let fontsizechanged = false;
    const parentaffinetransform = i2anc_affine(lpeitem.parent, document.getRoot());
    const affinetransform = i2anc_affine(lpeitem, document.getRoot());
    const itemtransform = affinetransform.multiply(parentaffinetransform.inverse());
    //// Projection prepare
    let pathvector: PathVector = [];
    const nodes: Point[] = [];
    if (this.active_projection.get_value()) {
      const bbox = this.sp_lpe_item?.geometricBounds();
      if (bbox) {
        const mid = bbox.midpoint();
        const angle = rad_from_deg(this.angle_projection.get_value());
        const unrotate = (m: Affine) =>
          m.multiply(Translate(mid).inverse()).multiply(Rotate(angle).inverse()).multiply(Translate(mid));
        const onbbox = this.onbbox.get_value();
        const centers = this.centers.get_value();
        const bboxonly = this.bboxonly.get_value();
        const angle_projection = this.angle_projection.get_value();
        nodes.push(
          ...getNodes(splpeitem, unrotate(itemtransform), onbbox, centers, bboxonly, angle_projection),
        );
        const satellites = this.linked_items.data();
        if (satellites.length !== this.prevsatellitecount) {
          this.prevsatellitecount = satellites.length;
          if (this.sp_lpe_item) sp_lpe_item_update_patheffect(this.sp_lpe_item, false, false, true);
        }
        this.prevsatellitecount = satellites.length;
        for (const iter of satellites) {
          const obj = iter.getObject();
          if (iter.isAttached() && iter.getActive() && obj instanceof SPItem) {
            const affinetransform_sub = i2anc_affine(obj, document.getRoot());
            const transform = affinetransform_sub
              .multiply(Translate(mid.neg()))
              .multiply(Rotate(angle).inverse())
              .multiply(Translate(mid));
            nodes.push(...getNodes(obj, transform, onbbox, centers, bboxonly, angle_projection));
          }
        }

        let maxdistance = -Number.MAX_VALUE;
        const result: number[] = [];
        for (const point of nodes) {
          if (point.x > maxdistance) maxdistance = point.x;
          result.push(point.y);
        }
        let dproj: number;
        if (this.legacy) {
          dproj = convertUnit(
            this.distance_projection.get_value(),
            this.#legacyUnit(),
            this.unit.get_abbreviation(),
          );
        } else {
          dproj = convertUnit(this.distance_projection.get_value(), 'mm', 'px') * this.#docScale();
        }
        const xpos = maxdistance + dproj;
        result.sort((a, b) => a - b);
        let path = new Path();
        let prevpoint = new Point(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
        let started = false;
        let point = new Point();
        for (const iter of result) {
          point = new Point(xpos, iter);
          if (are_near(prevpoint, point)) continue;
          if (!started) {
            path = new Path(point);
            started = true;
          } else if (!this.maxmin.get_value()) {
            path.appendCurve(new LineSegment(path.finalPoint(), point));
          }
          prevpoint = point;
        }
        if (this.maxmin.get_value()) path.appendCurve(new LineSegment(path.finalPoint(), point));
        pathvector.push(path);
        const back = Translate(mid.neg()).multiply(Rotate(angle)).multiply(Translate(mid));
        pathvector = pathvector.map((p) => p.transformed(back));
      }
    }

    //// end projection prepare
    if (!(splpeitem instanceof SPShape)) return;
    const opacity = this.coloropacity.get_value();
    const colorchanged = !opacity.equals(this.color);
    this.color = opacity.clone();
    const currentunit = this.unit.get_abbreviation();
    const unitchanged = currentunit !== this.prevunit;
    this.prevunit = currentunit;
    const newfontsize = fontSizePt(this.fontbutton.param_getSVGValue());
    if (this.legacy) {
      this.fontsize = convertUnit(newfontsize, 'pt', this.#legacyUnit());
    } else {
      this.fontsize = convertUnit(newfontsize, 'pt', 'px') / this.#docScale();
    }
    if (newfontsize !== this.prevfontsize) fontsizechanged = true;
    this.prevfontsize = newfontsize;
    let prev_stored = new Point(0, 0);
    let start_stored = new Point(0, 0);
    let end_stored = new Point(0, 0);
    let next_stored = new Point(0, 0);
    if (!this.active_projection.get_value()) {
      const c = splpeitem.curve() ?? [];
      pathvector = pathv_to_linear_and_cubic_beziers(c).map((p) => p.transformed(affinetransform));
    }
    if (this.format.param_getSVGValue() === '') this.format.param_setValue('{measure}{unit}');
    const ncurves = PV.curveCount(pathvector);
    this.items = [];
    let start_angle_cross = 0;
    let end_angle_cross = 0;
    let counter = -1;
    let previous_fix_overlaps = true;
    const position = this.position.get_value();
    const flip_side = this.flip_side.get_value();
    for (let i = 0; i < pathvector.length; i++) {
      const pathi = pathvector[i] as Path;
      let count = pathi.size();
      if (!pathi.empty() && pathi.closed()) {
        const closingline = pathi.closingSegment();
        if (are_near(closingline.initialPoint(), closingline.finalPoint())) count = pathi.sizeOpen();
      }
      for (let j = 0; j < count; j++) {
        counter++;
        const fix_overlaps_degree = Math.trunc(this.fix_overlaps.get_value());
        let prev = new Point(0, 0);
        if (j === 0 && pathi.closed()) {
          prev = pathvectorPointAt(pathvector, pathi.size() - 1);
        } else if (j !== 0) {
          prev = pathi.pointAt(j - 1);
        }
        let start = pathi.pointAt(j);
        let end = pathi.pointAt(j + 1);
        let next = new Point(0, 0);
        if (pathi.closed() && pathi.size() === j + 1) {
          end = pathi.pointAt(0);
          next = pathi.pointAt(1);
        } else if (pathi.size() > j + 1) {
          next = pathi.pointAt(j + 2);
        }
        const listsegments = `${this.blacklist.param_getSVGValue()},`.replaceAll(' ', '');
        if (this.isWhitelist(counter, listsegments, this.whitelist.get_value()) && !are_near(start, end)) {
          prev_stored = this.#extractFirstPoint(prev_stored, lpobjid, 'infoline-on-start-', counter - 1);
          start_stored = this.#extractFirstPoint(start_stored, lpobjid, 'infoline-on-start-', counter);
          end_stored = this.#extractFirstPoint(end_stored, lpobjid, 'infoline-on-end-', counter);
          next_stored = this.#extractFirstPoint(next_stored, lpobjid, 'infoline-on-start-', counter + 1);
          this.items.push(
            `infoline-on-start-${counter}-${lpobjid}`,
            `infoline-on-end-${counter}-${lpobjid}`,
            `infoline-${counter}-${lpobjid}`,
            `text-on-${counter}-${lpobjid}`,
          );
          if (!this.hide_arrows.get_value()) {
            if (this.arrows_outside.get_value()) {
              this.items.push('ArrowDINout-start', 'ArrowDINout-end');
            } else {
              this.items.push('ArrowDIN-start', 'ArrowDIN-end');
            }
          }
          if (
            ((are_near(prev, prev_stored, 0.01) && are_near(next, next_stored, 0.01)) ||
              fix_overlaps_degree === 180) &&
            are_near(start, start_stored, 0.01) &&
            are_near(end, end_stored, 0.01) &&
            !this.refresh_widgets &&
            !colorchanged &&
            !unitchanged &&
            !fontsizechanged &&
            !this.is_load &&
            !this.is_applied &&
            this.anotation_width
          ) {
            continue;
          }
          let hstart = start;
          let hend = end;
          let remove = false;
          const orientation = this.orientation.get_value();
          if (orientation === OrientationMethod.OM_VERTICAL) {
            let xpos = Math.max(hstart.x, hend.x);
            if (flip_side) xpos = Math.min(hstart.x, hend.x);
            hstart = new Point(xpos, hstart.y);
            hend = new Point(xpos, hend.y);
            if (hstart.y > hend.y) {
              [hstart, hend] = [hend, hstart];
              [start, end] = [end, start];
            }
            if (are_near(hstart.y, hend.y)) remove = true;
          } else if (orientation === OrientationMethod.OM_HORIZONTAL) {
            let ypos = Math.max(hstart.y, hend.y);
            if (flip_side) ypos = Math.min(hstart.y, hend.y);
            hstart = new Point(hstart.x, ypos);
            hend = new Point(hend.x, ypos);
            if (hstart.x < hend.x) {
              [hstart, hend] = [hend, hstart];
              [start, end] = [end, start];
            }
            if (are_near(hstart.x, hend.x)) remove = true;
          } else if (fix_overlaps_degree !== 180) {
            start_angle_cross = getAngle(start, prev, end, flip_side, fix_overlaps_degree);
            if (prev.equals(new Point(0, 0))) start_angle_cross = 0;
            end_angle_cross = getAngle(end, start, next, flip_side, fix_overlaps_degree);
            if (next.equals(new Point(0, 0))) end_angle_cross = 0;
          }
          if (remove) {
            this.#removeSegmentObjects(counter);
            continue;
          }
          let angle = rayAngle(hstart, hend);
          if (flip_side) angle = normalizeAngle(angle + rad_from_deg(180));
          const angle_cross = normalizeAngle(angle + rad_from_deg(90));
          angle = normalizeAngle(angle);
          const turn = rad_from_deg(-90);
          if (flip_side) {
            end_angle_cross *= -1;
            start_angle_cross *= -1;
          }
          const position_turned_start = position / Math.sin(start_angle_cross / 2.0);
          let length = distance(start, end);
          if (
            fix_overlaps_degree !== 180 &&
            start_angle_cross !== 0 &&
            position_turned_start < length &&
            previous_fix_overlaps
          ) {
            hstart = hstart.sub(
              Point.polar(angle_cross - start_angle_cross / 2.0 - turn, position_turned_start),
            );
          } else {
            hstart = hstart.sub(Point.polar(angle_cross, position));
          }
          this.createLine(start, hstart, 'infoline-on-start-', counter, false, false);
          const position_turned_end = position / Math.sin(end_angle_cross / 2.0);
          const endlength = distance(end, next);
          if (
            fix_overlaps_degree !== 180 &&
            end_angle_cross !== 0 &&
            position_turned_end < length &&
            position_turned_end < endlength
          ) {
            hend = hend.sub(Point.polar(angle_cross + end_angle_cross / 2.0 + turn, position_turned_end));
            previous_fix_overlaps = true;
          } else {
            hend = hend.sub(Point.polar(angle_cross, position));
            previous_fix_overlaps = false;
          }
          length = distance(start, end) * this.scale.get_value();
          let pos = middle_point(hstart, hend);
          if (!this.hide_arrows.get_value()) {
            if (this.arrows_outside.get_value()) {
              this.createArrowMarker('ArrowDINout-start');
              this.createArrowMarker('ArrowDINout-end');
            } else {
              this.createArrowMarker('ArrowDIN-start');
              this.createArrowMarker('ArrowDIN-end');
            }
          }
          const text_offset = this.text_top_bottom.get_value() + this.fontsize / 2.5;
          if (angle >= rad_from_deg(90) && angle < rad_from_deg(270)) {
            pos = pos.sub(Point.polar(angle_cross, text_offset));
          } else {
            pos = pos.add(Point.polar(angle_cross, text_offset));
          }
          const parents_scale =
            (parentaffinetransform.expansionX() + parentaffinetransform.expansionY()) / 2.0;
          if (!this.scale_sensitive.get_value()) length /= parents_scale;
          if (this.anotation_width / 2 > distance(hstart, hend) / 2.0) {
            if (this.avoid_overlapping.get_value()) {
              pos = pos.sub(Point.polar(angle_cross, position + this.anotation_width / 2.0));
              angle += rad_from_deg(90);
            } else {
              pos = pos.sub(Point.polar(angle_cross, position));
            }
          }
          if (!this.scale_sensitive.get_value() && !parentaffinetransform.preservesAngles()) {
            this.createTextLabel(pos, counter, length, angle, remove, false);
          } else {
            this.createTextLabel(pos, counter, length, angle, remove, true);
          }
          if (this.legacy) {
            this.arrow_gap =
              8 * convertUnit(this.line_width.get_value(), this.unit.get_abbreviation(), this.#legacyUnit());
          } else {
            this.arrow_gap = (8 * convertUnit(this.line_width.get_value(), 'mm', 'px')) / this.#docScale();
          }
          if (flip_side) this.arrow_gap *= -1;
          if (this.hide_arrows.get_value()) this.arrow_gap *= 0;
          this.createLine(end, hend, 'infoline-on-end-', counter, false, false);
          if (!this.arrows_outside.get_value()) {
            hstart = hstart.add(Point.polar(angle, this.arrow_gap));
            hend = hend.sub(Point.polar(angle, this.arrow_gap));
          }
          if (distance(hstart, hend) / 2.0 > this.anotation_width / 1.9 + this.arrow_gap) {
            this.createLine(hstart, hend, 'infoline-', counter, true, false, true);
          } else {
            this.createLine(hstart, hend, 'infoline-', counter, true, true, true);
          }
        } else {
          this.#removeSegmentObjects(counter);
        }
      }
    }
    if (this.previous_size) {
      for (let c = ncurves; c < this.previous_size; c++) this.#removeSegmentObjects(c);
    }
    this.previous_size = ncurves;
  }

  /** Hide the lines and the label of a segment (upstream createLine/createTextLabel with remove at the origin). */
  #removeSegmentObjects(counter: number): void {
    const pos = new Point();
    this.createLine(pos, pos, 'infoline-', counter, true, true, true);
    this.createLine(pos, pos, 'infoline-on-start-', counter, true, true, true);
    this.createLine(pos, pos, 'infoline-on-end-', counter, true, true, true);
    this.createTextLabel(pos, counter, 0, 0, true, true);
  }

  /** The objects are made again when a parameter was written (the dialog's update; upstream: refresh_widgets). */
  override onParamWidgetChanged(_param: Parameter): void {
    this.refresh_widgets = true;
  }

  /** The path is not changed. */
  override doEffect(curve: PathVector): PathVector {
    return curve;
  }

  override doOnVisibilityToggled(_lpeitem: SPLPEItem): void {
    this.processObjects(LPEAction.LPE_VISIBILITY);
  }

  protected override doOnRemove(_lpeitem: SPLPEItem | null): void {
    // set "keep paths" hook on sp-lpe-item
    if (this.keep_paths) {
      this.processObjects(LPEAction.LPE_TO_OBJECTS);
      this.items = [];
      return;
    }
    this.processObjects(LPEAction.LPE_ERASE);
    this.items = [];
  }

  /** We override processObjects because the objects of the effect are not selectable and do not give any issues. */
  override processObjects(lpe_action: LPEAction): void {
    if (lpe_action === LPEAction.LPE_UPDATE && this._lpe_action !== LPEAction.LPE_ERASE) {
      this._lpe_action = lpe_action;
      return;
    }
    const document = this.getSPDoc();
    const first = this.getLPEObj().hrefList[0];
    if (!document || !first || !('path_effect_list' in first)) return;
    const lpeitem = first as SPLPEItem;
    this.sp_lpe_item = lpeitem;
    sp_lpe_item_enable_path_effects(lpeitem, false);
    for (const id of this.items) {
      const elemref = document.getObjectById(id);
      if (!elemref) continue;
      const elemnode = elemref.getRepr();
      const item = elemref instanceof SPItem ? elemref : null;
      switch (lpe_action) {
        case LPEAction.LPE_TO_OBJECTS:
          if (!item) break;
          if (item.isHidden()) {
            item.deleteObject(true);
          } else {
            elemnode.removeAttribute('sodipodi:insensitive');
            if (item.parent && item.parent.getRepr().name() !== 'svg:defs') {
              const trans = i2anc_affine(lpeitem.parent, document.getRoot());
              item.transform = item.transform.multiply(trans.inverse());
              item.doWriteTransform(item.transform);
              moveToAfter(item, lpeitem);
            }
          }
          break;

        case LPEAction.LPE_ERASE:
          elemref.deleteObject(true);
          break;

        case LPEAction.LPE_VISIBILITY: {
          const css = spReprCssAttrNew();
          spReprCssAttrAddFromString(css, elemnode.attribute('style'));
          if (!this.isVisible()) css.setAttribute('display', 'none');
          else css.removeAttribute('display');
          elemnode.setAttributeOrRemoveIfEmpty('style', spReprCssWriteString(css));
          break;
        }

        default:
          break;
      }
    }
    if (lpe_action === LPEAction.LPE_ERASE || lpe_action === LPEAction.LPE_TO_OBJECTS) this.items = [];
    sp_lpe_item_enable_path_effects(lpeitem, true);
  }
}
