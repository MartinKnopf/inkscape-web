// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/desktop/menubar.cpp, src/ui/desktop/menubar.h
/*
 * Desktop main menu bar code.
 *
 * Authors:
 *   Tavmjong Bah       <tavmjong@free.fr>
 *   Alex Valavanis     <valavanisalex@gmail.com>
 *   Patrick Storz      <eduard.braun2@gmx.de>
 *   Krzysztof Kosiński <tweenk.pl@gmail.com>
 *   Kris De Gussem     <Kris.DeGussem@gmail.com>
 *   Sushant A.A.       <sushant.co19@gmail.com>
 *
 * Copyright (C) 2025 Authors
 */
import { _, type Node, readMem } from '@inkscape-web/core';
import { print_detailed_name } from '../../actions/action-map.ts';
import type { Effect } from '../../extension/effect.ts';

/** An entry of a menu from share/ui/menus.ui. Labels are untranslated msgids with mnemonics ("_File"). */
export type MenuEntry =
  | { kind: 'item'; label: string /** Detailed action name. */; action: string; icon: string | null }
  | { kind: 'submenu'; id: string | null; label: string; children: MenuEntry[] }
  | { kind: 'section'; id: string | null; children: MenuEntry[] };

/** The attributes (<attribute name="…">) of a menus.ui element. */
function attributes(node: Node): Map<string, { value: string; type: string | null }> {
  const map = new Map<string, { value: string; type: string | null }>();
  for (const child of node.children()) {
    const name = child.name() === 'attribute' ? child.attribute('name') : null;
    if (!name) continue;
    const value = [...child.children()].map((t) => t.content() ?? '').join('');
    map.set(name, { value, type: child.attribute('type') });
  }
  return map;
}

function build_entries(menu: Node): MenuEntry[] {
  const entries: MenuEntry[] = [];
  for (const child of menu.children()) {
    const attrs = attributes(child);
    const label = attrs.get('label')?.value ?? '';
    switch (child.name()) {
      case 'item': {
        const action = attrs.get('action')?.value;
        if (!action) continue;
        const target = attrs.get('target');
        const dot = action.indexOf('.');
        // An "i" target is an integer; without type it is a string.
        const value = target ? (target.type === 'i' ? Number(target.value) : target.value) : undefined;
        entries.push({
          kind: 'item',
          label,
          action: print_detailed_name(action.slice(0, dot), action.slice(dot + 1), value),
          icon: attrs.get('icon')?.value ?? null,
        });
        break;
      }
      case 'submenu':
        entries.push({ kind: 'submenu', id: child.attribute('id'), label, children: build_entries(child) });
        break;
      case 'section':
        entries.push({ kind: 'section', id: child.attribute('id'), children: build_entries(child) });
        break;
    }
  }
  return entries;
}

/**
 * Build the menu tree from the text of share/ui/menus.ui (upstream
 * build_menu): the entries of the menu with id "menus", i.e. the top-level
 * submenus. Returns [] if the file is malformed.
 * TODO: recent files, icons
 * (/theme/menuIcons), the label to tooltip map.
 */
export function build_menu(xml: string): MenuEntry[] {
  const root = readMem(xml, null)?.root();
  if (!root) return [];
  const find = (node: Node): Node | null => {
    if (node.name() === 'menu' && node.attribute('id') === 'menus') return node;
    for (const c of node.children()) {
      const found = find(c);
      if (found) return found;
    }
    return null;
  };
  const menu = find(root);
  return menu ? build_entries(menu) : [];
}

/** An entry of the effect data of the menus (upstream InkActionEffectData::datum). */
export interface EffectMenuData {
  /** The action name without "app.". */
  effect_id: string;
  /** The submenus (labels). */
  submenu: readonly string[];
  /** The label of the item. */
  effect_name: string;
}

/**
 * Put the effects into the section with id section_id of menu (upstream build_menu: the
 * Filters and Extensions parts of the effect data): a submenu for each menu path, an item
 * app.<id> for each effect, sorted by menu path and name.
 */
export function add_effects_to_menu(
  menu: readonly MenuEntry[],
  section_id: string,
  entries: readonly EffectMenuData[],
): void {
  const find = (list: readonly MenuEntry[]): MenuEntry | null => {
    for (const e of list) {
      if (e.kind === 'section' && e.id === section_id) return e;
      if (e.kind !== 'item') {
        const found = find(e.children);
        if (found) return found;
      }
    }
    return null;
  };
  const top_menu = find(menu);
  if (!top_menu || top_menu.kind === 'item') {
    console.error(`build_menu(): Couldn't find menu section ${section_id}!`);
    return;
  }
  const submenus = new Map<string, MenuEntry[]>();
  // Sorted by (translated) menu tree and effect name (upstream InkActionEffectData::datum::operator<).
  const key = (e: EffectMenuData) => [...e.submenu.map((m) => _(m)), _(e.effect_name)];
  const sorted = [...entries].sort((a, b) => {
    const [ka, kb] = [key(a), key(b)];
    for (let i = 0; i < Math.min(ka.length, kb.length); i++) {
      if (ka[i] !== kb[i]) return (ka[i] ?? '') < (kb[i] ?? '') ? -1 : 1;
    }
    return ka.length - kb.length;
  });
  for (const entry of sorted) {
    let path = section_id;
    let current_menu = top_menu.children;
    for (const submenu_name of entry.submenu) {
      path += `${submenu_name}-`;
      let submenu = submenus.get(path);
      if (!submenu) {
        submenu = [];
        submenus.set(path, submenu);
        current_menu.push({ kind: 'submenu', id: null, label: submenu_name, children: submenu });
      }
      current_menu = submenu;
    }
    current_menu.push({
      kind: 'item',
      label: entry.effect_name,
      action: `app.${entry.effect_id}`,
      icon: null,
    });
  }
}

/** Put the filter effects into the section "filter-menu-filters" of menu. */
export function add_filter_effects_to_menu(
  menu: readonly MenuEntry[],
  effects: readonly { name: string; menu: readonly string[]; get_sanitized_id(): string }[],
): void {
  add_effects_to_menu(
    menu,
    'filter-menu-filters',
    effects.map((e) => ({ effect_id: e.get_sanitized_id(), submenu: e.menu, effect_name: e.name })),
  );
}

/**
 * Put the extension effects into the section "effect-menu-effects" of menu; an effect with
 * parameters gets "..." (upstream init_extension_action_data and build_menu).
 */
export function add_extension_effects_to_menu(menu: readonly MenuEntry[], effects: readonly Effect[]): void {
  add_effects_to_menu(
    menu,
    'effect-menu-effects',
    effects
      .filter((e) => !e.hidden_from_menu())
      .map((e) => ({
        effect_id: e.get_sanitized_id(),
        submenu: e.get_menu_list(),
        effect_name: e.takes_input() ? _('%s...').replace('%s', e.get_name()) : e.get_name(),
      })),
  );
}

/**
 * Split a GTK label with a mnemonic: "Save _As..." → text "Save As...",
 * mnemonic index 5. "__" is a literal underscore.
 */
export function parse_mnemonic(label: string): { text: string; mnemonic: number } {
  let text = '';
  let mnemonic = -1;
  for (let i = 0; i < label.length; i++) {
    const c = label[i];
    if (c === '_' && i + 1 < label.length) {
      i++;
      if (label[i] !== '_' && mnemonic < 0) mnemonic = text.length;
    }
    text += label[i];
  }
  return { text, mnemonic };
}
