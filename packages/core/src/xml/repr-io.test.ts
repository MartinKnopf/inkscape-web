// SPDX-License-Identifier: GPL-2.0-or-later
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { upstreamRoot } from '../../../../upstream/scripts/upstream.ts';
import { readMem, saveBuf, writeBuf } from './repr-io.ts';
import { SVG_NS_URI } from './repr-util.ts';

const examplesDir = join(upstreamRoot, 'share/examples');
const examples = readdirSync(examplesDir).filter((f) => /\.svgz?$/.test(f));

const read = (text: string) => {
  const doc = readMem(text, SVG_NS_URI);
  if (!doc) throw new Error('parse failed');
  return doc;
};

describe('readMem', () => {
  it('gives elements and attributes the normalized namespace prefix', () => {
    const doc =
      read(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:s="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"
      xmlns:ink="http://www.inkscape.org/namespaces/inkscape"><s:namedview ink:zoom="2"/><rect ink:label="r"/></svg>`);
    const root = doc.root()!;
    expect(root.name()).toBe('svg:svg');
    expect(root.firstChild()!.name()).toBe('sodipodi:namedview');
    expect(root.firstChild()!.attribute('inkscape:zoom')).toBe('2');
    expect(root.lastChild()!.attribute('inkscape:label')).toBe('r');
  });

  it('maps the old sodipodi namespace URI to sodipodi', () => {
    const doc = read(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:x="http://inkscape.sourceforge.net/DTD/sodipodi-0.dtd"><x:namedview/></svg>',
    );
    expect(doc.root()!.firstChild()!.name()).toBe('sodipodi:namedview');
  });

  it('puts elements without a namespace into svg', () => {
    expect(read('<svg><rect/></svg>').root()!.firstChild()!.name()).toBe('svg:rect');
  });

  it('drops whitespace-only text unless xml:space is preserve', () => {
    const doc = read(`<svg xmlns="http://www.w3.org/2000/svg">
      <text> <tspan> </tspan></text>
      <text xml:space="preserve"> <tspan> </tspan></text></svg>`);
    const [t1, t2] = [...doc.root()!.children()];
    expect(t1!.childCount()).toBe(1);
    expect(t1!.firstChild()!.childCount()).toBe(0);
    expect(t2!.childCount()).toBe(2);
    expect(t2!.firstChild()!.content()).toBe(' ');
  });

  it('keeps comments, processing instructions and CDATA', () => {
    const doc = read('<?xml-stylesheet href="a.css"?><!-- c --><svg><style><![CDATA[a{}]]></style></svg>');
    const [pi, comment, svg] = [...doc.children()];
    expect([pi!.type(), pi!.name(), pi!.content()]).toEqual(['pi', 'xml-stylesheet', 'href="a.css"']);
    expect([comment!.type(), comment!.content()]).toEqual(['comment', ' c ']);
    const text = svg!.firstChild()!.firstChild()!;
    expect([text.content(), text.isCData()]).toEqual(['a{}', true]);
  });

  it('expands entities from the internal DTD (Illustrator files use them)', () => {
    const doc = read(`<!DOCTYPE svg [<!ENTITY ns_svg "http://www.w3.org/2000/svg"><!ENTITY w "10">]>
      <svg xmlns="&ns_svg;"><rect width="&w;"/></svg>`);
    expect(doc.root()!.firstChild()!.name()).toBe('svg:rect');
    expect(doc.root()!.firstChild()!.attribute('width')).toBe('10');
  });

  it('returns null for broken XML', () => {
    expect(readMem('<svg><g></svg>', SVG_NS_URI)).toBeNull();
  });
});

describe('saveBuf', () => {
  it('writes the upstream format', () => {
    const doc =
      read(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
      width="10"><!-- c --><g inkscape:label="L"><rect id="r" x="1"/><text xml:space="preserve">a<tspan>b</tspan></text></g><desc>x&amp;y&lt;"
z</desc></svg>`);
    expect(saveBuf(doc, SVG_NS_URI)).toBe(`<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg
   width="10"
   xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
   xmlns="http://www.w3.org/2000/svg"
   xmlns:svg="http://www.w3.org/2000/svg">
  <!-- c -->
  <g
     inkscape:label="L">
    <rect
       id="r"
       x="1" />
    <text
       xml:space="preserve">a<tspan>b</tspan></text>
  </g>
  <desc>x&amp;y&lt;&quot;
z</desc>
</svg>
`);
  });

  it.each(examples)('round-trips %s', (file) => {
    const data = readFileSync(join(examplesDir, file));
    const text = (file.endsWith('.svgz') ? gunzipSync(data) : data).toString('utf8');
    const once = saveBuf(read(text), SVG_NS_URI);
    expect(saveBuf(read(once), SVG_NS_URI)).toBe(once);
  });

  it('writes a subtree with writeBuf', () => {
    const doc = read('<svg><g><rect/></g></svg>');
    expect(writeBuf(doc.root()!.firstChild()!)).toBe('<svg:g><svg:rect /></svg:g>');
  });
});
