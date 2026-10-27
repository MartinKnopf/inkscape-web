// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/colors/
//
// The color system. The color spaces are in spaces/. Their parsers are added to Parsers by
// manager.ts, so load color.ts or manager.ts before calling Parsers.get().parse().

export * from './color.ts';
export * from './color-set.ts';
export * from './manager.ts';
export * from './parser.ts';
export * from './printer.ts';
export * from './spaces/base.ts';
export * from './spaces/components.ts';
export * from './spaces/enum.ts';
export * from './utils.ts';
export * from './xml-color.ts';
