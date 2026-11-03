// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/filters/slot-resolver.cpp, src/object/filters/slot-resolver.h
/*
 * Authors: see git history
 *
 * Copyright (C) 2022 Authors
 */
import { FilterSlotType } from '../../display/nr-filter-types.ts';

const special_names: ReadonlyMap<string, number> = new Map([
  ['SourceGraphic', FilterSlotType.NR_FILTER_SOURCEGRAPHIC],
  ['SourceAlpha', FilterSlotType.NR_FILTER_SOURCEALPHA],
  ['StrokePaint', FilterSlotType.NR_FILTER_STROKEPAINT],
  ['FillPaint', FilterSlotType.NR_FILTER_FILLPAINT],
  ['BackgroundImage', FilterSlotType.NR_FILTER_BACKGROUNDIMAGE],
  ['BackgroundAlpha', FilterSlotType.NR_FILTER_BACKGROUNDALPHA],
]);

/**
 * Gives the result names of the primitives of a filter slot numbers (upstream SlotResolver):
 * the standard inputs have negative numbers, results count up from 1 in document order.
 */
export class SlotResolver {
  readonly #map = new Map<string, number>();
  #next = 1;

  read(name: string | null): number {
    if (name === null) return FilterSlotType.NR_FILTER_SLOT_NOT_SET;
    return special_names.get(name) ?? this.#map.get(name) ?? FilterSlotType.NR_FILTER_SLOT_NOT_SET;
  }

  write(name: string | null): number {
    if (name === null) return FilterSlotType.NR_FILTER_SLOT_NOT_SET;
    let slot = this.#map.get(name);
    if (slot === undefined) {
      slot = this.#next++;
      this.#map.set(name, slot);
    }
    return slot;
  }
}
