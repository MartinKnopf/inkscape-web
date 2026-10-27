// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { XmlDocument } from './document.ts';
import {
  spReprCssAttr,
  spReprCssAttrAddFromString,
  spReprCssAttrInherited,
  spReprCssAttrNew,
  spReprCssAttrUnsetAll,
  spReprCssChange,
  spReprCssChangeRecursive,
  spReprCssDoubleProperty,
  spReprCssMerge,
  spReprCssProperty,
  spReprCssPropertyIsUnset,
  spReprCssSetProperty,
  spReprCssSetPropertyDouble,
  spReprCssUnsetProperty,
  spReprCssWriteString,
} from './repr-css.ts';

describe('SPCSSAttr', () => {
  it('reads and writes a style string', () => {
    const css = spReprCssAttrNew();
    spReprCssAttrAddFromString(css, 'fill:red; stroke : rgb(1,2,3);font-family:"A B", c');
    expect(spReprCssProperty(css, 'fill')).toBe('red');
    expect(spReprCssProperty(css, 'missing', 'x')).toBe('x');
    expect(spReprCssWriteString(css)).toBe("fill:red;stroke:rgb(1, 2, 3);font-family:'A B', c");
  });

  it('sets, unsets and merges properties', () => {
    const css = spReprCssAttrNew();
    spReprCssSetProperty(css, 'fill', 'red');
    spReprCssSetProperty(css, 'stroke', 'blue');
    spReprCssUnsetProperty(css, 'stroke');
    expect(spReprCssPropertyIsUnset(css, 'stroke')).toBe(true);
    expect(spReprCssWriteString(css)).toBe('fill:red'); // unset properties are skipped

    const other = spReprCssAttrNew();
    spReprCssSetProperty(other, 'fill', 'green');
    spReprCssSetProperty(other, 'opacity', '0.5');
    spReprCssMerge(css, other);
    expect(spReprCssWriteString(css)).toBe('fill:green;opacity:0.5'); // stroke is still unset
    expect(spReprCssWriteString(spReprCssAttrUnsetAll(other))).toBe('');
    expect(spReprCssPropertyIsUnset(spReprCssAttrUnsetAll(other), 'fill')).toBe(true);
  });

  it('reads and writes numbers', () => {
    const css = spReprCssAttrNew();
    spReprCssSetPropertyDouble(css, 'opacity', 0.123456789012);
    spReprCssSetPropertyDouble(css, 'stroke-width', 3);
    expect(spReprCssProperty(css, 'opacity')).toBe('0.123456789');
    expect(spReprCssProperty(css, 'stroke-width')).toBe('3');
    spReprCssSetProperty(css, 'fill-opacity', '0.5px');
    expect(spReprCssDoubleProperty(css, 'fill-opacity', 1)).toBe(0.5);
    expect(spReprCssDoubleProperty(css, 'nothing', 1)).toBe(1);
  });

  it('changes the style attribute of a repr', () => {
    const doc = new XmlDocument();
    const g = doc.createElement('svg:g');
    const rect = doc.createElement('svg:rect');
    g.appendChild(rect);
    g.setAttribute('style', 'fill:red;stroke:blue');

    const css = spReprCssAttrNew();
    spReprCssSetProperty(css, 'fill', 'green');
    spReprCssUnsetProperty(css, 'stroke');
    spReprCssChange(g, css, 'style');
    expect(g.attribute('style')).toBe('fill:green');

    spReprCssChangeRecursive(g, css, 'style');
    expect(rect.attribute('style')).toBe('fill:green');

    expect(spReprCssProperty(spReprCssAttr(rect, 'style'), 'fill')).toBe('green');
    rect.setAttribute('style', 'stroke:red');
    expect(spReprCssWriteString(spReprCssAttrInherited(rect, 'style'))).toBe('fill:green;stroke:red');

    // An empty result removes the attribute.
    const clear = spReprCssAttrNew();
    spReprCssUnsetProperty(clear, 'fill');
    spReprCssChange(g, clear, 'style');
    expect(g.attribute('style')).toBeNull();
  });
});
