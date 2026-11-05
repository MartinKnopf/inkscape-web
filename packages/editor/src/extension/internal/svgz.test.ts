// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/internal/svgz.cpp
import { SPDocument } from '@inkscape-web/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../db.ts';
import type { Input } from '../input.ts';
import type { Output } from '../output.ts';
import { gunzip, SP_MODULE_KEY_INPUT_SVGZ, SP_MODULE_KEY_OUTPUT_SVGZ, Svgz } from './svgz.ts';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="10" height="10">' +
  '<rect id="r" inkscape:label="x" width="5" height="5"/></svg>';

beforeAll(() => Svgz.init());

describe('SVGZ', () => {
  it('saves gzip data, and the plain output has no Inkscape attributes', async () => {
    const doc = SPDocument.createNewDocFromMem(SVG)!;
    const plain = (await (db.get(SP_MODULE_KEY_OUTPUT_SVGZ) as Output).save(doc, 'a.svgz'))!;
    expect([plain[0], plain[1]]).toEqual([0x1f, 0x8b]);
    const text = new TextDecoder().decode(await gunzip(plain));
    expect(text).toContain('<rect');
    expect(text).not.toContain('inkscape:label');

    const full = (await (db.get('org.inkscape.output.svgz.inkscape') as Output).save(doc, 'a.svgz'))!;
    expect(new TextDecoder().decode(await gunzip(full))).toContain('inkscape:label="x"');
  });

  it('opens what it saved', async () => {
    const doc = SPDocument.createNewDocFromMem(SVG)!;
    const data = (await (db.get('org.inkscape.output.svgz.inkscape') as Output).save(doc, 'a.svgz'))!;
    const back = await (db.get(SP_MODULE_KEY_INPUT_SVGZ) as Input).open('a.svgz', data);
    expect(back?.getObjectById('r')).toBeTruthy();
  });
});
