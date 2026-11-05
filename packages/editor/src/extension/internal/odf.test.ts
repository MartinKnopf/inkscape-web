// SPDX-License-Identifier: LGPL-2.1-or-later
// Upstream: src/extension/internal/odf.cpp
import { SPDocument } from '@inkscape-web/core';
import { Affine } from '@inkscape-web/geom';
import { beforeAll, describe, expect, it } from 'vitest';
import { readZip } from '../../../../core/src/util/ziptool-test-utils.ts';
import { db } from '../db.ts';
import type { Output } from '../output.ts';
import { analyzeTransform, OdfOutput } from './odf.ts';

// A 1x1 transparent PNG
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ' +
  'xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:cc="http://creativecommons.org/ns#" ' +
  'xmlns:dc="http://purl.org/dc/elements/1.1/" width="100" height="100">' +
  '<metadata><rdf:RDF><cc:Work><dc:creator>Jane</dc:creator></cc:Work></rdf:RDF></metadata>' +
  '<defs><linearGradient id="lg"><stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/></linearGradient></defs>' +
  '<g id="g1">' +
  '<rect id="r1" x="10" y="20" width="30" height="40" style="fill:#ff8000;stroke:#000000;stroke-width:2"/>' +
  '<rect id="r2" x="50" y="20" width="30" height="40" style="fill:#ff8000;stroke:#000000;stroke-width:2"/>' +
  '</g>' +
  '<rect id="r3" x="0" y="0" width="10" height="10" style="fill:url(#lg);stroke:none"/>' +
  `<image id="i1" x="60" y="60" width="20" height="20" xlink:href="data:image/png;base64,${PNG}"/>` +
  '</svg>';

async function save(): Promise<Map<string, string>> {
  OdfOutput.init();
  const doc = SPDocument.createNewDocFromMem(SVG)!;
  const data = await (db.get('org.inkscape.output.odf') as Output).save(doc, 'a.odg');
  const entries = await readZip(data!);
  return new Map(entries.map((e) => [e.name, new TextDecoder().decode(e.data)]));
}

describe('analyzeTransform', () => {
  it('gives the scale and the cosine of the rotation', () => {
    const rot = analyzeTransform(new Affine(0, 2, -2, 0, 5, 5)); // 2x scale, rotated by 90 degrees
    expect(rot.xscale).toBeCloseTo(2);
    expect(rot.yscale).toBeCloseTo(2);
    expect(rot.rotate).toBeCloseTo(0);
    const skew = analyzeTransform(new Affine(3, 0, 0, 1, 0, 0));
    expect([skew.xscale, skew.yscale, skew.rotate]).toEqual([3, 1, 1]);
    // A reflection has no rotation in the diagonal: [[1, 0], [0, -1]]
    const flip = analyzeTransform(new Affine(1, 0, 0, -1, 0, 0));
    expect([flip.xscale, flip.yscale, flip.rotate]).toEqual([1, 1, 1]);
  });
});

describe('OpenDocument output', () => {
  let files: Map<string, string>;
  beforeAll(async () => {
    files = await save();
  });

  it('is a zip of the manifest, content, styles and meta files and the pictures', () => {
    expect([...files.keys()].sort()).toEqual(
      ['META-INF/manifest.xml', 'Pictures/image0.png', 'content.xml', 'meta.xml', 'styles.xml'].sort(),
    );
    expect(files.get('META-INF/manifest.xml')).toContain(
      '<manifest:file-entry manifest:media-type="image/png" manifest:full-path="Pictures/image0.png"/>',
    );
  });

  it('writes the metadata of the document', () => {
    const meta = files.get('meta.xml')!;
    expect(meta).toContain('<meta:initial-creator>Jane</meta:initial-creator>');
    expect(meta).toContain('<dc:creator>Jane</dc:creator>');
  });

  it('writes groups and paths in cm, and shares the style of equal objects', () => {
    const content = files.get('content.xml')!;
    expect(content).toContain('<draw:g id="g1">');
    expect(content).toContain('</draw:g> <!-- id="g1" -->');
    // r1: the visual bounding box (stroke 1 px each side) 9..41 x 19..61 px at 0.03 cm per px
    expect(content).toContain(
      '<draw:path id="r1" draw:style-name="style0" draw:layer="layout" svg:x="0.270cm" svg:y="0.570cm" svg:width="0.960cm" svg:height="1.260cm"',
    );
    expect(content).toContain('<draw:path id="r2" draw:style-name="style0"');
    expect(content).toContain('<!-- 5 nodes -->');
    const styles = files.get('styles.xml')!;
    expect(styles).toContain(
      '<style:style style:name="style0" style:family="graphic" style:parent-style-name="standard">',
    );
    expect(styles).toContain('draw:fill="solid" draw:fill-color="#ff8000"');
    expect(styles).toContain('svg:stroke-width="2.000pt" svg:stroke-color="#000000"');
  });

  it('writes a gradient fill as an ODF gradient', () => {
    const styles = files.get('styles.xml')!;
    expect(styles).toContain(
      '<draw:gradient draw:name="ImportedLinearGradient0" draw:display-name="ImportedLinearGradient0" draw:style="linear" draw:start-color="#ff0000" draw:end-color="#0000ff"',
    );
    expect(styles).toContain('draw:fill="gradient" draw:fill-gradient-name="ImportedLinearGradient0"');
  });

  it('writes an embedded image as a frame that refers to the picture file', () => {
    const content = files.get('content.xml')!;
    expect(content).toContain('<draw:frame id="i1" draw:style-name="gr1"');
    expect(content).toContain('<draw:image xlink:href="Pictures/image0.png" xlink:type="simple"');
  });
});
