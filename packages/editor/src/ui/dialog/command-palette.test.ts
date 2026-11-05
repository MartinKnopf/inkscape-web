// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/command-palette.cpp
import { describe, expect, it, vi } from 'vitest';
import { InkscapeApplication } from '../../inkscape-application.ts';
import {
  CommandPalette,
  CPHistory,
  CPMode,
  compare_operations,
  fuzzy_points,
  fuzzy_search,
  fuzzy_tolerance_points,
  fuzzy_tolerance_search,
  matches,
} from './command-palette.ts';

describe('fuzzy search (the asserts of CommandPalette::test_sort)', () => {
  it('matches the search text as a subsequence', () => {
    expect(fuzzy_search('Export background', 'ebo')).toBe(true);
    expect(fuzzy_search('Query y', 'qyy')).toBe(true);
    expect(fuzzy_search('window close', 'qt')).toBe(false);
  });

  it('gives points for sequence matches', () => {
    expect(fuzzy_points('Export background', 'ebo')).toBe(-22);
    expect(fuzzy_points('Query y', 'qyy')).toBe(-16);
    expect(fuzzy_points('window close', 'wc')).toBe(2);
  });

  it('matches the characters in any order with the tolerance search', () => {
    expect(fuzzy_tolerance_search('object to path', 'ebo')).toBe(true);
    expect(fuzzy_tolerance_search('execute verb', 'qyy')).toBe(false);
    expect(fuzzy_tolerance_search('color mode', 'moco')).toBe(true);
    expect(fuzzy_tolerance_points('object to path', 'ebo')).toBe(189);
    expect(fuzzy_tolerance_points('execute verb', 'vec')).toBe(196);
    expect(fuzzy_tolerance_points('color mode', 'moco')).toBe(195);
  });
});

const op = (name: string, description = '') => ({ name, untranslated_name: name, description });

describe('filter and order', () => {
  it('hides what does not match and finds the description as a substring', () => {
    expect(matches(op('Rulers'), '')).toBe(true);
    expect(matches(op('Rulers', 'Show or hide the canvas rulers'), 'zzz')).toBe(false);
    expect(matches(op('Rulers', 'Show or hide the canvas rulers'), 'canvas')).toBe(true);
  });

  it('puts a better name match first, and a name match before a description match', () => {
    const list = [
      op('Zoom Selection', 'something with fit'),
      op('Fit Page', ''),
      op('Fit Drawing to Page', ''),
    ];
    const sorted = list
      .filter((o) => matches(o, 'fit'))
      .sort((a, b) => compare_operations(a, b, 'fit'))
      .map((o) => o.name);
    expect(sorted).toEqual(['Fit Page', 'Fit Drawing to Page', 'Zoom Selection']);
  });
});

describe('history', () => {
  it('persists operations and parameters', () => {
    let saved = '';
    const history = new CPHistory({ load: () => saved || null, save: (json) => (saved = json) });
    history.add_action('win.canvas-rulers');
    history.add_action_parameter('app.transform-rotate', '45');
    history.add_action_parameter('app.transform-rotate', '90');
    const again = new CPHistory({ load: () => saved, save: () => {} });
    expect(again.get_last_operation()?.data).toBe('win.canvas-rulers');
    expect(again.get_action_parameter_history('app.transform-rotate')).toEqual(['90', '45']);
  });

  it('ignores a damaged file', () => {
    expect(new CPHistory({ load: () => '{bad', save: () => {} }).get_operation_history()).toEqual([]);
  });
});

describe('palette', () => {
  const app = new InkscapeApplication();
  const palette = () => new CommandPalette(app);

  it('lists the actions with the label of their extra data and finds them by name', () => {
    const p = palette();
    p.open();
    p.set_search('rulers');
    const found = p.suggestions.find((o) => o.full_name === 'win.canvas-rulers');
    expect(found?.name).toBe('Rulers');
    expect(found?.group).toBe('Canvas Display');
  });

  it('runs an action without parameter and closes', () => {
    const p = palette();
    const called = vi.fn();
    app.actions.win.add_action('test-palette-plain', called);
    p.open();
    p.set_search('test-palette-plain');
    const op = p.suggestions.find((o) => o.full_name === 'win.test-palette-plain');
    expect(op).toBeDefined();
    expect(p.activate(op as NonNullable<typeof op>)).toBe(false);
    expect(called).toHaveBeenCalledTimes(1);
    expect(p.is_open).toBe(false);
    expect(p.history.get_last_operation()?.data).toBe('win.test-palette-plain');
  });

  it('asks for the parameter of an action and parses it by type', () => {
    const p = palette();
    const got: unknown[] = [];
    app.actions.win.add_action_with_parameter('test-palette-int', 'i', (v) => got.push(v));
    app.actions.win.add_action_with_parameter('test-palette-bool', 'b', (v) => got.push(v));
    app.actions.win.add_action_with_parameter('test-palette-double', 'd', (v) => got.push(v));
    p.open();
    p.set_search('test-palette-int');
    const op = p.suggestions.find((o) => o.full_name === 'win.test-palette-int');
    expect(p.activate(op as NonNullable<typeof op>)).toBe(true);
    expect(p.mode).toBe(CPMode.INPUT);
    expect(p.hint).toBe('Enter a whole number...');
    p.submit_input('12');
    expect(got).toEqual([12]);
    expect(p.is_open).toBe(false);

    expect(p.execute_action('win.test-palette-bool', 'f')).toBe(true);
    expect(p.execute_action('win.test-palette-bool', '')).toBe(true);
    expect(p.execute_action('win.test-palette-bool', 'maybe')).toBe(false);
    expect(p.execute_action('win.test-palette-double', '2.5')).toBe(true);
    expect(p.execute_action('win.test-palette-double', 'x')).toBe(false);
    expect(got).toEqual([12, false, true, 2.5]);
  });

  it('shows the hint of the action for the parameter', () => {
    const p = palette();
    p.open();
    p.set_search('translate');
    const op = p.suggestions.find((o) => o.full_name === 'app.transform-translate');
    p.activate(op as NonNullable<typeof op>);
    expect(p.hint).toBe('Enter two comma-separated numbers, e.g. 50,-2.5');
  });

  it('goes to the history mode only when there is history', () => {
    const p = palette();
    p.open();
    p.show_history();
    expect(p.mode).toBe(CPMode.SEARCH);
    p.execute_action('win.canvas-rulers', '');
    p.history.add_action('win.canvas-rulers');
    p.show_history();
    expect(p.mode).toBe(CPMode.HISTORY);
    const entry = p.history_operations.at(-1);
    p.pick_history(entry as NonNullable<typeof entry>);
    expect(p.mode).toBe(CPMode.SEARCH);
    expect(p.search_text).toBe('Rulers');
  });

  it('opens a recent file through the host', () => {
    const open = vi.fn();
    const p = new CommandPalette(app, {
      recent_files: () => [{ id: 'f1', name: 'a.svg', description: 'a.svg' }],
      open_recent: open,
    });
    p.open();
    p.set_search('a.svg');
    const file = p.suggestions.find((o) => o.kind === 'open');
    expect(file?.name).toBe('Open: a.svg');
    p.activate(file as NonNullable<typeof file>);
    expect(open).toHaveBeenCalledWith('f1');
    expect(p.history.get_last_operation()?.data).toBe('a.svg');
  });
});
