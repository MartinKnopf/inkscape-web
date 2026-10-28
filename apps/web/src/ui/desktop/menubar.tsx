// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/desktop/menubar.cpp, share/ui/menus.ui
// The main menu bar, built from share/ui/menus.ui. Items of actions that are
// not registered (not ported yet) are disabled, so the full upstream menu shows.
import { _ } from '@inkscape-web/core';
import {
  build_menu,
  InkscapeApplication,
  type MenuEntry,
  parse_mnemonic,
  print_detailed_name,
  Shortcuts,
} from '@inkscape-web/editor';
import * as Menubar from '@radix-ui/react-menubar';
import { Fragment, type ReactNode, useSyncExternalStore } from 'react';
import { useRecentFiles } from '../../app/recent-files.ts';

let menu: MenuEntry[] = [];

/** Load share/ui/menus.ui. Call once before the menu bar renders. */
export async function loadMenu(): Promise<void> {
  const response = await fetch('/share/ui/menus.ui');
  if (response.ok) menu = build_menu(await response.text());
  else console.error(`build_menu: failed to load Main menu: ${response.status}`);
}

/** A number that changes when actions or shortcuts change, to render menus again. */
let version = 0;
function useActionsVersion(): number {
  return useSyncExternalStore(
    (cb) => {
      const bump = () => {
        version++;
        cb();
      };
      const off = [
        InkscapeApplication.instance().actions.signal_changed.connect(bump),
        Shortcuts.getInstance().signal_changed.connect(bump),
      ];
      return () => {
        for (const f of off) f();
      };
    },
    () => version,
  );
}

/** The translated label, without the mnemonic marker. */
const label = (msgid: string) => parse_mnemonic(_(msgid)).text;

/** Whether an entry shows anything (sections and submenus may be empty, e.g. Filters). */
const isEmpty = (e: MenuEntry): boolean => e.kind === 'section' && e.children.every(isEmpty);

/** A React key of an entry, from its content. */
const entryKey = (e: MenuEntry): string =>
  e.kind === 'item'
    ? `${e.action}|${e.label}`
    : e.kind === 'submenu'
      ? `sub|${e.id}|${e.label}`
      : `sec|${e.id ?? e.children.map(entryKey).join()}`;

/** The entries of a menu: sections are separated from their neighbours like GTK does. */
function MenuEntries({ entries }: { entries: readonly MenuEntry[] }) {
  const out: ReactNode[] = [];
  let separate = false;
  for (const entry of entries) {
    if (isEmpty(entry)) continue;
    const key = entryKey(entry);
    const section = entry.kind === 'section';
    if (out.length && (section || separate))
      out.push(<Menubar.Separator key={`sep|${key}`} className="menu-separator" />);
    separate = section;
    out.push(<Entry key={key} entry={entry} />);
  }
  return <>{out}</>;
}

/** The entries of the submenu "Open Recent" (id recent-files): the recent files, newest first. */
function useRecentEntries(): MenuEntry[] {
  return useRecentFiles().map((e) => ({
    kind: 'item',
    // The label is a file name: it has no mnemonic and no translation.
    label: e.name.replaceAll('_', '__'),
    action: print_detailed_name('app', 'open-recent', e.id),
    icon: null,
  }));
}

function SubmenuEntry({ entry }: { entry: Extract<MenuEntry, { kind: 'submenu' }> }) {
  const recent = useRecentEntries();
  const children = entry.id === 'recent-files' ? recent : entry.children;
  return (
    <Menubar.Sub>
      <Menubar.SubTrigger className="menu-item" disabled={children.every(isEmpty)}>
        <span>{label(entry.label)}</span>
        <span className="menu-shortcut">›</span>
      </Menubar.SubTrigger>
      <Menubar.Portal>
        <Menubar.SubContent className="menu-popup" loop>
          <MenuEntries entries={children} />
        </Menubar.SubContent>
      </Menubar.Portal>
    </Menubar.Sub>
  );
}

function Entry({ entry }: { entry: MenuEntry }) {
  const app = InkscapeApplication.instance();
  switch (entry.kind) {
    case 'section':
      return <MenuEntries entries={entry.children} />;
    case 'submenu':
      return <SubmenuEntry entry={entry} />;
    case 'item': {
      // Boolean actions show their state as a check mark (upstream: GTK check menu items).
      const state = app.actions.lookup_action(entry.action)?.get_state();
      return (
        <Menubar.Item
          className="menu-item"
          disabled={!app.actions.is_enabled(entry.action)}
          data-action={entry.action}
          data-state-checked={state}
          onSelect={() => app.activate_action(entry.action)}
        >
          <span>
            {state !== undefined && <span className="menu-check">{state ? '✓' : ''}</span>}
            {label(entry.label)}
          </span>
          <span className="menu-shortcut">{Shortcuts.getInstance().get_shortcut_label(entry.action)}</span>
        </Menubar.Item>
      );
    }
  }
}

/** The menu bar: the top-level submenus of menus.ui. */
export function MenuBar() {
  useActionsVersion();
  return (
    <Menubar.Root className="menubar">
      {menu.map((m) => (
        <Fragment key={entryKey(m)}>
          {m.kind === 'submenu' && (
            <Menubar.Menu>
              <Menubar.Trigger className="menu-trigger">{label(m.label)}</Menubar.Trigger>
              <Menubar.Portal>
                <Menubar.Content className="menu-popup" align="start" loop>
                  <MenuEntries entries={m.children} />
                </Menubar.Content>
              </Menubar.Portal>
            </Menubar.Menu>
          )}
        </Fragment>
      ))}
    </Menubar.Root>
  );
}
