// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-stop.cpp, src/object/sp-stop.h
/*
 * @gradient stop class.
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   bulia byak
 *   Johan Engelen <j.b.c.engelen@ewi.utwente.nl>
 *   Jon A. Cruz <jon@joncruz.org>
 *
 * Copyright (C) 1999,2005 authors
 * Copyright (C) 2010 Jon A. Cruz
 */
import { SPAttr } from '../attributes.ts';
import type { Color } from '../colors/color.ts';
import type { SPDocument } from '../document.ts';
import { cssNumber } from '../svg/css-ostringstream.ts';
import { spSvgReadPercentage } from '../svg/svg-length.ts';
import type { XmlDocument } from '../xml/document.ts';
import type { Node } from '../xml/node.ts';
import {
  SP_OBJECT_MODIFIED_FLAG,
  SP_OBJECT_PARENT_MODIFIED_FLAG,
  SP_OBJECT_STYLE_MODIFIED_FLAG,
  SP_OBJECT_WRITE_BUILD,
  SPObject,
} from './sp-object.ts';

/** Gradient stop (svg:stop). The color comes from stop-color and stop-opacity in its style. */
export class SPStop extends SPObject {
  /** TODO: fixme: Should be SPSVGPercentage */
  offset = 0;
  /** For mesh gradients. */
  path_string = '';

  protected override build(document: SPDocument, repr: Node): void {
    this.readAttr(SPAttr.STYLE);
    this.readAttr(SPAttr.OFFSET);
    this.readAttr(SPAttr.STOP_PATH); // For mesh
    super.build(document, repr);
  }

  override set(key: SPAttr, value: string | null): void {
    switch (key) {
      case SPAttr.OFFSET:
        this.offset = spSvgReadPercentage(value, 0.0);
        this.requestModified(SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_STYLE_MODIFIED_FLAG);
        break;
      case SPAttr.STOP_PATH:
        if (value) {
          this.path_string = value;
          this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        }
        break;
      default:
        // SPObject.set() reads the style for the style attribute and the presentation attributes.
        super.set(key, value);
        // This makes sure that the parent sp-gradient is updated.
        this.requestModified(SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_STYLE_MODIFIED_FLAG);
        break;
    }
  }

  protected override modified(flags: number): void {
    if (this.parent && !(flags & SP_OBJECT_PARENT_MODIFIED_FLAG)) {
      this.parent.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_STYLE_MODIFIED_FLAG);
    }
  }

  override write(xmlDoc: XmlDocument, repr: Node | null, flags: number): Node | null {
    if (flags & SP_OBJECT_WRITE_BUILD && !repr) repr = xmlDoc.createElement('svg:stop');
    super.write(xmlDoc, repr, flags);
    // strictly speaking, offset an SVG <number> rather than a CSS one, but exponents make no sense
    // for offset proportions.
    repr?.setAttribute('offset', cssNumber(this.offset));
    return repr;
  }

  /** The next stop among the siblings (a stop might have some non-stop siblings). */
  getNextStop(): SPStop | null {
    for (let obj = this.getNext(); obj; obj = obj.getNext()) if (obj instanceof SPStop) return obj;
    return null;
  }

  getPrevStop(): SPStop | null {
    for (let obj = this.getPrev(); obj; obj = obj.getPrev()) {
      // The closest previous SPObject that is an SPStop *should* be ourself.
      if (obj instanceof SPStop) {
        // Sanity check to ensure we have a proper sibling structure.
        if (obj.getNextStop() === this) return obj;
        console.warn('SPStop previous/next relationship broken');
        return null;
      }
    }
    return null;
  }

  /** The stop color with the stop opacity. */
  getColor(): Color {
    // Copy color from the right place
    const style = this.style;
    const color = (
      style.stop_color.currentcolor ? style.color.getColor() : style.stop_color.getColor()
    ).clone();
    // Bundle stop opacity into the color
    color.addOpacity(style.stop_opacity.as_double());
    return color;
  }

  /** Set the stop color and stop opacity in the style attribute. */
  setColor(color: Color): void {
    SPStop.setColorRepr(this.getRepr(), color);
  }

  /** Set the color and opacity directly into the given xml repr. */
  static setColorRepr(node: Node, color: Color): void {
    node.setAttribute(
      'style',
      `stop-color:${color.toString(false)};stop-opacity:${cssNumber(color.getOpacity())};`,
    );
  }
}
