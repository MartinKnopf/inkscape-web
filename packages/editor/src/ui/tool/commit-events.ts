// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tool/commit-events.h
/* Authors:
 *   Krzysztof Kosiński <tweenk.pl@gmail.com>
 *
 * Copyright (C) 2009 Authors
 */

/** The kinds of changes that ControlPointSelection commits (the undo step depends on it). */
export enum CommitEvent {
  COMMIT_MOUSE_MOVE,
  COMMIT_KEYBOARD_MOVE_X,
  COMMIT_KEYBOARD_MOVE_Y,
  COMMIT_MOUSE_SCALE,
  COMMIT_MOUSE_SCALE_UNIFORM,
  COMMIT_KEYBOARD_SCALE_UNIFORM,
  COMMIT_KEYBOARD_SCALE_X,
  COMMIT_KEYBOARD_SCALE_Y,
  COMMIT_MOUSE_ROTATE,
  COMMIT_KEYBOARD_ROTATE,
  COMMIT_MOUSE_SKEW_X,
  COMMIT_MOUSE_SKEW_Y,
  COMMIT_KEYBOARD_SKEW_X,
  COMMIT_KEYBOARD_SKEW_Y,
  COMMIT_FLIP_X,
  COMMIT_FLIP_Y,
}
