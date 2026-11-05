// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/display/drawing.cpp, src/display/drawing.h
/*
 * Authors:
 *   Krzysztof Kosiński <tweenk.pl@gmail.com>
 *
 * Copyright (C) 2011 Authors
 */
import { type Drawing, Pixbuf } from '@inkscape-web/core';
import { SvgDrawingGroup } from './drawing-group.ts';
import { SvgDrawingImage } from './drawing-image.ts';
import { CLIP_MASK_CLASS, type SvgDrawingItem } from './drawing-item.ts';
import { DrawingPaintServers } from './drawing-paintserver.ts';
import { SvgDrawingShape } from './drawing-shape.ts';
import { SvgDrawingText } from './drawing-text.ts';
import { DrawingFilters } from './nr-filter.ts';

let drawingCount = 0;

/** How the drawing is rendered (upstream Inkscape::RenderMode; the values are those of win.canvas-display-mode). */
export enum RenderMode {
  NORMAL,
  OUTLINE,
  NO_FILTERS,
  VISIBLE_HAIRLINES,
  OUTLINE_OVERLAY,
}

/** The number of render modes (upstream RenderMode::size). */
export const RENDER_MODE_COUNT = 5;

/** The elements that draw shapes, text and images; the groups of the display tree have no paint. */
const PAINTED = ':is(path, rect, circle, ellipse, line, polyline, polygon, text, tspan, image)';

/**
 * The style sheet of the render modes: the mode is the attribute data-render-mode of the root
 * element of the drawing. Outline shows the paths of the objects as 1 px lines in black, without
 * fill, filters and opacity; the overlay mode does that over a translucent drawing; no filters only
 * drops the filters. The hairlines mode marks the thin strokes with data-hairline (see
 * SvgDrawing.updateHairlines) and draws those as 1 px lines (CSS cannot set a least stroke width).
 */
const RENDER_MODE_CSS =
  `[data-render-mode="outline"] ${PAINTED}{fill:none!important;stroke:#000!important;stroke-width:1px!important;stroke-opacity:1!important;stroke-dasharray:none!important;vector-effect:non-scaling-stroke;filter:none!important;mask:none!important;opacity:1!important;marker:none!important}` +
  `[data-render-mode="outline"] image{opacity:.3!important}` +
  `[data-render-mode="overlay"] ${PAINTED}{fill-opacity:.4!important;stroke:#000!important;stroke-width:1px!important;stroke-dasharray:none!important;vector-effect:non-scaling-stroke}` +
  `[data-render-mode="nofilters"] *{filter:none!important}` +
  `[data-render-mode="hairlines"] [data-hairline]{stroke-width:var(--hairline-width)!important}`;

const RENDER_MODE_ATTRIBUTE: Record<RenderMode, string | null> = {
  [RenderMode.NORMAL]: null,
  [RenderMode.OUTLINE]: 'outline',
  [RenderMode.NO_FILTERS]: 'nofilters',
  [RenderMode.VISIBLE_HAIRLINES]: 'hairlines',
  [RenderMode.OUTLINE_OVERLAY]: 'overlay',
};

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * A computed stroke width in user units. The browser keeps a percentage as it is; it is a part of
 * the diagonal of the viewport of the nearest svg element, sqrt((w^2 + h^2) / 2).
 */
function resolveWidth(value: string, el: SVGGraphicsElement): number {
  const width = Number.parseFloat(value);
  if (!value.trim().endsWith('%')) return width;
  const svg = el.ownerSVGElement;
  const box = svg?.viewBox?.baseVal;
  const w = box?.width || svg?.clientWidth || 0;
  const h = box?.height || svg?.clientHeight || 0;
  return (width / 100) * Math.sqrt((w * w + h * h) / 2);
}

/** The screen size of one user unit of the element, from its transform to the screen. */
function screenScale(el: SVGGraphicsElement): number {
  const m = el.getScreenCTM?.();
  return m ? Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) : 1;
}

/** The region of the svg:mask elements, in user space: large enough to not cut the mask. */
const MASK_REGION = { maskUnits: 'userSpaceOnUse', x: '-1e5', y: '-1e5', width: '2e5', height: '2e5' };

/** Paint the content of a clip in mask form opaque white: only the geometry counts, as in a clip. */
const CLIP_MASK_CSS =
  `.${CLIP_MASK_CLASS} * { fill: #fff !important; fill-opacity: 1 !important; stroke: none !important;` +
  ' opacity: 1 !important; filter: none !important; mix-blend-mode: normal !important; }';

/**
 * Display tree backed by the browser's SVG engine (upstream Drawing). Upstream
 * renders with Cairo; here the caller inserts `defs` (the paint servers, see
 * DrawingPaintServers, the filters, see DrawingFilters, and the clip paths and
 * masks of the items) and `root.element` into an svg element and the browser
 * renders them.
 */
export class SvgDrawing implements Drawing {
  readonly root: SvgDrawingGroup;
  /** The paint servers used by the items; `paintServers.defs` goes beside the root. */
  readonly paintServers: DrawingPaintServers;
  /** The filters used by the items, in the same defs. */
  readonly filters: DrawingFilters;
  readonly #doc: Document;
  /** Unique per drawing: several drawings in one HTML document must not share ids. */
  readonly #prefix: string;
  #idCounter = 0;
  #clipMaskStyle: SVGStyleElement | null = null;

  constructor(doc: Document) {
    this.#doc = doc;
    this.#prefix = `drawing${++drawingCount}`;
    this.paintServers = new DrawingPaintServers(doc, `${this.#prefix}-ps`);
    this.paintServers.drawing = this;
    this.filters = new DrawingFilters(this.paintServers.defs, `${this.#prefix}-filter`);
    this.root = this.#own(new SvgDrawingGroup(doc));
    // The browser loads the images that are no data: URIs (blob:, http:).
    Pixbuf.urlLoader ??= (url) => loadImageSize(doc, url);
  }

  #renderMode = RenderMode.NORMAL;
  #renderModeStyle: SVGStyleElement | null = null;

  getRenderMode(): RenderMode {
    return this.#renderMode;
  }

  #pageClip: SVGClipPathElement | null = null;

  /**
   * Show only what is in the rectangle (desktop coordinates), or everything with null (the canvas
   * of upstream clips to the page, Canvas::set_clip_to_page_mode).
   */
  setClipToRect(rect: { x: number; y: number; width: number; height: number } | null): void {
    if (!rect) {
      this.root.element.removeAttribute('clip-path');
      return;
    }
    if (!this.#pageClip) {
      this.#pageClip = this.#doc.createElementNS(SVG_NS, 'clipPath') as SVGClipPathElement;
      this.#pageClip.id = `${this.#prefix}-page-clip`;
      this.#pageClip.append(this.#doc.createElementNS(SVG_NS, 'rect'));
      this.defs.append(this.#pageClip);
    }
    const r = this.#pageClip.firstElementChild as SVGRectElement;
    r.setAttribute('x', String(rect.x));
    r.setAttribute('y', String(rect.y));
    r.setAttribute('width', String(rect.width));
    r.setAttribute('height', String(rect.height));
    this.root.element.setAttribute('clip-path', `url(#${this.#pageClip.id})`);
  }

  /** Render the drawing in the mode (upstream Drawing::setRenderMode). */
  setRenderMode(mode: RenderMode): void {
    this.#renderMode = mode;
    const value = RENDER_MODE_ATTRIBUTE[mode];
    if (value && !this.#renderModeStyle) {
      this.#renderModeStyle = this.#doc.createElementNS(SVG_NS, 'style') as SVGStyleElement;
      this.#renderModeStyle.textContent = RENDER_MODE_CSS;
      this.defs.prepend(this.#renderModeStyle);
    }
    if (value) this.root.element.setAttribute('data-render-mode', value);
    else this.root.element.removeAttribute('data-render-mode');
    this.updateHairlines();
  }

  /**
   * In the hairlines mode, mark the shapes whose stroke is thinner than 1 screen pixel and give
   * them the width that makes it 1 px (upstream DrawingShape::_renderStroke with
   * RENDER_VISIBLE_HAIRLINES). Only the width changes; dashes and the rest keep scaling. Call it
   * after the zoom or the shapes change. Outside that mode it clears the marks.
   *
   * The width is the resolved one of the browser (inherited, with units, in user units). For a
   * non-scaling stroke that width is in screen px already; else it scales with the element.
   */
  updateHairlines(): void {
    const hairlines = this.#renderMode === RenderMode.VISIBLE_HAIRLINES;
    if (!hairlines && !this.#hairlinesMarked) return;
    this.#hairlinesMarked = hairlines;
    const elements = [...this.root.element.querySelectorAll<SVGGraphicsElement>(PAINTED)];
    // Clear first: the marks change the resolved width.
    for (const el of elements) {
      el.removeAttribute('data-hairline');
      el.style.removeProperty('--hairline-width');
    }
    if (!hairlines) return;
    const view = this.#doc.defaultView ?? globalThis;
    for (const el of elements) {
      const style = view.getComputedStyle(el);
      const width = resolveWidth(style.strokeWidth, el);
      if (!(width > 0)) continue;
      const non_scaling = style.vectorEffect === 'non-scaling-stroke';
      const scale = non_scaling ? 1 : screenScale(el);
      if (width * scale >= 1) continue;
      el.setAttribute('data-hairline', '');
      el.style.setProperty('--hairline-width', String(1 / scale));
    }
  }
  #hairlinesMarked = false;

  /** The <defs> with the paint servers, filters, clip paths and masks. */
  get defs(): SVGDefsElement {
    return this.paintServers.defs;
  }

  /**
   * A new svg:mask in the defs, for DrawingItem.setMask() and setClip(). Like upstream, masks
   * have no region: the svg:mask covers a large area. With className CLIP_MASK_CLASS, a style
   * sheet paints its content opaque white, so that it works as a clip path.
   */
  createMaskElement(kind: string, className: string | null): SVGElement {
    const mask = this.#doc.createElementNS(SVG_NS, 'mask') as SVGElement;
    mask.id = this.uniqueId(kind);
    for (const [name, value] of Object.entries(MASK_REGION)) mask.setAttribute(name, value);
    if (className) {
      mask.setAttribute('class', className);
      if (!this.#clipMaskStyle) {
        this.#clipMaskStyle = this.#doc.createElementNS(SVG_NS, 'style') as SVGStyleElement;
        this.#clipMaskStyle.textContent = CLIP_MASK_CSS;
        this.defs.prepend(this.#clipMaskStyle);
      }
    }
    this.defs.append(mask);
    return mask;
  }

  /** A new element id for the defs, e.g. "drawing1-clip3". */
  uniqueId(kind: string): string {
    return `${this.#prefix}-${kind}${++this.#idCounter}`;
  }

  createGroup(): SvgDrawingGroup {
    return this.#own(new SvgDrawingGroup(this.#doc));
  }

  createShape(): SvgDrawingShape {
    return this.#own(new SvgDrawingShape(this.#doc));
  }

  createImage(): SvgDrawingImage {
    return this.#own(new SvgDrawingImage(this.#doc));
  }

  createText(): SvgDrawingText {
    return this.#own(new SvgDrawingText(this.#doc));
  }

  /** Let item resolve url() paints with the paint servers of this drawing and use its defs. */
  #own<T extends SvgDrawingItem>(item: T): T {
    item._paintServers = this.paintServers;
    item._drawing = this;
    return item;
  }
}

/** The pixel size of the image at url, loaded by the browser. */
function loadImageSize(doc: Document, url: string): Promise<{ width: number; height: number }> {
  const img = doc.createElement('img');
  img.src = url;
  return img.decode().then(() => ({ width: img.naturalWidth, height: img.naturalHeight }));
}
