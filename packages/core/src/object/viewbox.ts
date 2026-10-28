// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/viewbox.cpp, src/object/viewbox.h
/*
 * viewBox helper class, common code used by root, symbol, marker, pattern, image, view
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com> (code extracted from symbol.cpp)
 *   Tavmjong Bah <tavmjong@free.fr>
 *   Johan Engelen
 *
 * Copyright (C) 2013-2014 Tavmjong Bah, authors
 */
import { Affine, are_near, EPSILON, Rect, Translate } from '@inkscape-web/geom';
import type { Node } from '../xml/node.ts';
import type { SPItemCtx } from './sp-item.ts';

/** Upstream SP_ASPECT_* (enums.h). */
export enum SPAspect {
  SP_ASPECT_NONE,
  SP_ASPECT_XMIN_YMIN,
  SP_ASPECT_XMID_YMIN,
  SP_ASPECT_XMAX_YMIN,
  SP_ASPECT_XMIN_YMID,
  SP_ASPECT_XMID_YMID,
  SP_ASPECT_XMAX_YMID,
  SP_ASPECT_XMIN_YMAX,
  SP_ASPECT_XMID_YMAX,
  SP_ASPECT_XMAX_YMAX,
}
export const SP_ASPECT_MEET = 0;
export const SP_ASPECT_SLICE = 1;

const ASPECT_ALIGN: Record<string, SPAspect> = {
  none: SPAspect.SP_ASPECT_NONE,
  xMinYMin: SPAspect.SP_ASPECT_XMIN_YMIN,
  xMidYMin: SPAspect.SP_ASPECT_XMID_YMIN,
  xMaxYMin: SPAspect.SP_ASPECT_XMAX_YMIN,
  xMinYMid: SPAspect.SP_ASPECT_XMIN_YMID,
  xMidYMid: SPAspect.SP_ASPECT_XMID_YMID,
  xMaxYMid: SPAspect.SP_ASPECT_XMAX_YMID,
  xMinYMax: SPAspect.SP_ASPECT_XMIN_YMAX,
  xMidYMax: SPAspect.SP_ASPECT_XMID_YMAX,
  xMaxYMax: SPAspect.SP_ASPECT_XMAX_YMAX,
};

/**
 * viewBox and preserveAspectRatio state with the child to parent transform
 * (upstream SPViewBox). Upstream classes inherit it; here they hold one.
 */
export class SPViewBox {
  viewBox_set = false;
  viewBox = Rect.fromXywh(0, 0, 0, 0);
  aspect_set = false;
  aspect_align = SPAspect.SP_ASPECT_XMID_YMID; // Default per spec
  aspect_clip = SP_ASPECT_MEET;
  /** Child to parent transform. */
  c2p = Affine.identity();

  set_viewBox(value: string | null): void {
    this.viewBox_set = false;
    if (!value) return;
    const [x = Number.NaN, y = Number.NaN, width = Number.NaN, height = Number.NaN] = value
      .trim()
      .split(/[\s,]+/)
      .map(Number.parseFloat);
    if (width > 0 && height > 0) {
      this.viewBox = Rect.fromXywh(x || 0, y || 0, width, height);
      this.viewBox_set = true;
    }
  }

  set_preserveAspectRatio(value: string | null): void {
    this.aspect_set = false;
    this.aspect_align = SPAspect.SP_ASPECT_XMID_YMID;
    this.aspect_clip = SP_ASPECT_MEET;
    if (!value) return;
    const [align, clip, ...rest] = value.trim().split(/ +/);
    if (!align || rest.length) return;
    const a = ASPECT_ALIGN[align];
    if (a === undefined) return;
    if (clip !== undefined && clip !== 'meet' && clip !== 'slice') return;
    this.aspect_set = true;
    this.aspect_align = a;
    this.aspect_clip = clip === 'slice' ? SP_ASPECT_SLICE : SP_ASPECT_MEET;
  }

  /** Write the preserveAspectRatio attribute to repr, if set. */
  write_preserveAspectRatio(repr: Node): void {
    if (!this.aspect_set) return;
    const align = Object.keys(ASPECT_ALIGN).find((k) => ASPECT_ALIGN[k] === this.aspect_align) ?? 'xMidYMid';
    repr.setAttribute('preserveAspectRatio', this.aspect_clip === SP_ASPECT_SLICE ? `${align} slice` : align);
  }

  /**
   * Append the viewBox scaling for viewport `inRect` to c2p. scale_none is the
   * scale if the viewBox and the page have the same size (reduces numerical error).
   */
  apply_viewbox(inRect: Rect, scale_none: number): void {
    let x = 0;
    let y = 0;
    let scale_x = inRect.width() / this.viewBox.width();
    let scale_y = inRect.height() / this.viewBox.height();
    if (are_near(scale_x / scale_y, 1.0, EPSILON)) {
      // scaling is already uniform, reduce numerical error
      let scale_uniform = (scale_x + scale_y) / 2.0;
      if (are_near(scale_uniform / scale_none, 1.0, EPSILON)) scale_uniform = scale_none;
      scale_x = scale_uniform;
      scale_y = scale_uniform;
    } else if (this.aspect_align !== SPAspect.SP_ASPECT_NONE) {
      // scaling is not uniform, but force it to be
      const scale_uniform =
        this.aspect_clip === SP_ASPECT_MEET ? Math.min(scale_x, scale_y) : Math.max(scale_x, scale_y);
      scale_x = scale_uniform;
      scale_y = scale_uniform;
      const dx = inRect.width() - this.viewBox.width() * scale_uniform;
      const dy = inRect.height() - this.viewBox.height() * scale_uniform;
      // Position of the viewBox: 0, 0.5 or 1 times the free space.
      const col = (this.aspect_align - 1) % 3;
      const row = Math.floor((this.aspect_align - 1) / 3);
      x = 0.5 * col * dx;
      y = 0.5 * row * dy;
    }
    const q = new Affine(
      scale_x,
      0,
      0,
      scale_y,
      x - scale_x * this.viewBox.left(),
      y - scale_y * this.viewBox.top(),
    );
    this.c2p = q.multiply(this.c2p);
  }

  /** Compute c2p for the viewport in ictx and return the context for the children. */
  get_rctx(ictx: SPItemCtx, scale_none: number): SPItemCtx {
    const rctx = { ...ictx };
    this.c2p = Translate(rctx.viewport.min());
    if (this.viewBox_set) this.apply_viewbox(rctx.viewport, scale_none);
    rctx.i2doc = this.c2p.multiply(rctx.i2doc);
    if (this.viewBox_set) {
      rctx.viewport = this.viewBox;
      rctx.i2vp = Affine.identity();
    }
    return rctx;
  }
}
