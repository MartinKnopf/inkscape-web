// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/filter-chemistry.cpp, src/object/sp-filter.cpp, src/object/filters/gaussian-blur.cpp
import { describe, expect, it } from 'vitest';
import { SPDocument } from './document.ts';
import {
  filter_is_single_gaussian_blur,
  modify_filter_gaussian_blur_amount,
  object_query_blur_filter,
  remove_filter_gaussian_blur,
} from './filter-chemistry.ts';
import { SPGaussianBlur } from './object/filters/gaussian-blur.ts';
import type { SPItem } from './object/sp-item.ts';

SPDocument.scheduleIdle = () => {}; // tests call ensureUpToDate() themselves

function open(body: string) {
  const doc = SPDocument.createNewDocFromMem(
    `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><defs/>${body}</svg>`,
  );
  if (!doc) throw new Error('parse failed');
  doc.ensureUpToDate();
  const item = (id: string) => doc.getObjectById(id) as SPItem;
  return { doc, item };
}

function blurOf(item: SPItem) {
  const filter = item.style.getFilter();
  const blur = filter?.children[0];
  return { filter, stdDeviation: blur instanceof SPGaussianBlur ? blur.stdDeviation.getNumber() : null };
}

describe('blur radius and stdDeviation', () => {
  it('turns the slider percent into stdDeviation: (p/100)² · (w + h) / 4, in user units', () => {
    const { doc, item } = open('<rect id="a" width="100" height="100" style="fill:red"/>');
    modify_filter_gaussian_blur_amount(item('a'), 50);
    doc.ensureUpToDate();
    const { filter, stdDeviation } = blurOf(item('a'));
    expect(filter && filter_is_single_gaussian_blur(filter)).toBe(true);
    expect(stdDeviation).toBeCloseTo(12.5);
    expect(item('a').getRepr().attribute('style')).toBe(`fill:red;filter:url(#${filter?.getId()})`);
    expect(object_query_blur_filter(item('a'))).toBeCloseTo(12.5);
  });

  it('divides by the scale of the item, so the radius on the canvas stays the same', () => {
    const { doc, item } = open('<rect id="a" width="50" height="50" transform="scale(2)"/>');
    modify_filter_gaussian_blur_amount(item('a'), 50);
    doc.ensureUpToDate();
    expect(blurOf(item('a')).stdDeviation).toBeCloseTo(6.25);
    expect(object_query_blur_filter(item('a'))).toBeCloseTo(12.5);
  });

  it('sets the filter region to the blurred area and changes the existing blur', () => {
    const { doc, item } = open('<rect id="a" width="100" height="100"/>');
    modify_filter_gaussian_blur_amount(item('a'), 50);
    doc.ensureUpToDate();
    const { filter } = blurOf(item('a'));
    // 2.4 · stdDeviation (12.5) on each side, in bounding box units.
    expect(['x', 'y', 'width', 'height'].map((a) => filter?.getAttribute(a))).toEqual([
      '-0.3',
      '-0.3',
      '1.6',
      '1.6',
    ]);
    expect(item('a').documentVisualBounds()?.left()).toBeCloseTo(-30);
    expect(item('a').documentVisualBounds()?.width()).toBeCloseTo(160);

    modify_filter_gaussian_blur_amount(item('a'), 100);
    doc.ensureUpToDate();
    expect(blurOf(item('a')).filter).toBe(filter);
    expect(blurOf(item('a')).stdDeviation).toBeCloseTo(50);
  });

  it('duplicates a filter that other objects use before changing it', () => {
    const { doc, item } = open(
      '<filter id="f"><feGaussianBlur stdDeviation="2"/></filter>' +
        '<rect id="a" width="100" height="100" style="filter:url(#f)"/><rect id="b" width="10" height="10" style="filter:url(#f)"/>',
    );
    modify_filter_gaussian_blur_amount(item('a'), 50);
    doc.ensureUpToDate();
    expect(item('a').style.getFilter()?.getId()).not.toBe('f');
    expect(blurOf(item('a')).stdDeviation).toBeCloseTo(12.5);
    expect(blurOf(item('b')).stdDeviation).toBe(2);
  });

  it('removes the filter with its last blur', () => {
    const { doc, item } = open(
      '<filter id="f"><feGaussianBlur stdDeviation="2"/></filter><rect id="a" width="10" height="10" style="filter:url(#f)"/>',
    );
    expect(remove_filter_gaussian_blur(item('a'))).toBe(true);
    doc.ensureUpToDate();
    expect(item('a').style.getFilter()).toBeNull();
    expect(item('a').getRepr().attribute('style')).toBeNull();
  });
});
