// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/widget/font-variants.cpp
import { SPStyle, spReprCssAttrNew, spReprCssWriteString } from '@inkscape-web/core';
import { describe, expect, it } from 'vitest';
import {
  font_variants_fill_css,
  font_variants_from_style,
  font_variants_get_markup,
} from './font-variants.ts';

function stateOf(css: string) {
  const style = new SPStyle(null);
  style.mergeString(css);
  return font_variants_from_style(style, null);
}

describe('FontVariants', () => {
  it('reads the font-variant properties of a style', () => {
    const s = stateOf(
      'font-variant-ligatures:no-common-ligatures discretionary-ligatures;font-variant-caps:small-caps;' +
        'font-variant-numeric:oldstyle-nums tabular-nums slashed-zero;font-feature-settings:"wxyz" 3',
    );
    expect(s.ligatures_common).toBe(false);
    expect(s.ligatures_discretionary).toBe(true);
    expect(s.caps).toBe('small');
    expect([s.numeric_style, s.numeric_width, s.numeric_slashed_zero]).toEqual([
      'old_style',
      'tabular',
      true,
    ]);
    expect(s.feature_entry).toBe("'wxyz' 3");
  });

  it('writes them back to CSS and to the preview feature settings', () => {
    const s = stateOf('font-variant-caps:small-caps;font-variant-position:super');
    const css = spReprCssAttrNew();
    font_variants_fill_css(s, css);
    expect(spReprCssWriteString(css)).toBe(
      'font-variant-ligatures:normal;font-variant-position:super;font-variant-caps:small-caps;font-variant-numeric:normal',
    );
    expect(font_variants_get_markup(s)).toBe('"sups" 1, "smcp" 1');
  });
});
