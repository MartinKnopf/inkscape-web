// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/extension.cpp, src/extension/effect.cpp, src/extension/system.cpp, src/extension/implementation/script.cpp, src/extension/prefdialog/prefdialog.cpp
// @vitest-environment happy-dom
import { Preferences, SPDocument, type SPItem } from '@inkscape-web/core';
import { afterEach, describe, expect, it } from 'vitest';
import { action_effect, init_extension_action_data } from '../actions/actions-effect.ts';
import { SPDesktop } from '../desktop.ts';
import { InkscapeApplication } from '../inkscape-application.ts';
import { add_extension_effects_to_menu, type MenuEntry } from '../ui/desktop/menubar.ts';
import { Canvas } from '../ui/widget/canvas.ts';
import { db } from './db.ts';
import { Effect } from './effect.ts';
import { Script, type ScriptCommand } from './implementation/script.ts';
import { Input } from './input.ts';
import { PrefDialog } from './prefdialog/prefdialog.ts';
import type { ParamInt, ParamNotebook, ParamOptionGroup, WidgetLabel } from './prefdialog/widget.ts';
import { build_from_mem } from './system.ts';

const NS = 'xmlns="http://www.inkscape.org/namespace/inkscape/extension"';

const ADD_NODES = `<?xml version="1.0" encoding="UTF-8"?>
<inkscape-extension ${NS}>
    <name>Add Nodes</name>
    <id>org.inkscape.filter.add_nodes</id>
    <param name="method" type="optiongroup" appearance="combo" gui-text="Division method:">
        <option value="bymax">By max. segment length</option>
        <option value="bynum">By number of segments</option>
    </param>
    <param name="max" type="float" min="0.1" max="10000.0" gui-text="Maximum segment length:">10.0</param>
    <param name="segments" type="int" min="1" max="1000" gui-text="Number of segments:">2</param>
    <param name="hidden" type="string" gui-hidden="true">x y</param>
    <effect needs-live-preview="false">
        <effects-menu><submenu name="Modify Path"/></effects-menu>
    </effect>
    <script><command location="inx" interpreter="python">addnodes.py</command></script>
</inkscape-extension>`;

const RANDOMIZE = `<inkscape-extension ${NS}>
    <name>Randomize</name>
    <id>org.inkscape.color.randomize</id>
    <param name="tab" type="notebook">
        <page name="Options" gui-text="Options">
            <param name="hue_range" type="int" appearance="full" min="0" max="100" gui-text="Hue range (%)">100</param>
            <hbox><param name="flag" type="bool" gui-text="Flag">false</param></hbox>
        </page>
        <page name="Help" gui-text="Help"><label>Randomizes   hue,
          saturation.</label></page>
    </param>
    <effect><effects-menu><submenu name="Color"><submenu name="Sub"/></submenu></effects-menu></effect>
    <script><command location="inx" interpreter="python">color_randomize.py</command></script>
</inkscape-extension>`;

const NO_PARAMS = `<inkscape-extension ${NS}><name>Negative</name><id>org.inkscape.color.negative</id>
  <effect><effects-menu><submenu name="Color"/></effects-menu></effect>
  <script><command location="inx" interpreter="python">color_negative.py</command></script></inkscape-extension>`;

const INPUT = `<inkscape-extension ${NS}><name>Some Input</name><id>org.test.input</id>
  <input priority="5"><extension>.foo</extension><mimetype>image/x-foo</mimetype><filetypename>Foo (*.foo)</filetypename></input>
  <script><command location="inx" interpreter="python">foo_input.py</command></script></inkscape-extension>`;

/** A runner that records the calls and returns output (the document with a new circle). */
class FakeRunner {
  calls: { command: ScriptCommand; params: readonly string[]; input: string }[] = [];
  async execute(command: ScriptCommand, params: readonly string[], input: Uint8Array | null) {
    const text = input ? new TextDecoder().decode(input) : '';
    this.calls.push({ command, params, input: text });
    const n = this.calls.length;
    const out = text.replace('</svg>', `<circle id="c${n}" r="${n}"/></svg>`);
    return { stdout: new TextEncoder().encode(out), stderr: '' };
  }
}

function setup() {
  const doc = SPDocument.createNewDocFromMem(
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="100" height="100">' +
      '<g id="l1" inkscape:groupmode="layer"><rect id="r" width="10" height="10"/><path d="M0 0L5 5"/></g></svg>',
  );
  if (!doc) throw new Error('parse failed');
  const host = document.createElement('div');
  Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  const dt = new SPDesktop(new Canvas(host), doc);
  doc.ensureUpToDate();
  const runner = new FakeRunner();
  Script.runner = runner;
  const lastUndo = () => doc.undoStack.undo.at(-1)?.description;
  const circles = () => [...doc.getReprRoot().children()].filter((c) => c.name() === 'svg:circle').length;
  return { doc, dt, runner, lastUndo, circles };
}

const defaultMessage = Script.on_message;
afterEach(() => {
  Script.runner = null;
  Script.on_message = defaultMessage;
  for (const pref of [
    'filter.add_nodes.method',
    'color.randomize.hue_range',
    'color.randomize.__live_effect__',
  ]) {
    Preferences.get().remove(`/extensions/org.inkscape.${pref}`);
  }
});

describe('extensions from .inx files', () => {
  it('reads the id, name, parameters, menu and command', () => {
    const ext = build_from_mem(ADD_NODES, null, '/share/extensions/addnodes.inx') as Effect;
    expect(ext).toBeInstanceOf(Effect);
    expect(db.get('org.inkscape.filter.add_nodes')).toBe(ext);
    expect([ext.get_name(), ext.get_sanitized_id(), ext.get_menu_list(), ext.no_live_preview]).toEqual([
      'Add Nodes',
      'org.inkscape.filter.add-nodes',
      ['Modify Path'],
      true,
    ]);
    const method = ext.get_param('method') as ParamOptionGroup;
    expect(method.choices.map((c) => c._value)).toEqual(['bymax', 'bynum']);
    expect(ext.get_param_float('max')).toBe(10);
    expect(ext.widget_visible_count()).toBe(3);
    const params: string[] = [];
    ext.paramListString(params);
    expect(params).toEqual(['--method=bymax', '--max=10.0', '--segments=2', '--hidden=x y']);
    ext.set_param_optiongroup('method', 'bynum');
    expect(Preferences.get().getString('/extensions/org.inkscape.filter.add_nodes.method')).toBe('bynum');
    expect(ext.check()).toBe(true);
  });

  it('reads notebooks, boxes and labels', () => {
    const ext = build_from_mem(RANDOMIZE, null, '/share/extensions/color_randomize.inx') as Effect;
    const tab = ext.get_param('tab') as ParamNotebook;
    expect(tab.pages().map((p) => p.name())).toEqual(['Options', 'Help']);
    expect((ext.get_param('hue_range') as ParamInt)._full).toBe(true);
    expect(ext.get_param_bool('flag')).toBe(false);
    expect((tab.pages()[1]?._children[0] as WidgetLabel | undefined)?._value).toBe(
      'Randomizes hue, saturation.',
    );
    expect(ext.get_menu_list()).toEqual(['Color', 'Sub']);
    const params: string[] = [];
    ext.paramListString(params);
    expect(params).toEqual(['--tab=Options', '--hue_range=100', '--flag=false']);
  });

  it('reads input extensions', () => {
    const input = build_from_mem(INPUT, null, '/share/extensions/foo.inx') as Input;
    expect(input).toBeInstanceOf(Input);
    expect([input.get_extension(), input.mimetype, input.get_filetypename(), input.priority]).toEqual([
      '.foo',
      'image/x-foo',
      'Foo (*.foo)',
      5,
    ]);
  });

  it('puts the effects into the Extensions menu, with "..." for effects with parameters', () => {
    const effects = [ADD_NODES, RANDOMIZE, NO_PARAMS].map(
      (t) => build_from_mem(t, null, '/x/y.inx') as Effect,
    );
    const menu: MenuEntry[] = [{ kind: 'section', id: 'effect-menu-effects', children: [] }];
    add_extension_effects_to_menu(menu, effects);
    const show = (e: MenuEntry): unknown =>
      e.kind === 'item'
        ? `${e.label} ${e.action}`
        : [e.kind === 'submenu' ? e.label : '', ...e.children.map(show)];
    expect(show(menu[0] as MenuEntry)).toEqual([
      '',
      [
        'Color',
        'Negative app.org.inkscape.color.negative',
        ['Sub', 'Randomize... app.org.inkscape.color.randomize'],
      ],
      ['Modify Path', 'Add Nodes... app.org.inkscape.filter.add-nodes'],
    ]);
  });
});

describe('running effects', () => {
  it('runs the script with the parameters, the selection and the document, then replaces the document', async () => {
    const { doc, dt, runner, lastUndo, circles } = setup();
    const ext = build_from_mem(ADD_NODES, null, '/share/extensions/addnodes.inx') as Effect;
    dt.layerManager().setCurrentLayer(doc.getObjectById('l1') as SPItem);
    dt.getSelection().set(doc.getObjectById('r') as SPItem);
    await ext.effect(dt);
    // The current layer is the new layer object with the same id.
    expect(dt.layerManager().currentLayer()).toBe(doc.getObjectById('l1'));
    expect(runner.calls[0]?.command).toEqual({
      interpreter: 'python',
      script: '/share/extensions/addnodes.py',
    });
    expect(runner.calls[0]?.params).toEqual([
      '--id=r',
      '--method=bymax',
      '--max=10.0',
      '--segments=2',
      '--hidden=x y',
    ]);
    expect(runner.calls[0]?.input).toContain('id="r"');
    expect(doc.getObjectById('r')).not.toBe(null);
    expect(circles()).toBe(1);
    expect(lastUndo()).toBe('Add Nodes');
    expect(Effect.get_last_effect()).toBe(ext);
    // The selection is restored by id.
    expect(
      dt
        .getSelection()
        .items()
        .map((i) => i.getId()),
    ).toEqual(['r']);
  });

  it('the actions run effects without parameters at once; "Previous Extension" repeats', async () => {
    const { dt, runner, circles } = setup();
    const app = new InkscapeApplication();
    app.set_active_desktop(dt);
    const ext = build_from_mem(NO_PARAMS, null, '/share/extensions/color_negative.inx') as Effect;
    init_extension_action_data(app, [ext]);
    expect(app.activate_action('app.org.inkscape.color.negative')).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(runner.calls).toHaveLength(1);
    expect(app.activate_action('app.last-effect')).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(circles()).toBe(2);
    // With parameters, the dialog opens instead.
    const shown: PrefDialog[] = [];
    Effect.show_pref_dialog = (d) => shown.push(d);
    const add = build_from_mem(ADD_NODES, null, '/share/extensions/addnodes.inx') as Effect;
    action_effect(app, add, null);
    expect(shown[0]?._effect).toBe(add);
    await shown[0]?.close();
    Effect.show_pref_dialog = null;
  });

  it('the live preview runs on each change after undoing the previous run, and Close undoes it', async () => {
    const { doc, dt, runner, lastUndo, circles } = setup();
    const ext = build_from_mem(RANDOMIZE, null, '/share/extensions/color_randomize.inx') as Effect;
    const dialog = new PrefDialog('Randomize', ext, dt);
    await dialog.set_preview(true);
    expect(circles()).toBe(1);
    ext.set_param_int('hue_range', 50);
    await dialog.param_timer_expire();
    expect(runner.calls.at(-1)?.params).toContain('--hue_range=50');
    expect(circles()).toBe(1); // the first preview was undone
    expect([...doc.getReprRoot().children()].some((c) => c.attribute('id') === 'c2')).toBe(true);
    await dialog.on_response(true);
    expect(lastUndo()).toBe('Randomize');
    expect(circles()).toBe(1);

    // A new preview, then Close: the document is back.
    await dialog.set_preview(true);
    expect(circles()).toBe(2);
    await dialog.on_response(false);
    expect(circles()).toBe(1);
  });

  it('reports stderr and unparsable output', async () => {
    const { dt, circles } = setup();
    const messages: string[] = [];
    Script.on_message = (m, d) => messages.push(`${m}|${d}`);
    Script.runner = {
      execute: async () => ({ stdout: new TextEncoder().encode('not xml at all'), stderr: 'warning!' }),
    };
    const ext = build_from_mem(NO_PARAMS, null, '/share/extensions/color_negative.inx') as Effect;
    await ext.effect(dt);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain('|warning!');
    expect(messages[1]).toContain('could not be parsed');
    expect(circles()).toBe(0);
  });
});
