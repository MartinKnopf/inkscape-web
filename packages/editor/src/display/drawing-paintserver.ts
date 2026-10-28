// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/display/drawing-paintserver.cpp, src/display/drawing-paintserver.h
/*
 * Representation of paint servers used when rendering.
 *
 * Author: PBS <pbs3141@gmail.com>
 * Copyright (C) 2022 Authors
 */
import {
  PaintServerType,
  type SPGradient,
  SPGradientSpread,
  SPGradientUnits,
  type SPPaintServer,
} from '@inkscape-web/core';
import { matrixString } from './drawing-item.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

interface Mirror {
  element: SVGElement;
  disconnect: () => void;
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
 * TODO: patterns, hatches and mesh gradients.
 */
export class DrawingPaintServers {
  readonly defs: SVGDefsElement;
  readonly #prefix: string;
  readonly #mirrors = new Map<SPPaintServer, Mirror>();
  #counter = 0;

  constructor(doc: Document, prefix: string) {
    this.defs = doc.createElementNS(SVG_NS, 'defs') as SVGDefsElement;
    this.#prefix = prefix;
  }

  /** The CSS url() of the mirror of server, or null if the server cannot be drawn. */
  url(server: SPPaintServer): string | null {
    const type = server.getPaintType();
    if (type !== PaintServerType.LINEAR_GRADIENT && type !== PaintServerType.RADIAL_GRADIENT) return null;
    let mirror = this.#mirrors.get(server);
    if (!mirror) {
      const tag = type === PaintServerType.LINEAR_GRADIENT ? 'linearGradient' : 'radialGradient';
      const element = this.defs.ownerDocument.createElementNS(SVG_NS, tag) as SVGElement;
      element.id = `${this.#prefix}${++this.#counter}`;
      this.defs.append(element);
      const offModified = server.modifiedSignal.connect(() => this.#render(server, element));
      const offRelease = server.releaseSignal.connect(() => this.#remove(server));
      mirror = {
        element,
        disconnect: () => {
          offModified();
          offRelease();
        },
      };
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
}
