// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tools/dynamic-base.cpp, src/ui/tools/dynamic-base.h
/*
 * Common drawing mode. Base class of Eraser and Calligraphic tools.
 *
 * Authors:
 *   Mitsuru Oka <oka326@parkcity.ne.jp>
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *
 * The original dynadraw code:
 *   Paul Haeberli <paul@sgi.com>
 *
 * Copyright (C) 1998 The Free Software Foundation
 * Copyright (C) 1999-2002 authors
 * Copyright (C) 2001-2002 Ximian, Inc.
 * Copyright (C) 2008 Jon A. Cruz
 * Copyright (C) 2018 Authors
 */
import { convertUnit, Preferences, type Node as XmlNode } from '@inkscape-web/core';
import { CubicBezier, LineSegment, Path, Point } from '@inkscape-web/geom';
import type { SPDesktop } from '../../desktop.ts';
import type { CanvasItemBpath } from '../../display/control/canvas-item-bpath.ts';
import { ToolBase } from './tool-base.ts';

export const SAMPLING_SIZE = 8;

const DRAG_MIN = 0.0;
const DRAG_MAX = 1.0;

/** The pressure and tilt of a pointer event (upstream ExtendedInput); unset for a mouse. */
export interface ExtendedInput {
  pressure?: number;
  xtilt?: number;
  ytilt?: number;
}

/**
 * The pressure and tilt of a pointer event. Tilt is -1..1 like GDK's axes
 * (PointerEvent.tiltX and tiltY are -90..90 degrees).
 * A mouse reports pressure 0.5 while a button is down and no tilt: both are unset then.
 */
export function extinput_from_event(event: PointerEvent): ExtendedInput {
  if (event.pointerType !== 'pen' && event.pointerType !== 'touch') return {};
  return { pressure: event.pressure, xtilt: event.tiltX / 90, ytilt: event.tiltY / 90 };
}

const clamp = (v: number, min: number, max: number): number => Math.min(Math.max(v, min), max);

/**
 * Base class of the calligraphy and eraser tools (upstream DynamicBase): the
 * pen state of the dynadraw model (position, velocity, nib angle, in
 * coordinates normalized to the visible area) and the edges of the stroke.
 * The edges cal1 and cal2 are fitted with Beziers while drawing; at the end
 * they are joined to the closed path "accumulated" (desktop coordinates).
 */
export class DynamicBase extends ToolBase {
  /** accumulated shape which ultimately goes in svg:path */
  accumulated = new Path();

  /** canvas items for "committed" segments */
  segments: CanvasItemBpath[] = [];

  /** shape of red "leading" segment */
  currentcurve = new Path();

  /** left edge of the stroke; combined to get accumulated */
  cal1 = new Path();

  /** right edge of the stroke; combined to get accumulated */
  cal2 = new Path();

  /** left edge points for this segment */
  point1: Point[] = Array.from({ length: SAMPLING_SIZE }, () => new Point(0, 0));

  /** right edge points for this segment */
  point2: Point[] = Array.from({ length: SAMPLING_SIZE }, () => new Point(0, 0));

  /** number of edge points for this segment */
  npoints = 0;

  /* repr */
  repr: XmlNode | null = null;

  /* common */
  cur = new Point(0, 0);
  vel = new Point(0, 0);
  vel_max = 0.0;
  acc = new Point(0, 0);
  ang = new Point(0, 0);
  last = new Point(0, 0);
  del = new Point(0, 0);

  /* extended input data */
  pressure = 1.0;
  xtilt = 0.0;
  ytilt = 0.0;

  /* attributes */
  usepressure = false;
  usetilt = false;
  mass = 0.3;
  drag = 1.0;
  angle = 30.0;
  width = 0.2;

  vel_thin = 0.1;
  flatness = 0.9;
  tremor = 0.0;
  cap_rounding = 0.0;

  is_drawing = false;
  /** True while the pointer is dragged with the button down (upstream ToolBase::dragging). */
  dragging = false;

  /** uses absolute width independent of zoom */
  abs_width = false;

  constructor(desktop: SPDesktop, prefsPath: string) {
    super(desktop, prefsPath);
  }

  override destroy(): void {
    for (const s of this.segments) s.unlink();
    this.segments = [];
    super.destroy();
  }

  override set(name: string): void {
    // ignore preset modifications
    if (name.startsWith('preset/')) return;

    const prefs = Preferences.get();
    const path = `${this.getPrefsPath()}/${name}`;
    const unit = prefs.getString('/tools/calligraphic/unit');

    if (name === 'mass') {
      this.mass = 0.01 * clamp(prefs.getInt(path, 10), 0, 100);
    } else if (name === 'wiggle') {
      this.drag = clamp(1 - 0.01 * prefs.getInt(path), DRAG_MIN, DRAG_MAX); // drag is inverse to wiggle
    } else if (name === 'angle') {
      this.angle = clamp(prefs.getDouble(path), -90.0, 90.0);
    } else if (name === 'width') {
      this.width =
        0.01 * clamp(prefs.getDouble(path), convertUnit(0.001, unit, 'px'), convertUnit(100, unit, 'px'));
    } else if (name === 'thinning') {
      this.vel_thin = 0.01 * clamp(prefs.getInt(path, 10), -100, 100);
    } else if (name === 'tremor') {
      this.tremor = 0.01 * clamp(prefs.getInt(path), 0, 100);
    } else if (name === 'flatness') {
      this.flatness = 0.01 * clamp(prefs.getInt(path), -100, 100);
    } else if (name === 'usepressure') {
      this.usepressure = prefs.getBool(path);
    } else if (name === 'usetilt') {
      this.usetilt = prefs.getBool(path);
    } else if (name === 'abs_width') {
      this.abs_width = prefs.getBool(path);
    } else if (name === 'cap_rounding') {
      this.cap_rounding = prefs.getDouble(path);
    }
  }

  /** Point v (desktop) in coordinates normalized to the visible area. */
  getNormalizedPoint(v: Point): Point {
    const drect = this._desktop.get_display_area();
    const max = drect.maxExtent();
    return v.sub(drect.min()).div(max);
  }

  /** The desktop point of the normalized point n. */
  getViewPoint(n: Point): Point {
    const drect = this._desktop.get_display_area();
    const max = drect.maxExtent();
    return n.mul(max).add(drect.min());
  }
}

/** Append path b to a with stitching (upstream setStitching(true)): a line joins them if they do not touch. */
export function append_stitched(a: Path, b: Path): void {
  if (b.empty()) return;
  if (!a.finalPoint().equals(b.initialPoint()))
    a.appendCurve(new LineSegment(a.finalPoint(), b.initialPoint()));
  a.append(b);
}

/** Append a cubic Bezier from the end of path through handles h1, h2 to p (upstream appendNew<CubicBezier>). */
export function append_cubic(path: Path, h1: Point, h2: Point, p: Point): void {
  path.appendCurve(new CubicBezier(path.finalPoint(), h1, h2, p));
}

/** Append a line from the end of path to p (upstream appendNew<LineSegment>). */
export function append_line(path: Path, p: Point): void {
  path.appendCurve(new LineSegment(path.finalPoint(), p));
}
