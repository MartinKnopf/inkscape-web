// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/desktop.cpp, src/actions/actions-canvas-transform.cpp
// @vitest-environment happy-dom
import { Preferences } from '@inkscape-web/core';
import { Point } from '@inkscape-web/geom';
import { afterEach, describe, expect, it } from 'vitest';
import { CanvasFlip } from './desktop.ts';
import { InkscapeApplication } from './inkscape-application.ts';
import { setupDesktop } from './ui/tools/tool-test-utils.ts';

/** A wheel event with Ctrl and Shift (happy-dom's WheelEvent ignores the init values). */
function ctrlShiftWheel(target: Element, deltaY: number): void {
  const event = new Event('wheel', { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    deltaX: { value: 0 },
    deltaY: { value: deltaY },
    deltaMode: { value: 0 },
    ctrlKey: { value: true },
    shiftKey: { value: true },
    metaKey: { value: false },
    clientX: { value: 10 },
    clientY: { value: 10 },
  });
  target.dispatchEvent(event);
}

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"/>';
afterEach(() => InkscapeApplication.instance().set_active_desktop(null));

function setup() {
  const s = setupDesktop(SVG, 'Select');
  InkscapeApplication.instance().set_active_desktop(s.dt);
  return { ...s, run: (a: string) => expect(InkscapeApplication.instance().activate_action(a)).toBe(true) };
}

describe('canvas rotation', () => {
  it('rotates about the center of the window and keeps the center there', () => {
    const { dt, run } = setup();
    const center = dt.current_center();
    run('win.canvas-rotate-relative-degrees(90.0)');
    expect(dt.current_rotation()).toBeCloseTo(Math.PI / 2, 9);
    expect(dt.current_center().sub(center).length()).toBeLessThan(1e-6);
    // The desktop x axis now points along the window y axis.
    const o = dt.d2w(center);
    const e = dt.d2w(center.add(new Point(10, 0))).sub(o);
    expect(Math.abs(e.x)).toBeLessThan(1e-6);
    expect(Math.abs(e.y)).toBeGreaterThan(1e-6);
    run('win.canvas-rotate-reset');
    expect(dt.current_rotation()).toBe(0);
  });

  it('rotates by the increment of the preference and the Ctrl+Shift wheel', () => {
    const { dt, svg, run } = setup();
    run('win.canvas-rotate-cw');
    expect(dt.current_rotation()).toBeCloseTo((15 * Math.PI) / 180, 9);
    run('win.canvas-rotate-ccw');
    // The rotation is locked by default (/options/rotationlock); unlock it for the wheel.
    expect(dt.rotation_lock).toBe(true);
    run('win.canvas-rotate-lock');
    expect(dt.rotation_lock).toBe(false);
    ctrlShiftWheel(svg, 100);
    expect(dt.current_rotation()).toBeCloseTo((15 * Math.PI) / 180, 9);
    // The rotation lock stops the wheel.
    run('win.canvas-rotate-lock');
    expect(dt.rotation_lock).toBe(true);
    ctrlShiftWheel(svg, 100);
    expect(dt.current_rotation()).toBeCloseTo((15 * Math.PI) / 180, 9);
    run('win.canvas-rotate-lock');
    Preferences.get().remove('/options/rotationlock');
  });
});

describe('canvas flip', () => {
  it('flips horizontally and vertically, and resets', () => {
    const { dt, run } = setup();
    const x0 = dt.d2w(new Point(10, 0)).x - dt.d2w(new Point(0, 0)).x;
    run('win.canvas-flip-horizontal');
    expect(dt.is_flipped(CanvasFlip.FLIP_HORIZONTAL)).toBe(true);
    expect(dt.is_flipped(CanvasFlip.FLIP_VERTICAL)).toBe(false);
    expect(dt.d2w(new Point(10, 0)).x - dt.d2w(new Point(0, 0)).x).toBeCloseTo(-x0, 9);
    run('win.canvas-flip-vertical');
    expect(dt.is_flipped(CanvasFlip.FLIP_VERTICAL)).toBe(true);
    run('win.canvas-flip-reset');
    expect(dt.is_flipped(CanvasFlip.FLIP_HORIZONTAL)).toBe(false);
    expect(dt.d2w(new Point(10, 0)).x - dt.d2w(new Point(0, 0)).x).toBeCloseTo(x0, 9);
  });
});

describe('zoom history', () => {
  it('goes back and forward through the zooms', () => {
    const { dt, run } = setup();
    run('win.canvas-zoom-page');
    const z0 = dt.current_zoom();
    run('win.canvas-zoom-relative(2.0)');
    run('win.canvas-zoom-relative(2.0)');
    expect(dt.current_zoom()).toBeCloseTo(4 * z0, 9);
    run('win.canvas-zoom-prev');
    expect(dt.current_zoom()).toBeCloseTo(2 * z0, 9);
    run('win.canvas-zoom-prev');
    expect(dt.current_zoom()).toBeCloseTo(z0, 9);
    run('win.canvas-zoom-next');
    expect(dt.current_zoom()).toBeCloseTo(2 * z0, 9);
    // A new zoom drops the forward history.
    run('win.canvas-zoom-relative(3.0)');
    expect(dt.next_transform()).toBe(false);
  });
});
