// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/desktop.h
// A module of its own: the actions import it, and desktop.ts imports the tools that import the actions.

/** The flip of the canvas (upstream SPDesktop::CanvasFlip, a bit set). */
export enum CanvasFlip {
  FLIP_NONE = 0,
  FLIP_HORIZONTAL = 1,
  FLIP_VERTICAL = 2,
}
