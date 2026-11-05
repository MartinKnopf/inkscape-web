// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/file.cpp, src/extension/template.cpp
import { SPDocument } from '@inkscape-web/core';
import { Template } from '@inkscape-web/editor';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryStore } from './kv-store.ts';
import { load_template_files, save_template, setUserTemplateStore } from './templates.ts';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>';

beforeEach(() => {
  Template.files.clear();
  setUserTemplateStore(memoryStore<string>());
});

afterEach(() => {
  setUserTemplateStore(null);
  vi.unstubAllGlobals();
});

describe('user templates', () => {
  it('saves a template under its escaped name, and as the default template on request', async () => {
    const doc = SPDocument.createNewDocFromMem(SVG)!;
    expect(await save_template(doc, '', '', false)).toBe(false);

    expect(await save_template(doc, 'My/card', 'Short', false)).toBe(true);
    expect([...Template.files.keys()]).toEqual(['My%2Fcard.svg']);
    expect(Template.files.get('My%2Fcard.svg')).toContain('<inkscape:shortdesc>Short</inkscape:shortdesc>');

    await save_template(doc, 'Mine', '', true);
    expect(Template.files.get('default.svg')).toBe(Template.files.get('Mine.svg'));
  });

  it('loads the bundled templates without icons, then the user templates, which can replace the default', async () => {
    const files: Record<string, string> = {
      '/share/templates/index.json': JSON.stringify(['default.svg', 'icons/custom.svg', 'zine.svg']),
      '/share/templates/default.svg': 'bundled default',
      '/share/templates/zine.svg': 'zine',
    };
    vi.stubGlobal('fetch', async (url: string) =>
      url in files
        ? { ok: true, text: async () => files[url], json: async () => JSON.parse(files[url]!) }
        : { ok: false },
    );
    const doc = SPDocument.createNewDocFromMem(SVG)!;
    await save_template(doc, 'Mine', '', true);
    const saved = Template.files.get('default.svg');
    Template.files.clear();

    await load_template_files();
    expect([...Template.files.keys()].sort()).toEqual(['Mine.svg', 'default.svg', 'zine.svg']);
    expect(Template.files.get('default.svg')).toBe(saved);
    expect(Template.files.get('zine.svg')).toBe('zine');
  });
});
