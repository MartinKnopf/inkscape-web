// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/command-palette.cpp, src/ui/dialog/command-palette.h
/*
 * The command palette: search the actions by name, run them, ask for their parameter and keep a
 * history. This is the logic; the web app draws it (apps/web/src/ui/dialog/command-palette.tsx).
 *
 * Authors:
 *   Abhay Raj Singh <abhayonlyone@gmail.com>
 *
 * Copyright (C) 2020 Authors
 */
import { _, Signal } from '@inkscape-web/core';
import type { Variant, VariantType } from '../../actions/action-map.ts';
import { show_output } from '../../actions/actions-helper.ts';
import type { InkscapeApplication } from '../../inkscape-application.ts';
import { shortcutLabel } from '../shortcuts.ts';

// ---------------------------------------------------------------------------------------------
// Searching: the fuzzy search of upstream
//
// Every search of an operation can use three subjects: the name, the untranslated name (the
// tooltip of the name label upstream) and the description. The fuzzy search matches the search text
// as a subsequence of the subject; the fuzzy points tell how good the match is (less is better).
// The description is searched for the text as a substring.
// ---------------------------------------------------------------------------------------------

const chars = (s: string): string[] => [...s.toLowerCase()];

/** Whether the search text is a subsequence of the subject (ignoring case). */
export function fuzzy_search(subject: string, search: string): boolean {
  const subject_chars = chars(subject);
  let j = 0;
  for (const c of chars(search)) {
    let present = false;
    while (j < subject_chars.length) {
      if (c === subject_chars[j++]) {
        present = true;
        break;
      }
    }
    if (!present) return false;
  }
  return true;
}

/** Whether the subject contains the search text (ignoring case). */
export function normal_search(subject: string, search: string): boolean {
  return subject.toLowerCase().includes(search.toLowerCase());
}

const count_chars = (s: string): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const c of chars(s)) counts.set(c, (counts.get(c) ?? 0) + 1);
  return counts;
};

/** Whether the subject has each character of the search text at least as often as the search text (any order). */
export function fuzzy_tolerance_search(subject: string, search: string): boolean {
  const subject_counts = count_chars(subject);
  for (const [c, n] of count_chars(search)) {
    if ((subject_counts.get(c) ?? 0) < n) return false;
  }
  return true;
}

/** How well the search text matches the subject as a subsequence. Less is better. */
export function fuzzy_points(subject: string, search: string): number {
  let fuzzy_cost = 100; // initial fuzzy_cost

  const SEQUENTIAL_BONUS = -15; // bonus for adjacent matches
  const SEPARATOR_BONUS = -30; // bonus if search occurs after a separator
  const CAMEL_BONUS = -30; // bonus if search is uppercase and subject is lower
  const FIRST_LETTER_BONUS = -15; // bonus if the first letter is matched
  const LEADING_LETTER_PENALTY = 5; // penalty applied for every letter in subject before the first match
  const MAX_LEADING_LETTER_PENALTY = 15; // maximum penalty for leading letters
  const UNMATCHED_LETTER_PENALTY = 1; // penalty for every letter that doesn't matter

  const subject_chars = chars(subject);
  const search_chars = chars(search);
  // Upstream compares the search text in its original case with the lowercase subject.
  const original_search = [...search];

  let sequential_compare = false;
  let leading_letter = true;
  let total_leading_letter_penalty = 0;
  let i = 0;
  let j = 0;

  while (i < search_chars.length && j < subject_chars.length) {
    if (search_chars[i] !== subject_chars[j]) {
      j++;
      sequential_compare = false;
      fuzzy_cost += UNMATCHED_LETTER_PENALTY;
      if (leading_letter && total_leading_letter_penalty < MAX_LEADING_LETTER_PENALTY) {
        fuzzy_cost += LEADING_LETTER_PENALTY;
        total_leading_letter_penalty += LEADING_LETTER_PENALTY;
      }
      continue;
    }

    leading_letter = false;
    if (j > 0 && subject_chars[j - 1] === ' ') fuzzy_cost += SEPARATOR_BONUS;
    if (i === 0 && j === 0) fuzzy_cost += FIRST_LETTER_BONUS;
    if (original_search[i] === subject_chars[j]) fuzzy_cost += CAMEL_BONUS;
    if (sequential_compare) fuzzy_cost += SEQUENTIAL_BONUS;
    sequential_compare = true;
    i++;
  }
  return fuzzy_cost;
}

/** How well the characters of the search text are in the subject, in any order. Less is better. */
export function fuzzy_tolerance_points(subject: string, search: string): number {
  let fuzzy_cost = 200; // initial fuzzy_cost
  const FIRST_LETTER_BONUS = -15;

  const subject_chars = chars(subject);
  for (const [c, count] of count_chars(search)) {
    let occurrence = count;
    for (let i = 0; i < subject_chars.length && occurrence; i++) {
      if (subject_chars[i] === c) {
        if (i === 0) fuzzy_cost += FIRST_LETTER_BONUS;
        fuzzy_cost += i;
        occurrence--;
      }
    }
  }
  return fuzzy_cost;
}

/** Compare two fuzzy point counts; 0 points means no match (upstream fuzzy_points_compare). */
export function fuzzy_points_compare(points1: number, points2: number, len1: number, len2: number): number {
  if (points1 && points2) {
    if (points1 < points2) return -1;
    if (points1 === points2) return len1 > len2 ? 1 : -1;
    return 1;
  }
  if (points1 === 0 && points2) return 1;
  if (points2 === 0 && points1) return -1;
  return 0;
}

/** What the search looks at in an operation. */
export interface CPSearchable {
  /** The translated name. */
  name: string;
  /** The untranslated name. */
  untranslated_name: string;
  description: string;
}

/**
 * Whether an operation matches the search text and so is shown (upstream on_filter_general, which
 * returns the points and hides the operation for 0 points; points can be negative, and a good
 * match with exactly 0 points would be hidden there). Everything matches an empty search text.
 */
export function matches(op: CPSearchable, search: string): boolean {
  if (!search) return true;
  return (
    fuzzy_search(op.name, search) ||
    fuzzy_search(op.untranslated_name, search) ||
    fuzzy_tolerance_search(op.name, search) ||
    fuzzy_tolerance_search(op.untranslated_name, search) ||
    normal_search(op.description, search)
  );
}

/**
 * Order two operations for the search text (upstream on_sort): by the points of the name, of the
 * untranslated name and of the description, in this order; a tooltip match counts less than a
 * name match.
 */
export function compare_operations(a: CPSearchable, b: CPSearchable, search: string): number {
  if (!search) return -1; // No change in the order

  const TOOLTIP_PENALTY = 100;
  const DESCRIPTION_PENALTY = 500;
  let points1 = 0;
  let points2 = 0;
  let len1 = 0;
  let len2 = 0;

  // Each step uses the points that the steps before left, like upstream.
  const step = (
    matches: (subject: string, search: string) => boolean,
    points: (subject: string, search: string) => number,
    subject1: string,
    subject2: string,
    penalty: number,
  ): number => {
    if (matches(subject1, search)) {
      len1 = subject1.length;
      points1 = points(subject1, search) + penalty;
    }
    if (matches(subject2, search)) {
      len2 = subject2.length;
      points2 = points(subject2, search) + penalty;
    }
    return fuzzy_points_compare(points1, points2, len1, len2);
  };

  let result = step(fuzzy_search, fuzzy_points, a.name, b.name, 0);
  if (result !== 0) return result;
  result = step(fuzzy_tolerance_search, fuzzy_tolerance_points, a.name, b.name, 0);
  if (result !== 0) return result;
  result = step(fuzzy_search, fuzzy_points, a.untranslated_name, b.untranslated_name, TOOLTIP_PENALTY);
  if (result !== 0) return result;
  result = step(
    fuzzy_tolerance_search,
    fuzzy_tolerance_points,
    a.untranslated_name,
    b.untranslated_name,
    TOOLTIP_PENALTY,
  );
  if (result !== 0) return result;
  return step(normal_search, fuzzy_points, a.description, b.description, DESCRIPTION_PENALTY);
}

// ---------------------------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------------------------

export enum HistoryType {
  LPE,
  ACTION,
  OPEN_FILE,
  IMPORT_FILE,
}

export interface History {
  history_type: HistoryType;
  data: string;
}

/** Where the history persists (upstream: a file of the user profile). */
export interface CPHistoryStorage {
  load(): string | null;
  save(json: string): void;
}

const MAX_HISTORY = 100;
const MAX_PARAMETERS = 20;

/** The history of the operations and of the parameters entered for actions (upstream CPHistoryXML). */
export class CPHistory {
  #operations: History[] = [];
  #params = new Map<string, string[]>();
  readonly #storage: CPHistoryStorage | null;

  constructor(storage: CPHistoryStorage | null = null) {
    this.#storage = storage;
    try {
      const saved = JSON.parse(storage?.load() ?? 'null') as {
        operations?: History[];
        params?: Record<string, string[]>;
      } | null;
      this.#operations = (saved?.operations ?? []).filter(
        (o) => typeof o?.data === 'string' && o.history_type in HistoryType,
      );
      this.#params = new Map(Object.entries(saved?.params ?? {}));
    } catch {
      // A damaged history is dropped.
    }
  }

  add_action(full_action_name: string): void {
    this.#add_operation(HistoryType.ACTION, full_action_name);
  }
  add_import(uri: string): void {
    this.#add_operation(HistoryType.IMPORT_FILE, uri);
  }
  add_open(uri: string): void {
    this.#add_operation(HistoryType.OPEN_FILE, uri);
  }

  /** Remember a parameter for an action. */
  add_action_parameter(full_action_name: string, param: string): void {
    const list = this.#params.get(full_action_name) ?? [];
    list.push(param);
    this.#params.set(full_action_name, list.slice(-MAX_PARAMETERS));
    this.#save();
  }

  get_last_operation(): History | null {
    return this.#operations.at(-1) ?? null;
  }

  /** The operations, oldest first. */
  get_operation_history(): readonly History[] {
    return this.#operations;
  }

  /** The parameters entered for an action, most recent first (upstream: a LIFO stack). */
  get_action_parameter_history(full_action_name: string): string[] {
    return [...(this.#params.get(full_action_name) ?? [])].reverse();
  }

  #add_operation(history_type: HistoryType, data: string): void {
    this.#operations.push({ history_type, data });
    this.#operations = this.#operations.slice(-MAX_HISTORY);
    this.#save();
  }

  #save(): void {
    this.#storage?.save(
      JSON.stringify({ operations: this.#operations, params: Object.fromEntries(this.#params) }),
    );
  }
}

// ---------------------------------------------------------------------------------------------
// The palette
// ---------------------------------------------------------------------------------------------

export enum CPMode {
  SEARCH,
  /** Input of the argument of an action. */
  INPUT,
  HISTORY,
}

/** An operation that the palette lists: an action or the opening of a recent file. */
export interface CPOperation extends CPSearchable {
  kind: 'action' | 'open' | 'import';
  /** The section of the action ("Edit", "Object", ...); "open" or "import" for files. */
  group: string;
  /** The full action name ("win.canvas-rulers"), or for files the id the host gave. */
  full_name: string;
  shortcut: string;
  /** For files: the text shown below the name (upstream: the path). */
  file_label?: string;
}

/** The kind of parameter an action takes. */
export type ParameterKind = 'none' | 'bool' | 'int' | 'double' | 'string';

const KINDS: Record<VariantType, ParameterKind> = { b: 'bool', i: 'int', d: 'double', s: 'string' };

/** A recent file that the palette offers to open (the host knows how to open it). */
export interface CPRecentFile {
  id: string;
  name: string;
  /** The text shown as description (upstream: the path). */
  description: string;
}

export interface CommandPaletteOptions {
  history?: CPHistory;
  /** The recent files, newest first. */
  recent_files?: () => readonly CPRecentFile[];
  /** Open the recent file with the id. */
  open_recent?: (id: string) => void;
}

/**
 * The state of the command palette (upstream CommandPalette): the search text, the operations that
 * match it, the mode and the action that waits for its parameter. Emits changed on every change.
 */
export class CommandPalette {
  readonly app: InkscapeApplication;
  readonly history: CPHistory;
  readonly #options: CommandPaletteOptions;
  #operations: CPOperation[] = [];
  #is_open = false;
  #mode = CPMode.SEARCH;
  #search_text = '';
  #asked: CPOperation | null = null;
  #hint = '';
  /** Emitted when anything changes. */
  readonly changed = new Signal<[]>();

  constructor(app: InkscapeApplication, options: CommandPaletteOptions = {}) {
    this.app = app;
    this.#options = options;
    this.history = options.history ?? new CPHistory();
  }

  get is_open(): boolean {
    return this.#is_open;
  }
  get mode(): CPMode {
    return this.#mode;
  }
  get search_text(): string {
    return this.#search_text;
  }
  /** The placeholder of the input field for the mode. */
  get hint(): string {
    return this.#hint;
  }
  /** The action that waits for its parameter in the INPUT mode. */
  get asked(): CPOperation | null {
    return this.#asked;
  }

  /** Load the operations (can be slow upstream, so it is done at the first open) and show the palette. */
  open(): void {
    // The actions of the active window and document exist only after the start, so they are read at each open.
    this.#operations = this.#load_operations();
    this.#is_open = true;
    this.#set_mode(CPMode.SEARCH, true);
    this.changed.emit();
  }

  close(): void {
    this.#is_open = false;
    this.#search_text = '';
    this.#set_mode(CPMode.SEARCH, true);
    this.changed.emit();
  }

  toggle(): void {
    if (this.#is_open) this.close();
    else this.open();
  }

  /** The text of the search field changed (SEARCH mode). */
  set_search(text: string): void {
    this.#search_text = text;
    this.changed.emit();
  }

  /** The operations that match the search text, best first (upstream: the filter and sort of the list box). */
  get suggestions(): CPOperation[] {
    const text = this.#search_text;
    return this.#operations.filter((op) => matches(op, text)).sort((a, b) => compare_operations(a, b, text));
  }

  /** The history as operations, oldest first. */
  get history_operations(): CPOperation[] {
    const by_name = new Map(this.#operations.map((op) => [op.full_name, op]));
    const result: CPOperation[] = [];
    for (const h of this.history.get_operation_history()) {
      if (h.history_type === HistoryType.ACTION) {
        const op = by_name.get(h.data) ?? this.#action_operation(h.data);
        if (op) result.push(op);
      }
    }
    return result;
  }

  /**
   * Go to the history mode (the Up key); the entries are the operations in history_operations.
   * Does nothing if the history is empty.
   */
  show_history(): void {
    if (this.history_operations.length === 0) return;
    this.#set_mode(CPMode.HISTORY);
    this.changed.emit();
  }

  /** Leave the history mode and search the text of an entry of the history. */
  pick_history(op: CPOperation): void {
    this.#set_mode(CPMode.SEARCH, true);
    this.#search_text = op.name;
    this.changed.emit();
  }

  /**
   * Choose an operation (Enter or click): run an action without parameter, ask for the parameter of
   * the others, open a file. Returns whether the palette waits for a parameter.
   */
  activate(op: CPOperation): boolean {
    if (op.kind !== 'action') {
      if (this.history.get_last_operation()?.data !== op.description) this.history.add_open(op.description);
      this.#options.open_recent?.(op.full_name);
      this.close();
      return false;
    }
    // Avoid writing the same last action again.
    const last = this.history.get_last_operation();
    if (last?.data !== op.full_name) this.history.add_action(op.full_name);

    const kind = this.parameter_kind(op);
    if (kind !== 'none') {
      this.#asked = op;
      this.#set_mode(CPMode.INPUT);
      const hint = this.app.get_action_hint_data().get_tooltip_hint_for_action(op.full_name);
      const type_names: Record<Exclude<ParameterKind, 'none'>, string> = {
        bool: _('boolean'),
        int: _('whole number'),
        double: _('decimal number'),
        string: _('text string'),
      };
      /* TRANSLATORS: %1 will be replaced with the type of parameter expected by the action, e.g., "whole number". */
      this.#hint = hint || _('Enter a %1...').replace('%1', type_names[kind]);
      this.changed.emit();
      return true;
    }
    this.execute_action(op.full_name, '');
    this.close();
    return false;
  }

  /** The Enter key in the INPUT mode: run the waiting action with the text as parameter. */
  submit_input(value: string): void {
    if (this.#mode !== CPMode.INPUT || !this.#asked) return;
    this.execute_action(this.#asked.full_name, value);
    this.#asked = null;
    this.close();
  }

  parameter_kind(op: CPOperation): ParameterKind {
    const type = this.app.actions.lookup_action(op.full_name)?.parameter_type;
    return type ? KINDS[type] : 'none';
  }

  /**
   * Run the action with the text as its parameter, parsed by the parameter type (upstream
   * execute_action). Invalid input is reported. Returns whether the action ran.
   */
  execute_action(full_name: string, value: string): boolean {
    if (value) this.history.add_action_parameter(full_name, value);
    const action = this.app.actions.lookup_action(full_name);
    if (!action) return false;

    let parameter: Variant | undefined;
    switch (action.parameter_type) {
      case null:
        break;
      case 'b':
        if (value === '1' || value === 't' || value === 'true' || value === '') parameter = true;
        else if (value === '0' || value === 'f' || value === 'false') parameter = false;
        else {
          console.warn(`CommandPalette::execute_action: Invalid boolean value: ${full_name}:${value}`);
          return false;
        }
        break;
      case 'i': {
        const n = Number.parseInt(value, 10);
        if (Number.isNaN(n)) {
          show_output(_('Invalid input! Enter an integer number.'));
          return false;
        }
        parameter = n;
        break;
      }
      case 'd': {
        const n = Number.parseFloat(value);
        if (Number.isNaN(n)) {
          show_output(_('Invalid input! Enter a decimal number.'));
          return false;
        }
        parameter = n;
        break;
      }
      case 's':
        parameter = value;
        break;
    }
    return action.activate(parameter);
  }

  #set_mode(mode: CPMode, force = false): void {
    if (this.#mode === mode && !force) return;
    this.#mode = mode;
    if (mode === CPMode.SEARCH) {
      this.#asked = null;
      this.#hint = _('Enter search term to search for a command');
    } else if (mode === CPMode.INPUT) {
      this.#search_text = '';
    } else {
      this.#hint = _('History mode');
    }
  }

  #action_operation(full_name: string): CPOperation | null {
    if (!this.app.actions.lookup_action(full_name)) return null;
    const data = this.app.get_action_extra_data();
    // If the action has no label, the name is the full action name.
    const name = data.get_label_for_action(full_name) || full_name;
    const untranslated_name = data.get_label_for_action(full_name, false) || full_name;
    return {
      kind: 'action',
      group: data.get_section_for_action(full_name),
      name,
      untranslated_name,
      description: data.get_tooltip_for_action(full_name),
      full_name,
      shortcut: shortcutLabel(full_name) ?? '',
    };
  }

  #load_operations(): CPOperation[] {
    const operations: CPOperation[] = [];
    for (const prefix of ['app', 'win', 'doc'] as const) {
      for (const name of this.app.actions[prefix].list_actions()) {
        const op = this.#action_operation(`${prefix}.${name}`);
        if (op) operations.push(op);
      }
    }
    for (const file of this.#options.recent_files?.() ?? []) {
      operations.push({
        kind: 'open',
        group: 'open',
        full_name: file.id,
        name: `${_('Open')}: ${file.name}`,
        untranslated_name: `Open: ${file.name}`,
        description: file.description,
        shortcut: '',
        file_label: file.description,
      });
    }
    return operations;
  }
}
