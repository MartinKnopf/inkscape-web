// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-namedview.cpp, src/object/sp-namedview.h, src/page-manager.cpp
/*
 * <sodipodi:namedview> parser
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   bulia byak <buliabyak@users.sf.net>
 *   Johan Engelen <j.b.c.engelen@ewi.utwente.nl>
 *   Abhishek Sharma
 *
 * Copyright (C) 2000-2002 Lauris Kaplinski
 * Copyright (C) 2000-2001 Ximian, Inc.
 * Copyright (C) 2006-2008 Johan Engelen
 */
import { are_near } from '@inkscape-web/geom';
import { SPAttr } from '../attributes.ts';
import { Color } from '../colors/color.ts';
import type { SPDocument } from '../document.ts';
import { DocumentUndo } from '../document-undo.ts';
import { SVGBool } from '../svg/svg-bool.ts';
import { getUnit, UnitType } from '../svg/svg-length.ts';
import { Signal } from '../util/signal.ts';
import type { XmlDocument } from '../xml/document.ts';
import type { Node } from '../xml/node.ts';
import { GridType, SPGrid } from './sp-grid.ts';
import { SPGuide } from './sp-guide.ts';
import { SP_OBJECT_WRITE_EXT, SPObject } from './sp-object.ts';

const DEFAULT_DESK_COLOR = new Color(0xd1d1d1ff, false);
/** Upstream CanvasPage::DEFAULT_BACKGROUND_COLOR and DEFAULT_BORDER_COLOR. */
const DEFAULT_BACKGROUND_COLOR = new Color(0xffffffff);
const DEFAULT_BORDER_COLOR = new Color(0x0000001a);
const DEFAULT_GUIDE_COLOR = new Color(0x0086e5ff, false);
const DEFAULT_GUIDE_HI_COLOR = new Color(0xff0000ff, false);

/**
 * Display unit from inkscape:document-units: absolute units only, else px
 * (upstream sp_parse_document_units).
 */
export function sp_parse_document_units(value: string | null): string {
  if (!value) return 'px';
  const unit = getUnit(value);
  if (unit.abbr !== value) {
    console.warn(`Unrecognized unit \`${value}'`);
    return 'px';
  }
  if (unit.type !== UnitType.LINEAR) {
    console.warn(`Document units must be absolute like \`mm', \`pt' or \`px', but found \`${value}'`);
    return 'px';
  }
  return value;
}

/**
 * The sodipodi:namedview element: per-document view settings. Upstream keeps
 * the page attributes (page color, border) in PageManager::subset(); they are
 * held here.
 * The guides and grids are its children; the snap tolerances (in screen px)
 * are read here and used by the SnapManager of the editor.
 * TODO: window geometry, clip to page, the viewport canvas item.
 */
export class SPNamedView extends SPObject {
  editable = true;
  showguides = new SVGBool(true);
  lockguides = new SVGBool(false);
  /** Desk color and its checkerboard flag (inkscape:deskcolor, inkscape:pagecheckerboard). */
  desk_color: Color | undefined;
  /** Page: border visible, on top, shadow, checkerboard, colors (page-manager.h). */
  border_show = new SVGBool(true);
  border_on_top = new SVGBool(true);
  shadow_show = new SVGBool(true);
  checkerboard = new SVGBool(false);
  /** Page label style on the canvas (labelstyle): "default" or "below". */
  label_style = 'default';
  #background_color = DEFAULT_BACKGROUND_COLOR.clone();
  #border_color = DEFAULT_BORDER_COLOR.clone();
  /** Display unit abbreviation (inkscape:document-units). */
  display_units = 'px';
  zoom = 0;
  cx = Number.NaN;
  cy = Number.NaN;
  default_layer_id: string | null = null;
  /** The sodipodi:guide children. */
  guides: SPGuide[] = [];
  /** The inkscape:grid children. */
  grids: SPGrid[] = [];
  /** Snap tolerances in screen px (gridtolerance, guidetolerance, objecttolerance, ...). */
  grid_tolerance = 10;
  guide_tolerance = 20;
  object_tolerance = 20;
  alignment_tolerance = 5;
  distribution_tolerance = 5;
  #guide_color: Color | undefined;
  #guide_opacity = 0.6;
  #guide_hi_color: Color | undefined;
  #guide_hi_opacity = 0.5;

  /** Emitted when an attribute that affects the view changed. */
  readonly changedSignal = new Signal<[]>();
  /** Emitted when a guide or grid was added or removed. */
  readonly guidesAndGridsChangedSignal = new Signal<[]>();

  protected override build(document: SPDocument, repr: Node): void {
    super.build(document, repr);
    for (const key of [
      SPAttr.INKSCAPE_DOCUMENT_UNITS,
      SPAttr.VIEWONLY,
      SPAttr.SHOWGUIDES,
      SPAttr.GRIDTOLERANCE,
      SPAttr.GUIDETOLERANCE,
      SPAttr.OBJECTTOLERANCE,
      SPAttr.ALIGNMENTTOLERANCE,
      SPAttr.DISTRIBUTIONTOLERANCE,
      SPAttr.GUIDECOLOR,
      SPAttr.GUIDEOPACITY,
      SPAttr.GUIDEHICOLOR,
      SPAttr.GUIDEHIOPACITY,
      SPAttr.SHOWBORDER,
      SPAttr.SHOWPAGESHADOW,
      SPAttr.BORDERLAYER,
      SPAttr.BORDERCOLOR,
      SPAttr.BORDEROPACITY,
      SPAttr.PAGECOLOR,
      SPAttr.PAGELABELSTYLE,
      SPAttr.INKSCAPE_DESK_COLOR,
      SPAttr.INKSCAPE_DESK_CHECKERBOARD,
      SPAttr.INKSCAPE_ZOOM,
      SPAttr.INKSCAPE_CX,
      SPAttr.INKSCAPE_CY,
      SPAttr.INKSCAPE_CURRENT_LAYER,
      SPAttr.INKSCAPE_LOCKGUIDES,
    ]) {
      this.readAttr(key);
    }
    /* Construct guideline list */
    for (const child of this.children) {
      if (child instanceof SPGuide) {
        this.guides.push(child);
        this.#setGuideColors(child);
      }
      if (child instanceof SPGrid) this.grids.push(child);
    }
  }

  protected override release(): void {
    this.guides = [];
    this.grids = [];
    super.release();
  }

  protected override childAdded(child: Node, ref: Node | null): void {
    super.childAdded(child, ref);
    const no = this.document.getObjectByRepr(child);
    if (no instanceof SPGrid) this.grids.push(no);
    else if (no instanceof SPGuide) {
      this.guides.push(no);
      this.#setGuideColors(no);
    } else return;
    this.guidesAndGridsChangedSignal.emit();
  }

  protected override removeChild(child: Node): void {
    const n = this.grids.length + this.guides.length;
    this.grids = this.grids.filter((g) => g.getRepr() !== child);
    this.guides = this.guides.filter((g) => g.getRepr() !== child);
    super.removeChild(child);
    if (this.grids.length + this.guides.length !== n) this.guidesAndGridsChangedSignal.emit();
  }

  #setGuideColors(guide: SPGuide): void {
    guide.setColor(this.getGuideColor().toRGBA());
    guide.setHiColor(this.getGuideHiColor().toRGBA());
    guide.readAttr(SPAttr.INKSCAPE_COLOR);
  }

  override set(key: SPAttr, value: string | null): void {
    switch (key) {
      case SPAttr.VIEWONLY:
        this.editable = !value;
        break;
      case SPAttr.SHOWGUIDES:
        this.showguides.readOrUnset(value);
        break;
      case SPAttr.INKSCAPE_LOCKGUIDES:
        this.lockguides.readOrUnset(value);
        for (const guide of this.guides) guide.set_locked(this.lockguides.value, false);
        break;
      case SPAttr.GRIDTOLERANCE:
        this.grid_tolerance = value ? Number.parseFloat(value) : 10;
        break;
      case SPAttr.GUIDETOLERANCE:
        this.guide_tolerance = value ? Number.parseFloat(value) : 20;
        break;
      case SPAttr.OBJECTTOLERANCE:
        this.object_tolerance = value ? Number.parseFloat(value) : 20;
        break;
      case SPAttr.ALIGNMENTTOLERANCE:
        this.alignment_tolerance = value ? Number.parseFloat(value) : 5;
        break;
      case SPAttr.DISTRIBUTIONTOLERANCE:
        this.distribution_tolerance = value ? Number.parseFloat(value) : 5;
        break;
      case SPAttr.GUIDECOLOR:
        this.#guide_color = Color.parse(value);
        for (const guide of this.guides) this.#setGuideColors(guide);
        break;
      case SPAttr.GUIDEOPACITY:
        this.#guide_opacity = value ? Number.parseFloat(value) : 0.6;
        for (const guide of this.guides) this.#setGuideColors(guide);
        break;
      case SPAttr.GUIDEHICOLOR:
        this.#guide_hi_color = Color.parse(value);
        for (const guide of this.guides) this.#setGuideColors(guide);
        break;
      case SPAttr.GUIDEHIOPACITY:
        this.#guide_hi_opacity = value ? Number.parseFloat(value) : 0.5;
        for (const guide of this.guides) this.#setGuideColors(guide);
        break;
      case SPAttr.SHOWBORDER:
        this.border_show.readOrUnset(value);
        break;
      case SPAttr.BORDERLAYER:
        this.border_on_top.readOrUnset(value);
        break;
      case SPAttr.SHOWPAGESHADOW: // Deprecated
        this.shadow_show.readOrUnset(value);
        break;
      case SPAttr.BORDERCOLOR: {
        const old_opacity = this.#border_color.getOpacity();
        this.#border_color = Color.parse(value) ?? DEFAULT_BORDER_COLOR.clone();
        this.#border_color.setOpacity(old_opacity);
        break;
      }
      case SPAttr.BORDEROPACITY: {
        const v = value === null ? Number.NaN : Number.parseFloat(value);
        this.#border_color.setOpacity(Number.isNaN(v) ? 1.0 : v);
        break;
      }
      case SPAttr.PAGECOLOR:
        this.#background_color = Color.parse(value) ?? DEFAULT_BACKGROUND_COLOR.clone();
        break;
      case SPAttr.PAGELABELSTYLE:
        this.label_style = value ?? 'default';
        break;
      case SPAttr.INKSCAPE_DESK_COLOR:
        this.desk_color = Color.parse(value);
        break;
      case SPAttr.INKSCAPE_DESK_CHECKERBOARD:
        this.checkerboard.readOrUnset(value);
        break;
      case SPAttr.INKSCAPE_ZOOM:
        this.zoom = value ? Number.parseFloat(value) || 0 : 0; // zero means not set
        break;
      case SPAttr.INKSCAPE_CX:
        this.cx = value ? Number.parseFloat(value) : Number.NaN;
        break;
      case SPAttr.INKSCAPE_CY:
        this.cy = value ? Number.parseFloat(value) : Number.NaN;
        break;
      case SPAttr.INKSCAPE_CURRENT_LAYER:
        this.default_layer_id = value;
        break;
      case SPAttr.INKSCAPE_DOCUMENT_UNITS:
        this.display_units = sp_parse_document_units(value);
        break;
      default:
        super.set(key, value);
        return;
    }
    this.changedSignal.emit();
  }

  getDeskColor(): Color {
    return (this.desk_color ?? DEFAULT_DESK_COLOR).clone();
  }
  getBackgroundColor(): Color {
    return this.#background_color.clone();
  }
  /** The border color with its opacity (borderopacity). */
  getBorderColor(): Color {
    return this.#border_color.clone();
  }
  getDisplayUnit(): string {
    return this.display_units;
  }

  getShowGuides(): boolean {
    return this.showguides.value;
  }
  /** Set showguides without an undo step (upstream SPNamedView::setShowGuides). */
  setShowGuides(v: boolean): void {
    DocumentUndo.scopedInsensitive(this.document, () => this.repr.setAttributeBoolean('showguides', v));
  }
  toggleShowGuides(): void {
    this.setShowGuides(!this.getShowGuides());
  }

  getLockGuides(): boolean {
    return this.lockguides.value;
  }
  /** Set inkscape:lockguides without an undo step. */
  setLockGuides(v: boolean): void {
    DocumentUndo.scopedInsensitive(this.document, () =>
      this.repr.setAttributeBoolean('inkscape:lockguides', v),
    );
  }
  toggleLockGuides(): void {
    this.setLockGuides(!this.getLockGuides());
  }

  /** The guide color with guideopacity (default #0086e5, 0.6). */
  getGuideColor(): Color {
    const copy = (this.#guide_color ?? DEFAULT_GUIDE_COLOR).clone();
    copy.addOpacity(this.#guide_opacity);
    return copy;
  }
  /** The color of a guide under the pointer, with guidehiopacity (default #ff0000, 0.5). */
  getGuideHiColor(): Color {
    const copy = (this.#guide_hi_color ?? DEFAULT_GUIDE_HI_COLOR).clone();
    copy.addOpacity(this.#guide_hi_opacity);
    return copy;
  }

  /** True if any grid is enabled and visible. */
  getShowGrids(): boolean {
    return this.grids.some((grid) => grid.isEnabled() && grid.isVisible());
  }
  /**
   * Show or hide all grids without an undo step. Showing grids without an
   * enabled grid creates a rectangular grid (with an undo step, like upstream).
   */
  setShowGrids(v: boolean): void {
    if (v && !this.grids.some((grid) => grid.isEnabled())) {
      SPGrid.create_new(this.document, this.repr, GridType.RECTANGULAR);
      return;
    }
    DocumentUndo.scopedInsensitive(this.document, () => {
      for (const grid of this.grids) grid.setVisible(v);
    });
  }
  toggleShowGrids(): void {
    this.setShowGrids(!this.getShowGrids());
  }
  /** The first enabled grid, or null. */
  getFirstEnabledGrid(): SPGrid | null {
    return this.grids.find((grid) => grid.isEnabled()) ?? null;
  }

  // Page attribute writers, as the Document Properties dialog sets them. Each
  // writes the repr; the object follows by observation.

  setPageColor(color: Color): void {
    this.repr.setAttribute('pagecolor', color.toString(false));
  }
  setDeskColor(color: Color): void {
    this.repr.setAttribute('inkscape:deskcolor', color.toString(false));
  }
  /** Write bordercolor and borderopacity. */
  setBorderColor(color: Color): void {
    this.repr.setAttribute('bordercolor', color.toString(false));
    this.repr.setAttributeSvgDouble('borderopacity', color.getOpacity());
  }
  setShowBorder(show: boolean): void {
    this.repr.setAttributeBoolean('showborder', show);
  }
  setCheckerboard(on: boolean): void {
    this.repr.setAttributeBoolean('inkscape:pagecheckerboard', on);
  }
  /** Show the page numbers below the pages (labelstyle="below") or the labels only ("default"). */
  setLabelStyleBelow(below: boolean): void {
    this.repr.setAttribute('labelstyle', below ? 'below' : 'default');
  }
  setDisplayUnit(abbr: string): void {
    this.repr.setAttribute('inkscape:document-units', abbr);
  }

  /**
   * Keep the viewport page (the page at the origin) at the size of the document. Returns true
   * if no page covers the viewport, so the desktop shows the viewport as a page outline
   * (upstream updateViewPort, which updates the viewport canvas item).
   */
  updateViewPort(): boolean {
    const box = this.document.preferredBounds();
    const page = this.document.getPageManager().getPageAt(box.corner(0));
    if (!page) return true;
    // This means the page is in the middle of being moved, so please don't move.
    const rect = page.getDesktopRect();
    const same = [0, 2].every((i) => are_near(rect.corner(i), box.corner(i), 1e-6));
    if (page.isViewportPage() && !same) page.setDesktopRect(box);
    return false;
  }

  override write(xmlDoc: XmlDocument, repr: Node | null, flags: number): Node | null {
    // Upstream copies the attributes of the original: this object has no state beyond its repr.
    if (flags & SP_OBJECT_WRITE_EXT && repr !== this.repr) {
      if (repr) repr.mergeFrom(this.repr, 'id');
      else repr = this.repr.duplicate(xmlDoc);
    }
    return repr;
  }
}
