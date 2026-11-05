// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tools/booleans-tool.cpp, src/ui/tools/booleans-builder.cpp, src/ui/tools/booleans-subitems.cpp
// @vitest-environment happy-dom
import { Preferences, SPPath } from '@inkscape-web/core';
import { PathVector } from '@inkscape-web/geom';
import { afterEach, describe, expect, it } from 'vitest';
import { get_active_tool, tool_switch } from '../../actions/actions-tools.ts';
import type { InteractiveBooleansTool } from './booleans-tool.ts';
import { key, line, pointer, setupDesktop, stroke, useWasmBackend } from './tool-test-utils.ts';

await useWasmBackend();

afterEach(() => Preferences.get().remove('/tools/booleans/mode'));

// Two overlapping squares: red below, blue above. The mosaic has three fragments.
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">' +
  '<rect id="a" x="0" y="0" width="40" height="40" style="fill:#ff0000"/>' +
  '<rect id="b" x="20" y="20" width="40" height="40" style="fill:#0000ff"/></svg>';

/** The shape builder on both squares. */
function setup(ids = ['a', 'b']) {
  const t = setupDesktop(SVG, 'Select');
  t.dt.getSelection().setList(ids.map((id) => t.item(id)));
  tool_switch('Booleans', t.dt);
  const tool = t.dt.getTool() as InteractiveBooleansTool;
  const paths = () => t.doc.getRoot().children.filter((c): c is SPPath => c instanceof SPPath);
  return { ...t, tool, paths };
}

const area = (p: SPPath) => {
  const b = PathVector.boundsExact(p.curve() ?? []);
  return b ? b.width() * b.height() : 0;
};

describe('InteractiveBooleansTool', () => {
  it('cuts the selection into its fragments, styled like the topmost item', () => {
    const { tool } = setup();
    const items = tool.boolean_builder?.work_items() ?? [];
    expect(items).toHaveLength(3);
    const ids = items.map((s) => s.get_item()?.getId()).sort();
    // The overlap belongs to the blue square on top.
    expect(ids).toEqual(['a', 'b', 'b']);
  });

  it('a drag unites fragments; Enter writes the united shapes to the document in one undo step', () => {
    const { dt, svg, tool, paths, undoSteps } = setup();
    stroke(svg, line(10, 10, 30, 30));
    expect(tool.boolean_builder?.work_items()).toHaveLength(2);
    key(svg, 'Enter');

    expect(get_active_tool(dt)).toBe('Select');
    // Only the built (selected) shapes are kept, with the style of the fragment where the drag started.
    const result = paths();
    expect(result).toHaveLength(1);
    const [united] = result;
    expect(united?.getRepr().attribute('style')).toContain('fill:#ff0000');
    expect(united && area(united)).toBe(40 * 40);
    expect(dt.getSelection().items()).toEqual(result);
    expect(undoSteps()).toEqual(['Built Shapes']);
  });

  it('without built shapes, Enter keeps all remaining fragments', () => {
    const { svg, paths } = setup();
    pointer(svg, 'pointerdown', 50, 50, 1, { shiftKey: true });
    pointer(svg, 'pointerup', 50, 50, 0, { shiftKey: true });
    key(svg, 'Enter');
    expect(paths()).toHaveLength(2);
  });

  it('Shift+click deletes a fragment, and the builder undoes it', () => {
    const { svg, tool } = setup();
    pointer(svg, 'pointerdown', 50, 50, 1, { shiftKey: true });
    pointer(svg, 'pointerup', 50, 50, 0, { shiftKey: true });
    expect(tool.boolean_builder?.work_items()).toHaveLength(2);
    expect(tool.boolean_builder?.has_changes()).toBe(true);
    tool.boolean_builder?.undo();
    expect(tool.boolean_builder?.work_items()).toHaveLength(3);
  });

  it('the delete mode swaps the meaning of Shift', () => {
    Preferences.get().setInt('/tools/booleans/mode', 1);
    const { tool } = setup();
    expect(tool.should_add({ shiftKey: false, ctrlKey: false, metaKey: false, altKey: false })).toBe(false);
    expect(tool.should_add({ shiftKey: true, ctrlKey: false, metaKey: false, altKey: false })).toBe(true);
  });

  it('Escape cancels without changes, a selection change cancels too', () => {
    const { dt, svg, item, undoSteps } = setup();
    stroke(svg, line(10, 10, 30, 30));
    key(svg, 'Escape'); // cancels the task: nothing
    key(svg, 'Escape'); // cancels the tool
    expect(get_active_tool(dt)).toBe('Select');
    expect(item('a')).toBeTruthy();
    expect(undoSteps()).toEqual([]);

    const again = setup();
    again.dt.getSelection().clear();
    expect(get_active_tool(again.dt)).toBe('Select');
  });

  it('is not ready without a selection: the selector stays active', () => {
    const { dt } = setup([]);
    expect(get_active_tool(dt)).toBe('Select');
  });
});
