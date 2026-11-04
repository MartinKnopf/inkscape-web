// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tools/object-picker-tool.cpp
// @vitest-environment happy-dom
import type { SPObject } from '@inkscape-web/core';
import { afterEach, describe, expect, it } from 'vitest';
import { get_active_tool, tool_switch } from '../../actions/actions-tools.ts';
import type { ObjectPickerTool } from './object-picker-tool.ts';
import { mockHitTest, pointer, setupDesktop, unmockHitTest } from './tool-test-utils.ts';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">' +
  '<rect id="a" x="10" y="10" width="20" height="20"/></svg>';

afterEach(unmockHitTest);

describe('ObjectPickerTool', () => {
  it('reports the clicked object and stays active if the handler returns true', () => {
    const { doc, dt, svg } = setupDesktop(SVG, 'Select');
    mockHitTest(doc, dt);
    tool_switch('Picker', dt);
    const picked: (string | null)[] = [];
    (dt.getTool() as ObjectPickerTool).object_picked.handler = (o: SPObject) => {
      picked.push(o.getId());
      return true;
    };
    pointer(svg, 'pointerdown', 20, 20, 1);
    expect(picked).toEqual(['a']);
    expect(get_active_tool(dt)).toBe('Picker');
  });

  it('switches back to the previous tool when nothing claims the click', () => {
    const { doc, dt, svg } = setupDesktop(SVG, 'Rect');
    mockHitTest(doc, dt);
    tool_switch('Picker', dt);
    pointer(svg, 'pointerdown', 20, 20, 1);
    expect(get_active_tool(dt)).toBe('Rect');
  });

  it('ignores clicks on empty canvas', () => {
    const { doc, dt, svg } = setupDesktop(SVG, 'Rect');
    mockHitTest(doc, dt);
    tool_switch('Picker', dt);
    pointer(svg, 'pointerdown', 300, 200, 1);
    expect(get_active_tool(dt)).toBe('Picker');
  });
});
