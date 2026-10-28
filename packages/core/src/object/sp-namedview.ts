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
import { SPAttr } from '../attributes.ts';
import { Color } from '../colors/color.ts';
import type { SPDocument } from '../document.ts';
import { DocumentUndo } from '../document-undo.ts';
import { SVGBool } from '../svg/svg-bool.ts';
import { getUnit, UnitType } from '../svg/svg-length.ts';
import { Signal } from '../util/signal.ts';
import type { XmlDocument } from '../xml/document.ts';
import type { Node } from '../xml/node.ts';
import { SP_OBJECT_WRITE_EXT, SPObject } from './sp-object.ts';

const DEFAULT_DESK_COLOR = new Color(0xd1d1d1ff, false);
/** Upstream CanvasPage::DEFAULT_BACKGROUND_COLOR and DEFAULT_BORDER_COLOR. */
const DEFAULT_BACKGROUND_COLOR = new Color(0xffffffff);
const DEFAULT_BORDER_COLOR = new Color(0x0000001a);

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
 * TODO: grids, guides, snapping, window geometry, clip to page, the
 * viewport canvas item and pages.
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
  shadow_show = new SVGBool(false);
  checkerboard = new SVGBool(false);
  #background_color = DEFAULT_BACKGROUND_COLOR.clone();
  #border_color = DEFAULT_BORDER_COLOR.clone();
  /** Display unit abbreviation (inkscape:document-units). */
  display_units = 'px';
  zoom = 0;
  cx = Number.NaN;
  cy = Number.NaN;
  default_layer_id: string | null = null;

  /** Emitted when an attribute that affects the view changed. */
  readonly changedSignal = new Signal<[]>();

  protected override build(document: SPDocument, repr: Node): void {
    super.build(document, repr);
    for (const key of [
      SPAttr.INKSCAPE_DOCUMENT_UNITS,
      SPAttr.VIEWONLY,
      SPAttr.SHOWGUIDES,
      SPAttr.SHOWBORDER,
      SPAttr.SHOWPAGESHADOW,
      SPAttr.BORDERLAYER,
      SPAttr.BORDERCOLOR,
      SPAttr.BORDEROPACITY,
      SPAttr.PAGECOLOR,
      SPAttr.INKSCAPE_DESK_COLOR,
      SPAttr.INKSCAPE_DESK_CHECKERBOARD,
      SPAttr.INKSCAPE_ZOOM,
      SPAttr.INKSCAPE_CX,
      SPAttr.INKSCAPE_CY,
      SPAttr.INKSCAPE_CURRENT_LAYER,
    ]) {
      this.readAttr(key);
    }
  }

  override set(key: SPAttr, value: string | null): void {
    switch (key) {
      case SPAttr.VIEWONLY:
        this.editable = !value;
        break;
      case SPAttr.SHOWGUIDES:
        this.showguides.readOrUnset(value);
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
  setDisplayUnit(abbr: string): void {
    this.repr.setAttribute('inkscape:document-units', abbr);
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
