// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it, vi } from 'vitest';
import { ActionRegistry, canonical_detailed_name, parse_detailed_name } from './action-map.ts';

describe('parse_detailed_name', () => {
  it('parses GVariant text targets', () => {
    expect(parse_detailed_name("win.tool-switch('Rect')")).toEqual({
      prefix: 'win',
      name: 'tool-switch',
      target: 'Rect',
    });
    expect(parse_detailed_name('win.path-inset-screen( 1.0)')?.target).toBe(1);
    expect(parse_detailed_name('app.transform-rotate(-90.0)')?.target).toBe(-90);
    expect(parse_detailed_name('app.org.inkscape.import-web-image')?.name).toBe(
      'org.inkscape.import-web-image',
    );
    expect(parse_detailed_name('app.x(nope)')).toBeNull();
    expect(canonical_detailed_name('win.dialog-open("Export")')).toBe("win.dialog-open('Export')");
  });
});

describe('ActionRegistry', () => {
  it('runs enabled actions whose target fits the parameter type, and signals changes', () => {
    const r = new ActionRegistry();
    const changed = vi.fn();
    r.signal_changed.connect(changed);
    const tool = vi.fn();
    r.win.add_action_with_parameter('tool-switch', 's', tool);
    const undo = r.doc.add_action('undo', vi.fn());
    expect(r.activate("win.tool-switch('Rect')")).toBe(true);
    expect(tool).toHaveBeenCalledWith('Rect');
    expect(r.activate('win.tool-switch(3)')).toBe(false);
    expect(r.activate('win.tool-switch')).toBe(false);
    undo.set_enabled(false);
    expect(r.is_enabled('doc.undo')).toBe(false);
    expect(r.activate('doc.undo')).toBe(false);
    expect(r.is_enabled('app.missing')).toBe(false);
    expect(changed).toHaveBeenCalledTimes(3);
  });
});
