// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: testfiles/src/style-test.cpp
/*
 * Tests for the style classes: reading and writing, comparing, cascading.
 *
 * Authors: see git history
 *
 * Copyright (C) 2010 Authors
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { describe, expect, it } from 'vitest';
import { SPAttr } from './attributes.ts';
import {
  SP_STYLE_FLAG_ALWAYS,
  SP_STYLE_FLAG_IFSET,
  SPStyle,
  SPStyleSrc,
  spCssAttrScale,
  spCssAttrUnsetText,
  spCssAttrUnsetUris,
} from './style.ts';
import { SP_SCALE24_MAX } from './style-internal.ts';
import { spReprCssAttrNew, spReprCssProperty, spReprCssSetProperty } from './xml/repr-css.ts';

/** [source, expected output]; the output is the source if it is not given. */
type ReadCase = readonly [string, string?];

const readCases: ReadCase[] = [
  // Paint -----------------------------------------------
  ['fill:none'],
  ['fill:currentColor'],
  ['fill:#ff00ff'],
  ['fill:rgb(100%, 0%, 100%)', 'fill:#ff00ff'],
  ['fill:rgb(255, 0, 255)', 'fill:#ff00ff'],
  ['fill:inherit'],

  // General tests (in general order of appearance in sp_style_read), SPIPaint tested above
  ['visibility:hidden'], // SPIEnum
  ['visibility:collapse'],
  ['visibility:visible'],
  ['display:none'], // SPIEnum
  ['overflow:visible'], // SPIEnum
  ['overflow:auto'], // SPIEnum

  ['color:#ff0000'],
  ['color:blue'],

  // Font shorthand
  [
    'font:bold 12px Arial',
    'font-style:normal;font-variant:normal;font-weight:bold;font-stretch:normal;font-size:12px;line-height:normal;font-family:Arial',
  ],
  [
    "font:bold 12px/24px 'Times New Roman'",
    "font-style:normal;font-variant:normal;font-weight:bold;font-stretch:normal;font-size:12px;line-height:24px;font-family:'Times New Roman'",
  ],

  // From CSS 3 Fonts (examples):
  [
    'font: 12pt/15pt sans-serif',
    'font-style:normal;font-variant:normal;font-weight:normal;font-stretch:normal;font-size:16px;line-height:15pt;font-family:sans-serif',
  ],
  [
    'font: bold italic large Palatino, serif',
    'font-style:italic;font-variant:normal;font-weight:bold;font-stretch:normal;font-size:large;line-height:normal;font-family:Palatino, serif',
  ],
  [
    "font: condensed oblique 12pt 'Helvetica Neue', serif;",
    "font-style:oblique;font-variant:normal;font-weight:normal;font-stretch:condensed;font-size:16px;line-height:normal;font-family:'Helvetica Neue', serif",
  ],

  ['font-family:sans-serif'], // SPIString, text_private
  ['font-family:Arial'],

  // Needs to be fixed (quotes should be around each font-family):
  ["font-family:Georgia, 'Minion Web'", "font-family:Georgia, 'Minion Web'"],
  ['font-size:12', 'font-size:12px'], // SPIFontSize
  ['font-size:12px'],
  ['font-size:12pt', 'font-size:16px'],
  ['font-size:medium'],
  ['font-size:smaller'],
  ['font-style:italic'], // SPIEnum
  ['font-variant:small-caps'], // SPIEnum
  ['font-weight:100'], // SPIEnum
  ['font-weight:normal'],
  ['font-weight:bolder'],
  ['font-stretch:condensed'], // SPIEnum

  ['font-variant-ligatures:none'], // SPILigatures
  ['font-variant-ligatures:normal'],
  ['font-variant-ligatures:no-common-ligatures'],
  ['font-variant-ligatures:discretionary-ligatures'],
  ['font-variant-ligatures:historical-ligatures'],
  ['font-variant-ligatures:no-contextual'],
  ['font-variant-ligatures:common-ligatures', 'font-variant-ligatures:normal'],
  ['font-variant-ligatures:contextual', 'font-variant-ligatures:normal'],
  ['font-variant-ligatures:no-common-ligatures historical-ligatures'],
  ['font-variant-ligatures:historical-ligatures no-contextual'],
  ['font-variant-position:normal'],
  ['font-variant-position:sub'],
  ['font-variant-position:super'],
  ['font-variant-caps:normal'],
  ['font-variant-caps:small-caps'],
  ['font-variant-caps:all-small-caps'],
  ['font-variant-numeric:normal'],
  ['font-variant-numeric:lining-nums'],
  ['font-variant-numeric:oldstyle-nums'],
  ['font-variant-numeric:proportional-nums'],
  ['font-variant-numeric:tabular-nums'],
  ['font-variant-numeric:diagonal-fractions'],
  ['font-variant-numeric:stacked-fractions'],
  ['font-variant-numeric:ordinal'],
  ['font-variant-numeric:slashed-zero'],
  ['font-variant-numeric:tabular-nums slashed-zero'],
  ['font-variant-numeric:tabular-nums proportional-nums', 'font-variant-numeric:proportional-nums'],

  ["font-variation-settings:'wght' 400"],
  ["font-variation-settings:'wght'  400", "font-variation-settings:'wght' 400"],
  ["font-variation-settings:'wght' 400, 'slnt' 0.5", "font-variation-settings:'slnt' 0.5, 'wght' 400"],
  ['font-variation-settings:"wght" 400', "font-variation-settings:'wght' 400"],

  // Should be moved down
  ['text-indent:12em'], // SPILength?
  ['text-align:center'], // SPIEnum

  // SPITextDecoration
  [
    'text-decoration: underline wavy #0000ff',
    'text-decoration:underline;text-decoration-line:underline;text-decoration-style:wavy;text-decoration-color:#0000ff',
  ],
  [
    'text-decoration: double overline underline #ff0000',
    'text-decoration:underline overline;text-decoration-line:underline overline;text-decoration-style:double;text-decoration-color:#ff0000',
  ],

  // SPITextDecorationLine
  // If only "text-decoration-line" is set but not "text-decoration", don't write "text-decoration" (changed in 1.1)
  ['text-decoration-line:underline'],
  // "text-decoration" overwrites "text-decoration-line" and vice versa, last one counts
  [
    'text-decoration-line:overline;text-decoration:underline',
    'text-decoration:underline;text-decoration-line:underline',
  ],
  [
    'text-decoration:underline;text-decoration-line:overline',
    'text-decoration:overline;text-decoration-line:overline',
  ],

  // SPITextDecorationStyle
  ['text-decoration-style:solid'],
  ['text-decoration-style:dotted'],

  // SPITextDecorationColor
  ['text-decoration-color:#ff00ff'],

  // Should be moved up
  ['line-height:24px'], // SPILengthOrNormal
  ['line-height:1.5'],
  ['letter-spacing:2px'], // SPILengthOrNormal
  ['word-spacing:2px'], // SPILengthOrNormal
  ['word-spacing:normal'],
  ['text-transform:lowercase'], // SPIEnum
  // ...
  ['baseline-shift:baseline'], // SPIBaselineShift
  ['baseline-shift:sub'],
  ['baseline-shift:12.5%'],
  ['baseline-shift:2px'],

  ['opacity:0.1'], // SPIScale24
  // ...
  ['stroke-width:2px'], // SPILength
  ['stroke-linecap:round'], // SPIEnum
  ['stroke-linejoin:round'], // SPIEnum
  ['stroke-miterlimit:4'], // SPIFloat
  ['marker:url(#Arrow)'], // SPIString
  ['marker-start:url(#Arrow)'],
  ['marker-mid:url(#Arrow)'],
  ['marker-end:url(#Arrow)'],
  ['stroke-opacity:0.5'], // SPIScale24
  ['stroke-dasharray:0, 1, 0, 1'], // SPIDashArray
  ['stroke-dasharray:0 1 0 1', 'stroke-dasharray:0, 1, 0, 1'],
  ['stroke-dasharray:0  1  2  3', 'stroke-dasharray:0, 1, 2, 3'],
  ['stroke-dashoffset:13'], // SPILength
  ['stroke-dashoffset:10px'],
  // ...
  ['filter:inherit'],

  ['opacity:0.1;fill:#ff0000;stroke:#0000ff;stroke-width:2px'],
  [
    'opacity:0.1;fill:#ff0000;stroke:#0000ff;stroke-width:2px;stroke-dasharray:1, 2, 3, 4;stroke-dashoffset:15',
  ],

  ['paint-order:stroke'], // SPIPaintOrder
  ['paint-order:normal'],
  ['paint-order: markers stroke   fill', 'paint-order:markers stroke fill'],

  // !important  (in order of appearance in style-internal.h)
  ['stroke-miterlimit:4 !important'], // SPIFloat
  ['stroke-opacity:0.5 !important'], // SPIScale24
  ['stroke-width:2px !important'], // SPILength
  ['line-height:24px !important'], // SPILengthOrNormal
  ['line-height:normal !important'],
  ['font-stretch:condensed !important'], // SPIEnum
  ['marker:url(#Arrow) !important'], // SPIString
  ['color:#0000ff !important'], // SPIColor
  ['fill:none !important'], // SPIPaint
  ['fill:currentColor !important'],
  ['fill:#ff00ff !important'],
  ['paint-order:stroke !important'], // SPIPaintOrder
  ['paint-order:normal !important'],
  ['stroke-dasharray:0, 1, 0, 1 !important'], // SPIDashArray
  ['font-size:12px !important'], // SPIFontSize
  ['baseline-shift:baseline !important'], // SPIBaselineShift
  ['baseline-shift:sub !important'],
];

describe('SPStyle read and write', () => {
  it.each(readCases.map(([src, dst]): [string, string] => [src, dst ?? src]))('%s', (src, dst) => {
    const style = new SPStyle();
    style.mergeString(src);
    expect(style.write()).toBe(dst);
  });
});

describe('SPStyle equals', () => {
  /** [first, second, equal] */
  const matchCases: [string, string, boolean][] = [
    // SPIFloat
    ['stroke-miterlimit:4', 'stroke-miterlimit:4', true],
    ['stroke-miterlimit:4', 'stroke-miterlimit:2', false],
    ['stroke-miterlimit:4', '', true], // Default

    // SPIScale24
    ['opacity:0.3', 'opacity:0.3', true],
    ['opacity:0.3', 'opacity:0.6', false],
    ['opacity:1.0', '', true], // Default

    // SPILength
    ['text-indent:3', 'text-indent:3', true],
    ['text-indent:6', 'text-indent:3', false],
    ['text-indent:6px', 'text-indent:3', false],
    ['text-indent:1px', 'text-indent:12pc', false],
    ['text-indent:2ex', 'text-indent:2ex', false],

    // SPILengthOrNormal
    ['letter-spacing:normal', 'letter-spacing:normal', true],
    ['letter-spacing:2', 'letter-spacing:normal', false],
    ['letter-spacing:normal', 'letter-spacing:2', false],
    ['letter-spacing:5px', 'letter-spacing:5px', true],
    ['letter-spacing:10px', 'letter-spacing:5px', false],
    ['letter-spacing:10em', 'letter-spacing:10em', false],

    // SPIEnum
    ['text-anchor:start', 'text-anchor:start', true],
    ['text-anchor:start', 'text-anchor:middle', false],
    ['text-anchor:start', '', true], // Default
    ['text-anchor:start', 'text-anchor:junk', true], // Bad value

    ['font-weight:normal', 'font-weight:400', true],
    ['font-weight:bold', 'font-weight:700', true],

    // SPIString and SPIFontString
    ['font-family:Arial', 'font-family:Arial', true],
    ['font-family:A B', 'font-family:A B', true],
    ['font-family:A B', 'font-family:A C', false],

    // SPIColor
    ['color:blue', 'color:blue', true],
    ['color:blue', 'color:red', false],
    ['color:red', 'color:#ff0000', false],

    // SPIPaint
    ['fill:blue', 'fill:blue', true],
    ['fill:blue', 'fill:red', false],
    ['fill:currentColor', 'fill:currentColor', true],
    ['fill:url(#xxx)', 'fill:url(#xxx)', true],

    // SPIPaintOrder
    ['paint-order:markers', 'paint-order:markers', true],
    ['paint-order:markers', 'paint-order:stroke', false],
    ['paint-order:normal', 'paint-order:normal', true],

    // SPIDashArray
    ['stroke-dasharray:0 1 2 3', 'stroke-dasharray:0 1 2 3', true],
    ['stroke-dasharray:0 1', 'stroke-dasharray:0 2', false],

    // SPIFontSize
    ['font-size:12px', 'font-size:12px', true],
    ['font-size:12px', 'font-size:24px', false],
    ['font-size:12ex', 'font-size:24ex', false],
    ['font-size:medium', 'font-size:medium', true],
    ['font-size:medium', 'font-size:large', false],

    // SPIBaselineShift
    ['baseline-shift:baseline', 'baseline-shift:baseline', true],
    ['baseline-shift:sub', 'baseline-shift:sub', true],
    ['baseline-shift:sub', 'baseline-shift:super', false],
    ['baseline-shift:baseline', 'baseline-shift:sub', false],
    ['baseline-shift:10px', 'baseline-shift:10px', true],
    ['baseline-shift:10px', 'baseline-shift:12px', false],

    // SPITextDecorationLine
    ['text-decoration-line:underline', 'text-decoration-line:underline', true],
    ['text-decoration-line:underline', 'text-decoration-line:overline', false],
    ['text-decoration-line:underline overline', 'text-decoration-line:underline overline', true],
    ['text-decoration-line:none', '', true], // Default

    // SPITextDecorationStyle
    ['text-decoration-style:solid', 'text-decoration-style:solid', true],
    ['text-decoration-style:dotted', 'text-decoration-style:solid', false],
    ['text-decoration-style:solid', '', true], // Default

    // SPITextDecoration
    ['text-decoration:underline', 'text-decoration:underline', true],
    ['text-decoration:underline', 'text-decoration:overline', false],
    ['text-decoration:underline overline', 'text-decoration:underline overline', true],
    ['text-decoration:overline underline', 'text-decoration:underline overline', true],
  ];

  it.each(matchCases)('%s / %s', (src, dst, match) => {
    const a = new SPStyle();
    const b = new SPStyle();
    a.mergeString(src);
    b.mergeString(dst);
    expect(a.equals(b)).toBe(match);
  });
});

describe('SPStyle cascade', () => {
  /** [parent, child, result, diff of the result against the parent] */
  type CascadeCase = readonly [string, string, string, string?];
  const cascadeCases: CascadeCase[] = [
    // SPIFloat
    ['stroke-miterlimit:6', 'stroke-miterlimit:2', 'stroke-miterlimit:2'],
    ['stroke-miterlimit:6', '', 'stroke-miterlimit:6'],
    ['', 'stroke-miterlimit:2', 'stroke-miterlimit:2'],

    // SPIScale24
    ['opacity:0.3', 'opacity:0.3', 'opacity:0.3', 'opacity:0.3'],
    ['opacity:0.3', 'opacity:0.6', 'opacity:0.6'],
    // 'opacity' does not inherit
    ['opacity:0.3', '', 'opacity:1'],
    ['', 'opacity:0.3', 'opacity:0.3'],
    ['opacity:0.5', 'opacity:inherit', 'opacity:0.5', 'opacity:0.5'],
    ['', '', 'opacity:1'],

    // SPILength
    ['text-indent:3', 'text-indent:3', 'text-indent:3'],
    ['text-indent:6', 'text-indent:3', 'text-indent:3'],
    ['text-indent:6px', 'text-indent:3', 'text-indent:3'],
    ['text-indent:1px', 'text-indent:12pc', 'text-indent:12pc'],
    ['text-indent:3', '', 'text-indent:3'],
    ['text-indent:3', 'text-indent:inherit', 'text-indent:3'],

    // SPILengthOrNormal
    ['letter-spacing:normal', 'letter-spacing:normal', 'letter-spacing:normal'],
    ['letter-spacing:2', 'letter-spacing:normal', 'letter-spacing:normal'],
    ['letter-spacing:normal', 'letter-spacing:2', 'letter-spacing:2'],
    ['letter-spacing:5px', 'letter-spacing:5px', 'letter-spacing:5px'],
    ['letter-spacing:10px', 'letter-spacing:5px', 'letter-spacing:5px'],

    // SPIEnum
    ['text-anchor:start', 'text-anchor:start', 'text-anchor:start'],
    ['text-anchor:start', 'text-anchor:middle', 'text-anchor:middle'],
    ['text-anchor:start', '', 'text-anchor:start'],
    ['text-anchor:start', 'text-anchor:junk', 'text-anchor:start'],
    ['text-anchor:end', 'text-anchor:inherit', 'text-anchor:end'],

    ['font-weight:400', 'font-weight:400', 'font-weight:400'],
    ['font-weight:400', 'font-weight:700', 'font-weight:700'],
    ['font-weight:400', 'font-weight:bolder', 'font-weight:700'],
    ['font-weight:700', 'font-weight:bolder', 'font-weight:900'],
    ['font-weight:400', 'font-weight:lighter', 'font-weight:100'],
    ['font-weight:200', 'font-weight:lighter', 'font-weight:100'],

    ['font-stretch:condensed', 'font-stretch:expanded', 'font-stretch:expanded'],
    ['font-stretch:condensed', 'font-stretch:wider', 'font-stretch:semi-condensed'],

    // SPIString and SPIFontString
    ["font-variation-settings:'wght' 400", '', "font-variation-settings:'wght' 400"],
    [
      "font-variation-settings:'wght' 100",
      "font-variation-settings:'wght' 400",
      "font-variation-settings:'wght' 400",
    ],

    ['font-variant-ligatures:no-common-ligatures', '', 'font-variant-ligatures:no-common-ligatures'],
    ['font-variant-ligatures:no-common-ligatures', 'inherit', 'font-variant-ligatures:no-common-ligatures'],
    [
      'font-variant-ligatures:normal',
      'font-variant-ligatures:no-common-ligatures',
      'font-variant-ligatures:no-common-ligatures',
    ],
    ['', 'font-variant-ligatures:no-common-ligatures', 'font-variant-ligatures:no-common-ligatures'],

    // SPITextDecorationLine
    ['text-decoration-line:overline', 'text-decoration-line:underline', 'text-decoration-line:underline'],
    [
      'text-decoration:overline',
      'text-decoration:underline',
      'text-decoration:underline;text-decoration-line:underline',
    ],
    [
      'text-decoration:underline',
      'text-decoration:underline',
      'text-decoration:underline;text-decoration-line:underline',
      '',
    ],
    [
      'text-decoration:overline;text-decoration-line:underline',
      'text-decoration:overline',
      'text-decoration:overline;text-decoration-line:overline',
    ],
    [
      'text-decoration:overline;text-decoration-line:underline',
      'text-decoration:underline',
      'text-decoration:underline;text-decoration-line:underline',
      '',
    ],
  ];

  const cases = cascadeCases.map(([parent, child, result, d]): [string, string, string, string] => [
    parent,
    child,
    result,
    d ?? (result === parent ? '' : result),
  ]);
  it.each(cases)('%s | %s', (parent, child, result, diff) => {
    const styleParent = new SPStyle();
    const styleChild = new SPStyle();
    const styleResult = new SPStyle();
    styleParent.mergeString(parent);
    styleChild.mergeString(child);
    styleResult.mergeString(result);

    styleChild.cascade(styleParent);

    expect(styleChild.equals(styleResult)).toBe(true);
    expect(styleResult.writeIfDiff(null)).toBe(result);
    expect(styleResult.writeIfDiff(styleParent)).toBe(diff);
  });
});

describe('SPStyle', () => {
  it('handles !important and the order of declarations', () => {
    const style = new SPStyle();
    style.mergeString('fill:red !important;fill:blue;stroke:green;stroke:yellow');
    expect(style.fill.getValue()).toBe('red');
    expect(style.fill.important).toBe(true);
    expect(style.stroke.getValue()).toBe('yellow');
    expect(style.write()).toBe('fill:red !important;stroke:yellow');
  });

  it('merges a style string over set properties only for !important', () => {
    const style = new SPStyle();
    style.mergeString('fill:red');
    style.mergeString('fill:blue;stroke:green');
    expect(style.write()).toBe('fill:red;stroke:green');
    style.mergeString('fill:blue !important');
    expect(style.write()).toBe('fill:blue !important;stroke:green');
  });

  it('keeps unknown -prefixed properties and drops others', () => {
    const style = new SPStyle();
    const warn = console.warn;
    console.warn = () => {};
    try {
      style.mergeString('-inkscape-foo:bar;--var:1;unknown:2;fill:red');
    } finally {
      console.warn = warn;
    }
    expect(style.write()).toBe('fill:red;-inkscape-foo:bar');
  });

  it('writes with ALWAYS and the IFSET default', () => {
    const style = new SPStyle();
    expect(style.write()).toBe('');
    const all = style.write(SP_STYLE_FLAG_ALWAYS);
    expect(all).toContain('fill:#000000');
    expect(all).toContain('opacity:1');
    expect(all).toContain('stroke-miterlimit:4');
    expect(all).toContain('font-family:sans-serif');
    expect(style.write(SP_STYLE_FLAG_IFSET)).toBe('');
  });

  it('tracks the source of a value', () => {
    const style = new SPStyle();
    style.mergeString('fill:red');
    expect(style.fill.style_src).toBe(SPStyleSrc.STYLE_PROP);
    style.stroke.readIfUnset('blue', SPStyleSrc.ATTRIBUTE);
    expect(style.stroke.style_src).toBe(SPStyleSrc.ATTRIBUTE);
    expect(style.writeSrc(SPStyleSrc.STYLE_PROP)).toBe('fill:red');
    expect(style.writeSrc(SPStyleSrc.ATTRIBUTE)).toBe('stroke:blue');
    style.stroke.readIfUnset('green', SPStyleSrc.STYLE_PROP);
    expect(style.stroke.getValue()).toBe('blue');
  });

  it('does not read an !important value from an attribute and ignores d as attribute', () => {
    const style = new SPStyle();
    style.stroke_width.readIfUnset('5 !important', SPStyleSrc.ATTRIBUTE);
    expect(style.stroke_width.set).toBe(false);
    style.stroke_width.readIfUnset('5 !important', SPStyleSrc.STYLE_PROP);
    expect(style.stroke_width.important).toBe(true);
    style.d.readIfUnset('M 0,0', SPStyleSrc.ATTRIBUTE);
    expect(style.d.set).toBe(false);
    style.d.readIfUnset('M 0,0', SPStyleSrc.STYLE_PROP);
    expect(style.d.getValue()).toBe('M 0,0');
  });

  it('computes relative lengths from the font size', () => {
    const parent = new SPStyle();
    parent.mergeString('font-size:20px');
    const child = new SPStyle();
    child.mergeString('font-size:50%;stroke-width:2em;baseline-shift:super;line-height:150%');
    child.cascade(parent);
    expect(child.font_size.computed).toBe(10);
    expect(child.stroke_width.computed).toBe(20);
    expect(child.line_height.computed).toBe(15);
    expect(child.baseline_shift.computed).toBe(8); // 0.4 of the font size of the parent
    expect(child.stroke_width.getValue()).toBe('2em');
    const bigger = new SPStyle();
    bigger.mergeString('font-size:larger');
    bigger.cascade(parent);
    expect(bigger.font_size.computed).toBe(24);
  });

  it('merges a child with a dying parent', () => {
    const parent = new SPStyle();
    parent.mergeString('fill:red;opacity:0.5;font-weight:bold');
    const child = new SPStyle();
    child.mergeString('opacity:0.5;font-weight:bolder');
    child.merge(parent);
    expect(child.fill.getValue()).toBe('red');
    expect(child.opacity.getValue()).toBe('0.25');
    expect(child.font_weight.getValue()).toBe('bolder');
  });

  it('reads opacity with 24 bit precision', () => {
    const style = new SPStyle();
    style.opacity.read('2');
    expect(style.opacity.value).toBe(SP_SCALE24_MAX);
    style.opacity.read('0.3');
    expect(style.opacity.getValue()).toBe('0.3');
  });

  it('gives the font feature string', () => {
    const style = new SPStyle();
    expect(style.getFontFeatureString()).toBe('normal');
    style.mergeString(
      'font-variant-ligatures:none;font-variant-caps:small-caps;font-variant-numeric:tabular-nums',
    );
    style.cascade(new SPStyle());
    expect(style.getFontFeatureString()).toBe('liga 0, clig 0, calt 0, smcp, tnum');
  });

  it('finds properties by id', () => {
    const style = new SPStyle();
    style.readIfUnset(SPAttr.FILL, 'red');
    expect(style.isSet(SPAttr.FILL)).toBe(true);
    expect(style.isSet(SPAttr.STROKE)).toBe(false);
    style.clear(SPAttr.FILL);
    expect(style.isSet(SPAttr.FILL)).toBe(false);
  });
});

describe('css attr from style', () => {
  it('scales lengths', () => {
    const css = spReprCssAttrNew();
    spReprCssSetProperty(css, 'stroke-width', '2px');
    spReprCssSetProperty(css, 'stroke-dasharray', '1,2 ,3');
    spReprCssSetProperty(css, 'font-size', '10');
    spReprCssSetProperty(css, 'line-height', '1.5em');
    spReprCssSetProperty(css, 'letter-spacing', 'normal');
    spCssAttrScale(css, 2);
    expect(spReprCssProperty(css, 'stroke-width')).toBe('4px');
    expect(spReprCssProperty(css, 'stroke-dasharray')).toBe('2,4 ,6');
    expect(spReprCssProperty(css, 'font-size')).toBe('10'); // only with units
    expect(spReprCssProperty(css, 'line-height')).toBe('1.5em');
    expect(spReprCssProperty(css, 'letter-spacing')).toBe('normal');
  });

  it('unsets text properties and urls', () => {
    const css = spReprCssAttrNew();
    spReprCssSetProperty(css, 'font-size', '10px');
    spReprCssSetProperty(css, 'fill', 'url(#a)');
    spReprCssSetProperty(css, 'stroke', 'red');
    spCssAttrUnsetText(css);
    spCssAttrUnsetUris(css);
    expect(spReprCssProperty(css, 'font-size')).toBeNull();
    expect(spReprCssProperty(css, 'fill')).toBeNull();
    expect(spReprCssProperty(css, 'stroke')).toBe('red');
  });
});
