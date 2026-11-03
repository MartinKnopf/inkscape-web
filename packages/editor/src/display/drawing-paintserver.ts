// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/display/drawing-paintserver.cpp, src/display/drawing-paintserver.h
/*
 * Representation of paint servers used when rendering.
 *
 * Author: PBS <pbs3141@gmail.com>
 * Copyright (C) 2022 Authors
 */
import {
  type Drawing,
  PaintServerType,
  PatternUnits,
  SP_ITEM_SHOW_DISPLAY,
  type SPGradient,
  SPGradientSpread,
  SPGradientUnits,
  SPItem,
  type SPPaintServer,
  SPPattern,
} from '@inkscape-web/core';
import { matrixString, type SvgDrawingItem } from './drawing-item.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

interface Mirror {
  element: SVGElement;
  disconnect: () => void;
  /** Patterns: the display key of the content and the pattern whose children are shown. */
  key?: number | undefined;
  shown?: { root: SPPattern; children: SPItem[] } | undefined;
}

/**
 * The paint servers of one Drawing, as SVG elements in a <defs> of the drawing (upstream
 * DrawingPaintServer, which renders with Cairo). setStyle() of the drawing items asks for the url()
 * of a server; the first request creates the element, and the element follows the changes of
 * the server (modified signal) until the server is released.
 *
 * The elements are built from the SPPaintServer data (getGradientVector() etc.), not copied from
 * the document: the href chain is already resolved, so the element is self-contained. Their ids
 * start with a prefix that is unique per drawing, so that several views of the same document do
 * not clash.
 * A pattern becomes an svg:pattern with the attributes resolved along the href chain; its
 * content is a view (own display key) of the children of the root pattern, which the drawing
 * shows like other items (upstream DrawingPattern renders the tile with Cairo).
 * TODO: hatches and mesh gradients.
 */
export class DrawingPaintServers {
  readonly defs: SVGDefsElement;
  readonly #prefix: string;
  readonly #mirrors = new Map<SPPaintServer, Mirror>();
  #counter = 0;
  /** The drawing that shows the content of patterns; set by the drawing. */
  drawing: Drawing | null = null;

  constructor(doc: Document, prefix: string) {
    this.defs = doc.createElementNS(SVG_NS, 'defs') as SVGDefsElement;
    this.#prefix = prefix;
  }

  /** The CSS url() of the mirror of server, or null if the server cannot be drawn. */
  url(server: SPPaintServer): string | null {
    const type = server.getPaintType();
    if (
      type !== PaintServerType.LINEAR_GRADIENT &&
      type !== PaintServerType.RADIAL_GRADIENT &&
      type !== PaintServerType.PATTERN
    ) {
      return null;
    }
    if (type === PaintServerType.PATTERN && !server.isValid()) return null;
    let mirror = this.#mirrors.get(server);
    if (!mirror) {
      const tag =
        type === PaintServerType.LINEAR_GRADIENT
          ? 'linearGradient'
          : type === PaintServerType.RADIAL_GRADIENT
            ? 'radialGradient'
            : 'pattern';
      const element = this.defs.ownerDocument.createElementNS(SVG_NS, tag) as SVGElement;
      element.id = `${this.#prefix}${++this.#counter}`;
      this.defs.append(element);
      const offModified = server.modifiedSignal.connect(() => this.#render(server, element));
      const offRelease = server.releaseSignal.connect(() => this.#remove(server));
      const m: Mirror = {
        element,
        disconnect: () => {
          offModified();
          offRelease();
          this.#hideContent(m);
        },
      };
      mirror = m;
      this.#mirrors.set(server, mirror);
      this.#render(server, element);
    }
    return `url(#${mirror.element.id})`;
  }

  /** Remove all mirrors (when the drawing is no longer used). */
  clear(): void {
    for (const server of [...this.#mirrors.keys()]) this.#remove(server);
  }

  #remove(server: SPPaintServer): void {
    const mirror = this.#mirrors.get(server);
    if (!mirror) return;
    mirror.disconnect();
    mirror.element.remove();
    this.#mirrors.delete(server);
  }

  /** Write the gradient data of server to element (upstream DrawingLinearGradient / DrawingRadialGradient). */
  #render(server: SPPaintServer, element: SVGElement): void {
    if (server instanceof SPPattern) {
      this.#renderPattern(server, element);
      return;
    }
    const gradient = server as SPGradient;
    const vector = gradient.getGradientVector();
    const set = (name: string, value: string | number | null) => {
      if (value === null) element.removeAttribute(name);
      else element.setAttribute(name, String(value));
    };
    const g = vector.geom;
    if (server.getPaintType() === PaintServerType.LINEAR_GRADIENT) {
      ['x1', 'y1', 'x2', 'y2'].forEach((name, i) => {
        set(name, g[i] ?? 0);
      });
    } else {
      ['cx', 'cy', 'r', 'fx', 'fy', 'fr'].forEach((name, i) => {
        set(name, g[i] ?? 0);
      });
    }
    set(
      'gradientUnits',
      server.getUnits() === SPGradientUnits.SP_GRADIENT_UNITS_USERSPACEONUSE
        ? 'userSpaceOnUse'
        : 'objectBoundingBox',
    );
    set('gradientTransform', matrixString(server.getGradientTransform()));
    const spread = server.getSpread();
    set(
      'spreadMethod',
      spread === SPGradientSpread.SP_GRADIENT_SPREAD_REFLECT
        ? 'reflect'
        : spread === SPGradientSpread.SP_GRADIENT_SPREAD_REPEAT
          ? 'repeat'
          : 'pad',
    );
    const doc = element.ownerDocument;
    element.replaceChildren(
      ...vector.stops.map((stop) => {
        const s = doc.createElementNS(SVG_NS, 'stop');
        s.setAttribute('offset', String(stop.offset));
        // A missing color paints as 'none' (a gradient without stops).
        s.setAttribute('stop-color', stop.color ? stop.color.toString(false) : 'black');
        s.setAttribute('stop-opacity', String(stop.color ? stop.color.getOpacity() : 0));
        return s;
      }),
    );
  }

  /**
   * Write the pattern attributes (resolved along the href chain) and show the children of the
   * root pattern (upstream SPPattern::update_view and attach_view).
   */
  #renderPattern(pattern: SPPattern, element: SVGElement): void {
    const set = (name: string, value: string | number | null) => {
      if (value === null) element.removeAttribute(name);
      else element.setAttribute(name, String(value));
    };
    const units = (u: PatternUnits) =>
      u === PatternUnits.UNITS_USERSPACEONUSE ? 'userSpaceOnUse' : 'objectBoundingBox';
    set('patternUnits', units(pattern.patternUnits()));
    set('patternContentUnits', units(pattern.patternContentUnits()));
    set('x', pattern.x());
    set('y', pattern.y());
    set('width', pattern.width());
    set('height', pattern.height());
    const vb = pattern.viewbox();
    set('viewBox', vb ? `${vb.left()} ${vb.top()} ${vb.width()} ${vb.height()}` : null);
    set('preserveAspectRatio', pattern.preserveAspectRatio());
    set('patternTransform', matrixString(pattern.getTransform()));
    // The content inherits the style of the root pattern (upstream: the SPStyle cascade), e.g. the
    // fill that the pattern editor sets on content without a fill.
    const fill = [pattern, pattern.rootPattern()].map((p) => p.style.fill).find((f) => f.set && f.isColor());
    set('fill', fill ? fill.getColor().toString(false) : null);

    const mirror = this.#mirrors.get(pattern);
    const root = pattern.rootPattern();
    const children = root.children.filter((c): c is SPItem => c instanceof SPItem);
    const shown = mirror?.shown;
    if (!mirror || !this.drawing) return;
    if (
      shown &&
      shown.root === root &&
      shown.children.length === children.length &&
      shown.children.every((c, i) => c === children[i])
    ) {
      return;
    }
    this.#hideContent(mirror);
    const key = SPItem.displayKeyNew(1);
    mirror.key = key;
    mirror.shown = { root, children };
    for (const child of children) {
      const ac = child.invokeShow(this.drawing, key, SP_ITEM_SHOW_DISPLAY) as SvgDrawingItem | null;
      if (ac) element.append(ac.element);
    }
  }

  #hideContent(mirror: Mirror): void {
    if (mirror.shown && mirror.key !== undefined) {
      for (const child of mirror.shown.children) child.invokeHide(mirror.key);
    }
    mirror.shown = undefined;
    mirror.key = undefined;
  }
}
