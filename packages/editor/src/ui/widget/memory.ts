// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/widget/memory.cpp, src/ui/widget/memory.h
/*
 * A dialog widget to show memory usage stats.
 *
 * Authors:
 *   MenTaLguY <mental@rydia.net>
 *   Bryce Harrington <bryce@bryceharrington.org>
 *
 * Copyright (C) 2005 Authors
 */
import { _ } from '@inkscape-web/core';

/** A heap of the page (upstream Debug::Heap): its name and sizes in bytes; null where the browser does not tell. */
export interface Heap {
  name: string;
  /** Bytes in use. */
  used: number | null;
  /** The size of the heap. */
  size: number | null;
}

/** A row of the memory table, as texts (columns Heap, In Use, Slack, Total). */
export interface MemoryRow {
  name: string;
  used: string;
  slack: string;
  total: string;
}

/** The format of a size in bytes (upstream format_size). */
export function format_size(value: number): string {
  if (value < 1024) return `${value} B`;
  let v = value;
  let unit = 'B';
  for (const u of ['KiB', 'MiB', 'GiB']) {
    if (v < 1024) break;
    v /= 1024;
    unit = u;
  }
  return `${v.toFixed(v < 10 ? 2 : 1)} ${unit}`;
}

/** The heaps of the page: the JavaScript heap in Chromium (performance.memory), else none. */
export function get_heaps(): Heap[] {
  const memory = (
    globalThis.performance as Performance & {
      memory?: { usedJSHeapSize: number; totalJSHeapSize: number };
    }
  ).memory;
  return memory ? [{ name: 'JavaScript', used: memory.usedJSHeapSize, size: memory.totalJSHeapSize }] : [];
}

/** The rows of the table: one for each heap and the combined row (upstream Memory::Private::update). */
export function memory_rows(heaps: readonly Heap[]): MemoryRow[] {
  const unknown = _('Unknown');
  const rows = heaps.map(
    (heap): MemoryRow => ({
      name: heap.name,
      used: heap.used === null ? unknown : format_size(heap.used),
      slack: heap.size !== null && heap.used !== null ? format_size(heap.size - heap.used) : unknown,
      total: heap.size === null ? unknown : format_size(heap.size),
    }),
  );
  let size = 0;
  let used = 0;
  let size_known = true;
  let used_known = true;
  for (const heap of heaps) {
    if (heap.size === null) size_known = false;
    else size += heap.size;
    if (heap.used === null) used_known = false;
    else used += heap.used;
  }
  rows.push({
    name: _('Combined'),
    used: (used_known ? '' : '> ') + format_size(used),
    slack: size_known && used_known ? format_size(size - used) : unknown,
    total: (size_known ? '' : '> ') + format_size(size),
  });
  return rows;
}
