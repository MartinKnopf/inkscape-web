// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-helper.cpp, src/actions/actions-helper.h
/*
 * Helpers for the actions.
 *
 * Copyright (C) 2018 Tavmjong Bah
 */
import { Signal } from '@inkscape-web/core';

/** Emitted with every line that show_output() prints (is_cerr: it is an error or warning). */
export const output_signal = new Signal<[data: string, is_cerr: boolean]>();

/**
 * Print the output of an action (upstream: stdout or stderr). The browser has no terminal, so the
 * console gets it and output_signal lets the application show it.
 */
export function show_output(data: string, is_cerr = true): void {
  if (is_cerr) console.warn(data);
  else console.log(data);
  output_signal.emit(data, is_cerr);
}
