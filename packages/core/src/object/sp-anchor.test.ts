// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { SPDocument } from '../document.ts';
import { SPAnchor } from './sp-anchor.ts';

const doc = () =>
  SPDocument.createNewDocFromMem(
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">' +
      '<a id="ext" xlink:href="https://inkscape.org" xlink:title="Home"><rect width="10" height="10"/></a>' +
      '<a id="int" xlink:href="#target"><circle r="5"/></a><rect id="target" width="1" height="1"/></svg>',
  )!;

describe('SPAnchor', () => {
  it('reads the link and describes it', () => {
    const a = doc().getObjectById('ext') as SPAnchor;
    expect(a).toBeInstanceOf(SPAnchor);
    expect(a.href).toBe('https://inkscape.org');
    expect(a.xlink_title).toBe('Home');
    expect(a.typeName()).toBe('link');
    expect(a.description()).toBe('to https://inkscape.org');
    expect(a.getItemCount()).toBe(1);
  });

  it('follows a local link to its object', () => {
    const d = doc();
    const a = d.getObjectById('int') as SPAnchor;
    expect(a.local_link?.getObject()).toBe(d.getObjectById('target'));
  });
});
