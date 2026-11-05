// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-node-align.cpp
// @vitest-environment happy-dom
import { Preferences } from '@inkscape-web/core';
import { X, Y } from '@inkscape-web/geom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InkscapeApplication } from '../inkscape-application.ts';
import { AlignTargetNode } from '../ui/tool/node-types.ts';
import { NodeTool } from '../ui/tools/node-tool.ts';
import { setupDesktop } from '../ui/tools/tool-test-utils.ts';
import { output_signal } from './actions-helper.ts';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><path id="p" d="M0,0 L10,5 L20,0"/></svg>';

function setup(tool = 'Node') {
  const s = setupDesktop(SVG, tool);
  const app = InkscapeApplication.instance();
  app.set_active_desktop(s.dt);
  const nodeTool = s.dt.getTool();
  const multipath = nodeTool instanceof NodeTool ? nodeTool._multipath : null;
  const align = multipath ? vi.spyOn(multipath, 'alignNodes') : null;
  const distribute = multipath ? vi.spyOn(multipath, 'distributeNodes') : null;
  const run = (action: string) => {
    const lines: string[] = [];
    const off = output_signal.connect((l) => lines.push(l));
    app.activate_action(action);
    off();
    return lines;
  };
  return { ...s, align, distribute, run };
}

afterEach(() => InkscapeApplication.instance().set_active_desktop(null));

describe('node align and distribute actions', () => {
  it('align the nodes to the target of the argument, by default the middle', () => {
    const { align, run } = setup();
    run('win.node-align-horizontal("min")');
    run('win.node-align-vertical("last")');
    run('win.node-align-horizontal("")');
    expect(align?.mock.calls).toEqual([
      [X, AlignTargetNode.MIN_NODE],
      [Y, AlignTargetNode.LAST_NODE],
      [X, AlignTargetNode.MID_NODE],
    ]);
  });

  it('take the target of "pref" from the preferences', () => {
    const { align, run } = setup();
    const prefs = Preferences.get();
    prefs.setString('/dialogs/align/nodes-align-to', 'max');
    run('win.node-align-vertical("pref")');
    prefs.setString('/dialogs/align/nodes-align-to', 'first');
    expect(align?.mock.calls).toEqual([[Y, AlignTargetNode.MAX_NODE]]);
  });

  it('refuse more than one argument', () => {
    const { align, run } = setup();
    expect(run('win.node-align-horizontal("min max")')).toEqual(['node_align: too many arguments!']);
    expect(align).not.toHaveBeenCalled();
  });

  it('distribute the nodes in one direction', () => {
    const { distribute, run } = setup();
    run('win.node-distribute-horizontal');
    run('win.node-distribute-vertical');
    expect(distribute?.mock.calls).toEqual([[X], [Y]]);
  });

  it('need the node tool', () => {
    const { run } = setup('Select');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    run('win.node-distribute-horizontal');
    expect(warn).toHaveBeenCalledWith('node_distribute: tool is not Node tool!');
    warn.mockRestore();
  });
});
