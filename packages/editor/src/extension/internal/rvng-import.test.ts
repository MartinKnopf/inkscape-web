// SPDX-License-Identifier: GPL-2.0-or-later
// The CorelDRAW, Visio and WordPerfect Graphics import with the upstream sample files
// (testfiles/cli_tests/testcases/librevenge_formats) and the page selection.
import { readFileSync } from 'node:fs';
import { loadRevenge } from '@inkscape-web/wasm/revenge';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../db.ts';
import { Input } from '../input.ts';
import { CdrInput } from './cdr-input.ts';
import { RvngImportDialog, setRevengeBackendLoader } from './rvng-import-dialog.ts';
import { VsdInput } from './vsd-input.ts';
import { WpgInput } from './wpg-input.ts';

const sample = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../../../testfiles/librevenge_formats/${name}`, import.meta.url)));
const input = (id: string) => db.get(id) as Input;

beforeAll(() => {
  setRevengeBackendLoader(() => loadRevenge());
  CdrInput.init();
  VsdInput.init();
  WpgInput.init();
});

afterEach(() => {
  RvngImportDialog.show_dialog = null;
});

describe('librevenge input', () => {
  it('registers the upstream modules', () => {
    for (const id of ['cdr', 'cdt', 'ccx', 'cmx', 'vsd', 'vdx', 'vsdm', 'vsdx', 'wpg']) {
      expect(input(`org.inkscape.input.${id}`).get_extension()).toBe(`.${id}`);
    }
  });

  it('opens a CorelDRAW file', async () => {
    const doc = await input('org.inkscape.input.cdr').open('corel_draw2.cdr', sample('corel_draw2.cdr'));
    expect(doc).not.toBeNull();
    const root = doc!.getRoot();
    expect(root.getRepr().attribute('width')).toBe('8.2677in');
    expect(root.viewBox.width()).toBeCloseTo(595.2756);
    expect(doc!.getObjectsByElement('path').length).toBeGreaterThan(0);
  });

  it('opens Visio VSD and VSDX files', async () => {
    for (const [id, file] of [
      ['vsd', 'visio.vsd'],
      ['vsdx', 'visio.vsdx'],
    ]) {
      const doc = await input(`org.inkscape.input.${id}`).open(file!, sample(file!));
      expect(doc?.getRoot().viewBox_set).toBe(true);
    }
  });

  it('opens a WordPerfect Graphics file', async () => {
    const doc = await input('org.inkscape.input.wpg').open('word_perfect.wpg', sample('word_perfect.wpg'));
    expect(doc!.getRoot().viewBox.width()).toBeCloseTo(29.76);
    expect(doc!.getObjectsByElement('image')[0]!.getRepr().attribute('xlink:href')).toMatch(
      /^data:image\/bmp;base64,/,
    );
  });

  it('returns null for data of another format', async () => {
    expect(await input('org.inkscape.input.cdr').open('visio.cdr', sample('visio.vsd'))).toBeNull();
    expect(await input('org.inkscape.input.wpg').open('visio.wpg', sample('visio.vsd'))).toBeNull();
  });

  it('opens the first page without a dialog', async () => {
    const doc = await input('org.inkscape.input.vdx').open('two_pages.vdx', sample('two_pages.vdx'));
    expect(doc!.getRoot().getRepr().attribute('width')).toBe('4.0000in');
  });

  it('asks for the page of a document with more pages', async () => {
    let shown: RvngImportDialog | null = null;
    RvngImportDialog.show_dialog = async (dlg) => {
      shown = dlg;
      expect(dlg.num_pages).toBe(2);
      expect(dlg.totalPagesLabel()).toBe('out of 2');
      expect(dlg.previewSvg()).toContain('width="4.0000in"');
      dlg.setPageNumber(5); // clamped
      expect(dlg.getSelectedPage()).toBe(2);
      expect(dlg.previewSvg()).toContain('width="2.0000in"');
      return true;
    };
    const doc = await input('org.inkscape.input.vdx').open('two_pages.vdx', sample('two_pages.vdx'));
    expect(shown).not.toBeNull();
    expect(doc!.getRoot().getRepr().attribute('width')).toBe('2.0000in');
  });

  it('throws open_cancelled when the page selection is cancelled', async () => {
    RvngImportDialog.show_dialog = async () => false;
    await expect(
      input('org.inkscape.input.vdx').open('two_pages.vdx', sample('two_pages.vdx')),
    ).rejects.toBeInstanceOf(Input.open_cancelled);
  });
});

describe('RvngImportDialog', () => {
  it('shows "No preview" for a page that is not SVG', () => {
    const dlg = new RvngImportDialog(['not svg']);
    expect(dlg.previewSvg()).toContain('No preview');
  });
});
