// SPDX-License-Identifier: GPL-2.0-or-later
import { parse_svg_path, write_svg_path } from '@inkscape-web/geom';
import { loadGeom } from '@inkscape-web/wasm';
import { describe, expect, it } from 'vitest';
import { SPDocument } from '../document.ts';
import { DocumentUndo } from '../document-undo.ts';
import { Effect } from '../live_effects/effect.ts';
import { setPathBoolopBackend } from '../path/path-boolop.ts';
import { SPGroup } from './sp-item-group.ts';
import type { SPLPEItem } from './sp-lpe-item.ts';
import { SPPath } from './sp-path.ts';

setPathBoolopBackend(await loadGeom());
SPDocument.scheduleIdle = () => {};

const NS = 'xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"';
const open = (body: string) => {
  const doc = SPDocument.createNewDocFromMem(
    `<svg xmlns="http://www.w3.org/2000/svg" ${NS}><defs/>${body}</svg>`,
  );
  if (!doc) throw new Error('parse failed');
  doc.ensureUpToDate();
  return doc;
};
/** Path data with absolute commands and no shorthands, to compare geometry. */
const norm = (d: string | null | undefined) =>
  d == null ? d : write_svg_path(parse_svg_path(d), 6, false, false);
const item = (doc: SPDocument, id: string) => doc.getObjectById(id) as SPLPEItem;
/** Apply an effect with parameters, as the Path Effects dialog does, then update the document. */
const apply = (doc: SPDocument, id: string, key: string, params: Record<string, string> = {}) => {
  const it = item(doc, id);
  Effect.createAndApply(key, doc, it);
  const lpe = it.getCurrentLPE();
  for (const [k, v] of Object.entries(params)) lpe?.getRepr()?.setAttribute(k, v);
  doc.ensureUpToDate();
  return lpe;
};

describe('SPLPEItem', () => {
  it('keeps the original path in inkscape:original-d and writes the result to d', () => {
    const doc = open('<path id="p" d="M 0,0 L 10,0 L 10,10"/>');
    apply(doc, 'p', 'mirror_symmetry', { start_point: '20,0', end_point: '20,10' });
    const p = item(doc, 'p');
    expect(norm(p.getAttribute('inkscape:original-d'))).toBe(norm('M 0,0 L 10,0 L 10,10'));
    expect(p.getAttribute('inkscape:path-effect')).toMatch(/^#path-effect\d+$/);
    expect(norm(p.getAttribute('d'))).toBe(norm('M 0,0 H 10 V 10 M 40,0 H 30 V 10'));
  });

  it('reads a saved effect stack and recomputes it from original-d', () => {
    const doc = open(
      '<path id="p" d="M 0,0" inkscape:original-d="M 0,0 L 10,0" inkscape:path-effect="#e"/>'.replace(
        '<path',
        '<inkscape:path-effect id="e" effect="mirror_symmetry" start_point="0,5" end_point="10,5" mode="free" lpeversion="1.2"/><path',
      ),
    );
    const p = item(doc, 'p') as SPPath;
    expect(p.hasPathEffect()).toBe(true);
    p.update_patheffect(true);
    expect(norm(p.getAttribute('d'))).toBe(norm('M 0,0 H 10 M 0,10 H 10'));
  });

  it('stacks two effects in order', () => {
    const doc = open('<path id="p" d="M 0,0 L 10,0"/>');
    apply(doc, 'p', 'mirror_symmetry', { start_point: '0,5', end_point: '10,5' });
    apply(doc, 'p', 'mirror_symmetry', { start_point: '20,0', end_point: '20,10' });
    const p = item(doc, 'p') as SPPath;
    expect(p.path_effect_list).toHaveLength(2);
    // The second mirror doubles the result of the first one.
    expect(p.curve()).toHaveLength(4);
    p.upCurrentPathEffect();
    expect(p.getAttribute('inkscape:path-effect')?.split(';')).toHaveLength(2);
  });

  it('removes all effects and keeps the paths (Object to Path)', () => {
    const doc = open('<path id="p" d="M 0,0 L 10,0"/>');
    apply(doc, 'p', 'mirror_symmetry', { start_point: '0,5', end_point: '10,5' });
    const p = item(doc, 'p').removeAllPathEffects(true);
    expect(p?.getAttribute('inkscape:path-effect')).toBeNull();
    expect(p?.getAttribute('inkscape:original-d')).toBeNull();
    expect(norm(p?.getAttribute('d'))).toBe(norm('M 0,0 H 10 M 0,10 H 10'));
  });

  it('removing an effect without keeping paths restores the original', () => {
    const doc = open('<path id="p" d="M 0,0 L 10,0"/>');
    apply(doc, 'p', 'mirror_symmetry', { start_point: '0,5', end_point: '10,5' });
    item(doc, 'p').removeCurrentPathEffect(false);
    doc.ensureUpToDate();
    const p = item(doc, 'p');
    expect(norm(p.getAttribute('d'))).toBe(norm('M 0,0 L 10,0'));
    expect(p.hasPathEffect()).toBe(false);
  });

  it('turns a rect with an effect into a path; flattening gives a plain path', () => {
    const doc = open('<rect id="r" x="0" y="0" width="10" height="10"/>');
    apply(doc, 'r', 'mirror_symmetry', { start_point: '20,0', end_point: '20,10' });
    const r = item(doc, 'r');
    expect(r.getRepr().name()).toBe('svg:path');
    expect(r.getAttribute('sodipodi:type')).toBe('rect');
    const flat = r.removeAllPathEffects(true);
    expect(flat).toBeInstanceOf(SPPath);
    expect(norm(flat?.getAttribute('d'))).toBe(norm('M 0,0 H 10 V 10 H 0 Z M 40,0 H 30 V 10 H 40 Z'));
  });

  it('applies a group effect to the paths in the group', () => {
    const doc = open('<g id="g"><path id="a" d="M 0,0 L 10,0"/><path id="b" d="M 0,2 L 10,2"/></g>');
    apply(doc, 'g', 'mirror_symmetry', { start_point: '0,5', end_point: '10,5' });
    expect(item(doc, 'g')).toBeInstanceOf(SPGroup);
    expect(norm(item(doc, 'a').getAttribute('inkscape:original-d'))).toBe(norm('M 0,0 L 10,0'));
    expect(norm(item(doc, 'a').getAttribute('d'))).toBe(norm('M 0,0 H 10 M 0,10 H 10'));
    expect(norm(item(doc, 'b').getAttribute('d'))).toBe(norm('M 0,2 H 10 M 0,8 H 10'));
  });

  it('undoes applying an effect in one step', () => {
    const doc = open('<path id="p" d="M 0,0 L 10,0"/>');
    apply(doc, 'p', 'mirror_symmetry', { start_point: '0,5', end_point: '10,5' });
    DocumentUndo.done(doc, 'Create and apply path effect');
    DocumentUndo.undo(doc);
    const p = item(doc, 'p');
    expect(norm(p.getAttribute('d'))).toBe(norm('M 0,0 L 10,0'));
    expect(p.getAttribute('inkscape:path-effect')).toBeNull();
    expect(p.hasPathEffect()).toBe(false);
    DocumentUndo.redo(doc);
    expect(norm(item(doc, 'p').getAttribute('d'))).toBe(norm('M 0,0 H 10 M 0,10 H 10'));
  });
});
