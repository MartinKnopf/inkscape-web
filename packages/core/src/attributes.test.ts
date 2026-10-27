// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/attributes.cpp, src/attributes.h
import { describe, expect, it } from 'vitest';
import { attributeIsCss, attributeLookup, attributeName, attributeNameList, SPAttr } from './attributes.ts';

describe('attributes', () => {
  it('looks up names and ids both ways for every attribute', () => {
    for (let i = 1; i < SPAttr.SPAttr_SIZE; i++) {
      const name = attributeName(i);
      expect(name, `name of ${i}`).not.toBeNull();
      expect(attributeLookup(name)).toBe(i);
    }
  });

  it('knows a few names', () => {
    expect(attributeLookup('id')).toBe(SPAttr.ID);
    expect(attributeLookup('viewBox')).toBe(SPAttr.VIEWBOX);
    expect(attributeLookup('inkscape:label')).toBe(SPAttr.INKSCAPE_LABEL);
    expect(attributeLookup('stroke-width')).toBe(SPAttr.STROKE_WIDTH);
    expect(attributeName(SPAttr.XLINK_HREF)).toBe('xlink:href');
  });

  it('is case sensitive and returns INVALID for unknown names', () => {
    expect(attributeLookup('viewbox')).toBe(SPAttr.INVALID);
    expect(attributeLookup('nonsense')).toBe(SPAttr.INVALID);
    expect(attributeLookup(null)).toBe(SPAttr.INVALID);
    expect(attributeName(SPAttr.INVALID)).toBeNull();
    expect(attributeName(SPAttr.SPAttr_SIZE)).toBeNull();
  });

  it('accepts the SVG 2 alias href for xlink:href', () => {
    expect(attributeLookup('href')).toBe(SPAttr.XLINK_HREF);
  });

  it('marks D up to (not including) SYSTEM_LANGUAGE as CSS properties', () => {
    expect(attributeIsCss(SPAttr.D)).toBe(true);
    expect(attributeIsCss(SPAttr.FILL)).toBe(true);
    expect(attributeIsCss(SPAttr.ID)).toBe(false);
    expect(attributeIsCss(SPAttr.SYSTEM_LANGUAGE)).toBe(false);
  });

  it('lists names sorted, optionally CSS only', () => {
    const all = attributeNameList();
    const css = attributeNameList(true);
    expect(all).toEqual([...all].sort());
    expect(all).toHaveLength(SPAttr.SPAttr_SIZE - 1);
    expect(css).toContain('fill');
    expect(css).not.toContain('id');
    expect(css.every((n) => attributeIsCss(attributeLookup(n)))).toBe(true);
  });
});
