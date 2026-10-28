// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-grid.cpp, src/object/sp-grid.h
/*
 * Inkscape SPGrid implementation
 *
 * Authors:
 * James Ferrarelli
 * Johan Engelen <johan@shouraizou.nl>
 * Lauris Kaplinski
 * Abhishek Sharma
 * Jon A. Cruz <jon@joncruz.org>
 * Tavmong Bah <tavmjong@free.fr>
 * see git history
 *
 * Copyright (C) 2022 Authors
 */
import { Point } from '@inkscape-web/geom';
import { SPAttr } from '../attributes.ts';
import { Color } from '../colors/color.ts';
import type { SPDocument } from '../document.ts';
import { _ } from '../i18n.ts';
import { Preferences } from '../preferences.ts';
import { SVGBool } from '../svg/svg-bool.ts';
import { convertUnit, getUnit, SVGLength } from '../svg/svg-length.ts';
import { Signal } from '../util/signal.ts';
import type { Node } from '../xml/node.ts';
import { SPObject } from './sp-object.ts';

export enum GridType {
  RECTANGULAR,
  AXONOMETRIC,
  MODULAR,
}

// default colors
const GRID_DEFAULT_MAJOR_COLOR = 0x0099e54d;
const GRID_DEFAULT_MINOR_COLOR = 0x0099e526;

function readGridType(value: string | null): GridType | null {
  if (value === 'xygrid') return GridType.RECTANGULAR;
  if (value === 'axonomgrid') return GridType.AXONOMETRIC;
  if (value === 'modular') return GridType.MODULAR;
  return null;
}

/** Parse a color attribute, or the default; keeps opacity like upstream. */
function readColor(value: string | null, def: number, opacity: number): Color {
  const c = Color.parse(value) ?? new Color(def);
  c.setOpacity(opacity);
  return c;
}

/**
 * A grid (inkscape:grid in the namedview). Origin and spacing are stored in
 * user units (viewBox units); getEffectiveOriginAndSpacing() gives them in
 * desktop px. The editor shows the grid with canvas items and snaps to it;
 * changedSignal tells them to update.
 * TODO: axonometric and modular grids are read, but only the rectangular grid is drawn and snapped.
 */
export class SPGrid extends SPObject {
  _visible = new SVGBool(true);
  _enabled = new SVGBool(true);
  _dotted = new SVGBool(false);
  _snap_to_visible_only = new SVGBool(true);
  _legacy = false;
  _angle_y_vertical = new SVGBool(true);
  _origin_x = new SVGLength();
  _origin_y = new SVGLength();
  _spacing_x = new SVGLength();
  _spacing_y = new SVGLength();
  _angle_x = new SVGLength();
  _angle_z = new SVGLength();
  _gap_x = new SVGLength();
  _gap_y = new SVGLength();
  _margin_x = new SVGLength();
  _margin_y = new SVGLength();
  _major_color = new Color(GRID_DEFAULT_MAJOR_COLOR);
  _minor_color = new Color(GRID_DEFAULT_MINOR_COLOR);
  _major_line_interval = 5;
  _grid_type = GridType.RECTANGULAR;
  /** The unit abbreviation shown in the UI (units attribute). */
  _display_unit = 'px';

  /** Emitted when an attribute changed (the views redraw, the snapper follows). */
  readonly changedSignal = new Signal<[]>();

  /** Append a new grid of type to parent (the namedview repr), with the values from the preferences. */
  static create_new(document: SPDocument, parent: Node, type: GridType): SPGrid | null {
    const new_node = document.getReprDoc().createElement('inkscape:grid');
    if (type === GridType.AXONOMETRIC) new_node.setAttribute('type', 'axonomgrid');
    else if (type === GridType.MODULAR) new_node.setAttribute('type', 'modular');
    else new_node.setAttribute('type', 'xygrid');
    parent.appendChild(new_node);
    const new_grid = document.getObjectByRepr(new_node);
    if (!(new_grid instanceof SPGrid)) return null;
    new_grid.setPrefValues();
    new_grid.setEnabled(true);
    new_grid.setVisible(true);
    return new_grid;
  }

  protected override build(document: SPDocument, repr: Node): void {
    super.build(document, repr);
    for (const key of [
      SPAttr.TYPE,
      SPAttr.UNITS,
      SPAttr.ORIGINX,
      SPAttr.ORIGINY,
      SPAttr.SPACINGX,
      SPAttr.SPACINGY,
      SPAttr.ANGLE_X,
      SPAttr.ANGLE_Z,
      SPAttr.ANGLE_Y_VERTICAL,
      SPAttr.GAP_X,
      SPAttr.GAP_Y,
      SPAttr.MARGIN_X,
      SPAttr.MARGIN_Y,
      SPAttr.COLOR,
      SPAttr.EMPCOLOR,
      SPAttr.OPACITY,
      SPAttr.EMPOPACITY,
      SPAttr.VISIBLE,
      SPAttr.ENABLED,
      SPAttr.MAJOR_LINE_INTERVAL,
      SPAttr.DOTTED,
      SPAttr.SNAP_TO_VISIBLE_ONLY,
    ]) {
      this.readAttr(key);
    }
    this.#checkOldGrid(repr);
  }

  override set(key: SPAttr, value: string | null): void {
    switch (key) {
      case SPAttr.TYPE:
        this._grid_type = readGridType(value) ?? GridType.RECTANGULAR; // default
        break;
      case SPAttr.UNITS:
        if (value && getUnit(value).abbr === value) this._display_unit = value;
        break;
      case SPAttr.ORIGINX:
        this._origin_x.read(value);
        break;
      case SPAttr.ORIGINY:
        this._origin_y.read(value);
        break;
      case SPAttr.SPACINGX:
        this._spacing_x.read(value);
        break;
      case SPAttr.SPACINGY:
        this._spacing_y.read(value);
        break;
      case SPAttr.ANGLE_X: // only meaningful for axonomgrid
        this._angle_x.read(value);
        break;
      case SPAttr.ANGLE_Z: // only meaningful for axonomgrid
        this._angle_z.read(value);
        break;
      case SPAttr.ANGLE_Y_VERTICAL: // only meaningful for axonomgrid
        this._angle_y_vertical.read(value);
        break;
      case SPAttr.GAP_X: // only meaningful for modular
        this._gap_x.read(value);
        break;
      case SPAttr.GAP_Y: // only meaningful for modular
        this._gap_y.read(value);
        break;
      case SPAttr.MARGIN_X: // only meaningful for modular
        this._margin_x.read(value);
        break;
      case SPAttr.MARGIN_Y: // only meaningful for modular
        this._margin_y.read(value);
        break;
      case SPAttr.COLOR:
        this._minor_color = readColor(value, GRID_DEFAULT_MINOR_COLOR, this._minor_color.getOpacity());
        break;
      case SPAttr.EMPCOLOR:
        this._major_color = readColor(value, GRID_DEFAULT_MAJOR_COLOR, this._major_color.getOpacity());
        break;
      case SPAttr.VISIBLE:
        this._visible.readOrUnset(value);
        break;
      case SPAttr.ENABLED:
        this._enabled.readOrUnset(value);
        break;
      case SPAttr.OPACITY:
        this._minor_color.setOpacity(value ? Number.parseFloat(value) : 1.0);
        break;
      case SPAttr.EMPOPACITY:
        this._major_color.setOpacity(value ? Number.parseFloat(value) : 1.0);
        break;
      case SPAttr.MAJOR_LINE_INTERVAL:
        this._major_line_interval = value ? Math.max(Number.parseInt(value, 10) || 1, 1) : 5;
        break;
      case SPAttr.DOTTED: // only meaningful for rectangular grid
        this._dotted.readOrUnset(value);
        break;
      case SPAttr.SNAP_TO_VISIBLE_ONLY:
        this._snap_to_visible_only.readOrUnset(value);
        break;
      default:
        super.set(key, value);
        return;
    }
    this.changedSignal.emit();
  }

  /**
   * Convert the attributes of grids from before 0.46 (gridoriginx, ... on the
   * namedview) and fix grids of 1.2 without spacing, units or origin.
   * TODO: the conversion of pre-0.46 grids.
   */
  #checkOldGrid(repr: Node): void {
    if (!repr.attribute('id')) return;
    const fix = (attr: string, value: string) => {
      if (repr.attribute(attr)) return;
      repr.setAttribute(attr, value);
      this.readAttr(attr);
    };
    const scale = this.document.getDocumentScale();
    fix('originx', '0');
    fix('originy', '0');
    fix('spacingy', String(1 / scale.y));
    switch (this._grid_type) {
      case GridType.RECTANGULAR:
        fix('spacingx', String(1 / scale.x));
        break;
      case GridType.AXONOMETRIC:
        fix('gridanglex', '30');
        fix('gridanglez', '30');
        break;
      default:
        break;
    }
    const unit = Preferences.get().getString(`/options/grids/${this.getSVGType()}/units`);
    this.setUnit(unit || 'px');
  }

  /**
   * Initialize the grid from the user preferences (/options/grids/xy, axonom, modular),
   * when a grid is created by Document Properties or the namedview.
   */
  setPrefValues(): void {
    const prefs = Preferences.get();
    const prefix =
      this._grid_type === GridType.AXONOMETRIC
        ? '/options/grids/axonom'
        : this._grid_type === GridType.MODULAR
          ? '/options/grids/modular'
          : '/options/grids/xy';
    const modular = this._grid_type === GridType.MODULAR;
    const display_unit = this.document.getNamedView().getDisplayUnit();
    const unit_pref = prefs.getString(`${prefix}/units`, display_unit);
    this.setUnit(unit_pref);

    // Origin and Spacing are the only two properties that vary depending on selected units
    // SPGrid should only store values in document units, convert whatever preferences are set to "px"
    // and then scale "px" to the document unit.
    const scale = this.document.getDocumentScale();
    const px = (path: string, def = 0) => convertUnit(prefs.getDouble(path, def), unit_pref, 'px');
    this.setOrigin(new Point(px(`${prefix}/origin_x`) / scale.x, px(`${prefix}/origin_y`) / scale.y));
    const default_spacing = modular ? 100.0 : 1.0;
    this.setSpacing(
      new Point(
        px(`${prefix}/spacing_x`, default_spacing) / scale.x,
        px(`${prefix}/spacing_y`, default_spacing) / scale.y,
      ),
    );
    this.setMajorColor(
      Color.parse(prefs.getString(`${prefix}/empcolor`, modular ? '#0047cb4d' : '#0099e54d')) ??
        new Color(GRID_DEFAULT_MAJOR_COLOR),
    );
    this.setMinorColor(
      Color.parse(prefs.getString(`${prefix}/color`, modular ? '#0047cb26' : '#0099e526')) ??
        new Color(GRID_DEFAULT_MINOR_COLOR),
    );
    this.setMajorLineInterval(prefs.getInt(`${prefix}/empspacing`, 5));
    // TODO: the axonometric angles and the modular gaps and margins.
  }

  /**
   * Origin and spacing in desktop px, with the document scale applied.
   * index selects one of the rectangular grids that a modular grid is made of
   * (-1 for a rectangular grid). A spacing of (0, 0) means: skip.
   */
  getEffectiveOriginAndSpacing(index = -1): { origin: Point; spacing: Point } {
    let origin = this.getOrigin();
    let spacing = this.getSpacing();
    const gap = new Point(this._gap_x.computed, this._gap_y.computed);
    const size = spacing;
    if (index >= 0) spacing = spacing.add(gap);
    // modular grid snapping can be supported by making it look like a series of rectangular grids (up to 4)
    const margin = new Point(this._margin_x.computed, this._margin_y.computed);
    switch (index) {
      case -1: // rectangular grid case
        break;
      case 0: // modular: left/top edge
        origin = origin.add(gap.div(2));
        break;
      case 1: // modular: right/bottom edge
        origin = origin.add(gap.div(2)).add(size);
        break;
      case 2: // modular: left/top with margin
        if (margin.x || margin.y) origin = origin.add(gap.div(2)).sub(margin);
        else spacing = new Point(0, 0);
        break;
      case 3: // modular: right/bottom with margin
        if (margin.x || margin.y) origin = origin.add(gap.div(2)).add(size).add(margin);
        else spacing = new Point(0, 0);
        break;
      default: // end of sequence
        spacing = new Point(0, 0);
        break;
    }
    const MIN_VAL = 0.00001;
    if (spacing.x < MIN_VAL || spacing.y < MIN_VAL) {
      // too small a spacing can choke snapping; skip
      spacing = new Point(0, 0);
    } else {
      const scale = this.document.getDocumentScale();
      origin = origin.scaled(scale);
      spacing = spacing.scaled(scale);
    }
    // TODO: the origin of the selected page (getSelectedPageOriginAffine).
    return { origin, spacing };
  }

  displayName(): string {
    switch (this._grid_type) {
      case GridType.AXONOMETRIC:
        return _('Axonometric Grid');
      case GridType.MODULAR:
        return _('Modular Grid');
      default:
        return _('Rectangular Grid');
    }
  }

  getSVGType(): string {
    switch (this._grid_type) {
      case GridType.AXONOMETRIC:
        return 'axonomgrid';
      case GridType.MODULAR:
        return 'modular';
      default:
        return 'xygrid';
    }
  }

  getType(): GridType {
    return this._grid_type;
  }

  isVisible(): boolean {
    return this.isEnabled() && this._visible.value;
  }
  setVisible(v: boolean): void {
    this.repr.setAttributeBoolean('visible', v);
  }
  isEnabled(): boolean {
    return this._enabled.value;
  }
  setEnabled(v: boolean): void {
    this.repr.setAttributeBoolean('enabled', v);
  }

  /** The origin in user units (upstream: "px", which are user units). */
  getOrigin(): Point {
    return new Point(this._origin_x.computed, this._origin_y.computed);
  }
  setOrigin(new_origin: Point): void {
    this.repr.setAttributeSvgDouble('originx', new_origin.x);
    this.repr.setAttributeSvgDouble('originy', new_origin.y);
  }
  /** The spacing in user units. */
  getSpacing(): Point {
    return new Point(this._spacing_x.computed, this._spacing_y.computed);
  }
  setSpacing(spacing: Point): void {
    this.repr.setAttributeSvgDouble('spacingx', spacing.x);
    this.repr.setAttributeSvgDouble('spacingy', spacing.y);
  }

  getMajorColor(): Color {
    return this._major_color.clone();
  }
  setMajorColor(color: Color): void {
    this.repr.setAttribute('empcolor', color.toString(false));
    this.repr.setAttributeSvgDouble('empopacity', color.getOpacity());
  }
  getMinorColor(): Color {
    return this._minor_color.clone();
  }
  setMinorColor(color: Color): void {
    this.repr.setAttribute('color', color.toString(false));
    this.repr.setAttributeSvgDouble('opacity', color.getOpacity());
  }

  getMajorLineInterval(): number {
    return this._major_line_interval;
  }
  setMajorLineInterval(interval: number): void {
    this.repr.setAttributeInt('empspacing', interval);
  }

  getDotted(): boolean {
    return this._dotted.value;
  }
  setDotted(v: boolean): void {
    this.repr.setAttributeBoolean('dotted', v);
  }

  getSnapToVisibleOnly(): boolean {
    return this._snap_to_visible_only.value;
  }
  setSnapToVisibleOnly(v: boolean): void {
    this.repr.setAttributeBoolean('snapvisiblegridlinesonly', v);
  }

  getAngleX(): number {
    return this._angle_x.computed;
  }
  getAngleZ(): number {
    return this._angle_z.computed;
  }

  getUnit(): string {
    return this._display_unit;
  }
  setUnit(units: string): void {
    if (!units || getUnit(units).abbr !== units) return;
    this.repr.setAttribute('units', units);
    this._display_unit = units;
  }

  typeName(): string {
    switch (this._grid_type) {
      case GridType.AXONOMETRIC:
        return 'grid-axonometric';
      case GridType.MODULAR:
        return 'grid-modular';
      default:
        return 'grid-rectangular';
    }
  }
}
