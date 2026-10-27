// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: testfiles/src/colors/xml-color-test.cpp
import { describe, expect, it } from 'vitest';
import { Color } from './color.ts';
import { NoColor, paint_to_xml_string, xml_string_to_paint } from './xml-color.ts';

const nocolor = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<paint>
  <nocolor />
</paint>
`;

const rgb = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<paint>
  <color
     space="RGB"
     opacity="0.2666666667"
     r="0.8117647059"
     g="0.1960784314"
     b="0.0705882353" />
</paint>
`;

const hsl = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<paint>
  <color
     space="HSL"
     h="0.5"
     s="1"
     l="1" />
</paint>
`;

describe('paint xml', () => {
  it('writes a paint', () => {
    expect(paint_to_xml_string()).toBe(nocolor);
    expect(paint_to_xml_string(new NoColor())).toBe(nocolor);
    expect(paint_to_xml_string(new Color(0xcf321244))).toBe(rgb);
    expect(paint_to_xml_string(Color.parse('hsl(180,100,100)')!)).toBe(hsl);
  });

  it('reads a paint', () => {
    expect(xml_string_to_paint(nocolor)).toBeInstanceOf(NoColor);
    expect((xml_string_to_paint(rgb) as Color).toString()).toBe('#cf321244');
    expect((xml_string_to_paint(hsl) as Color).toString()).toBe('hsl(180, 100%, 100%)');
  });

  it('keeps the name of a color', () => {
    const color = new Color(0xcf321244);
    color.setName('Rusty');
    const back = xml_string_to_paint(paint_to_xml_string(color)) as Color;
    expect(back.getName()).toBe('Rusty');
    expect(back.toString()).toBe('#cf321244');
  });

  it('rejects data without a color', () => {
    expect(() => xml_string_to_paint('<paint />')).toThrow();
    expect(() => xml_string_to_paint('<paint><color space="Nope" /></paint>')).toThrow();
    expect(() => xml_string_to_paint('<paint><color /></paint>')).toThrow();
  });
});
