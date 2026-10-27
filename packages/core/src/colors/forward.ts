// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/colors/forward.h, src/colors/color.h
/*
 * Author:
 *   Martin Owens <doctormo@geek-2.com>
 *
 * Copyright (C) 2023 AUTHORS
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */

/**
 * Error of the color system (upstream Inkscape::Colors::ColorError, declared in color.h).
 * It lives here, in a file without imports, so that the color spaces can throw it without
 * importing color.ts.
 */
export class ColorError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'ColorError';
  }
}
