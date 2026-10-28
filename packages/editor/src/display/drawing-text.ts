// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/display/drawing-text.cpp, src/display/drawing-text.h
/*
 * Group belonging to an SVG drawing element.
 *
 * Authors:
 *   Krzysztof Kosiński <tweenk.pl@gmail.com>
 *
 * Copyright (C) 2011 Authors
 */
import {
  type DrawingText,
  ink_font_from_style,
  SP_STYLE_FLAG_ALWAYS,
  type SPStyle,
} from '@inkscape-web/core';
import { SvgDrawingItem } from './drawing-item.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * The glyphs of a text span (upstream DrawingText): an svg:text element with
 * an explicit position for every character, from the layout. So the browser
 * draws the glyphs where the layout (and with it the cursor, the selection
 * and the bounding box) has them. Upstream draws glyph outlines with Cairo.
 * TODO: text-decoration, outline mode.
 */
export class SvgDrawingText extends SvgDrawingItem implements DrawingText {
  #text = '';
  #x: number[] = [];
  #y: number[] = [];
  #rotate: number[] = [];

  constructor(doc: Document) {
    super(doc.createElementNS(SVG_NS, 'text') as SVGElement);
    // Positions are per character: no white space collapsing, no anchoring.
    this.element.style.setProperty('white-space', 'pre');
    this.element.style.setProperty('text-anchor', 'start');
    this.element.style.setProperty('dominant-baseline', 'alphabetic');
  }

  addComponent(text: string, x: number, y: number, rotation: number, _width: number): boolean {
    this.#text += text;
    // The browser positions UTF-16 code units: repeat the values for surrogate pairs.
    for (let i = 0; i < text.length; i++) {
      this.#x.push(x);
      this.#y.push(y);
      this.#rotate.push((rotation * 180) / Math.PI);
    }
    this.element.textContent = this.#text;
    this.setAttribute('x', this.#x.join(' '));
    this.setAttribute('y', this.#y.join(' '));
    this.setAttribute('rotate', this.#rotate.some((r) => r !== 0) ? this.#rotate.join(' ') : null);
    return true;
  }

  /** The paint of the cascaded style, and the font from the computed values. */
  override setStyle(style: SPStyle | null, contextStyle?: SPStyle | null): void {
    super.setStyle(style, contextStyle);
    if (!style) return;
    const font = ink_font_from_style(style);
    const css = this.element.style;
    css.setProperty('font-family', font.family);
    css.setProperty('font-size', `${font.size}px`);
    css.setProperty('font-weight', String(font.weight));
    css.setProperty('font-style', font.style);
    css.setProperty('font-stretch', font.stretch);
    css.setProperty('font-variant', font.variant);
  }

  protected override _styleText(style: SPStyle): string {
    return style.write(SP_STYLE_FLAG_ALWAYS);
  }
}
