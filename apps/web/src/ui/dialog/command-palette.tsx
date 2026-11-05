// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/command-palette.cpp, src/ui/dialog/command-palette.h, share/ui/command-palette-main.glade
/*
 * The command palette: an on-canvas panel to search and run actions (Ctrl+? or win.canvas-command-palette).
 *
 * Authors:
 *   Abhay Raj Singh <abhayonlyone@gmail.com>
 *
 * Copyright (C) 2020 Authors
 */
import { _ } from '@inkscape-web/core';
import {
  CommandPalette,
  CPHistory,
  CPMode,
  type CPOperation,
  DesktopWidget,
  InkscapeApplication,
} from '@inkscape-web/editor';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getRecentFiles } from '../../app/recent-files.ts';

const HISTORY_KEY = 'inkscape-web/command-palette-history';
/** The most suggestions that are drawn; the search narrows the rest. */
const MAX_ROWS = 200;

/** The history in localStorage; it is only a convenience, so a failing storage is ignored. */
const storage = {
  load: () => {
    try {
      return localStorage.getItem(HISTORY_KEY);
    } catch {
      return null;
    }
  },
  save: (json: string) => {
    try {
      localStorage.setItem(HISTORY_KEY, json);
    } catch {
      // The history is not kept.
    }
  },
};

let palette: CommandPalette | null = null;
let version = 0;

/** The palette of the application, created at first use. */
function getPalette(): CommandPalette {
  if (!palette) {
    const app = InkscapeApplication.instance();
    palette = new CommandPalette(app, {
      history: new CPHistory(storage),
      recent_files: () =>
        getRecentFiles().entries.map((e) => ({ id: e.id, name: e.name, description: e.name })),
      open_recent: (id) => void app.activate_action(`app.open-recent('${id.replace(/['\\]/g, '\\$&')}')`),
    });
    palette.changed.connect(() => version++);
    DesktopWidget.get().signal_command_palette_toggled.connect(() => palette?.toggle());
  }
  return palette;
}

function usePalette(): CommandPalette {
  const p = getPalette();
  useSyncExternalStore(
    (cb) => p.changed.connect(cb),
    () => version,
  );
  return p;
}

/** One entry of the list: group, name, shortcut and description. */
function Row(props: { op: CPOperation; selected: boolean; onActivate: () => void; onHover: () => void }) {
  const { op, selected } = props;
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the keys are handled by the search field
    <div
      role="option"
      tabIndex={-1}
      aria-selected={selected}
      className={selected ? 'cp-row selected' : 'cp-row'}
      title={op.untranslated_name}
      ref={(el) => {
        if (selected) el?.scrollIntoView?.({ block: 'nearest' });
      }}
      onClick={props.onActivate}
      onMouseMove={props.onHover}
    >
      <span className="cp-group">{op.group}</span>
      <span className="cp-name">{op.name}</span>
      {op.shortcut && <kbd className="cp-shortcut">{op.shortcut}</kbd>}
      <span className="cp-description" title={op.description}>
        {op.description}
      </span>
    </div>
  );
}

/**
 * The command palette host: render once in the app. The palette lists the actions; the text field
 * filters them (fuzzy search). Enter runs the selected one, asking for its parameter first if it
 * needs one. Up from the first entry shows the history. Escape closes.
 */
export function CommandPaletteHost() {
  const p = usePalette();
  const [selected, setSelected] = useState(0);
  const [history_selected, setHistorySelected] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const suggestions = p.is_open && p.mode === CPMode.SEARCH ? p.suggestions.slice(0, MAX_ROWS) : [];
  const history = p.is_open && p.mode === CPMode.HISTORY ? p.history_operations : [];

  // A menu that ran the action gives the focus back to its button after a moment (upstream defers
  // showing the palette for the same reason), so the field takes it again.
  const is_open = p.is_open;
  useEffect(() => {
    if (!is_open) return;
    const timer = setTimeout(() => {
      if (!document.activeElement?.closest('.cp')) input.current?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, [is_open]);
  // The selected entry is the first one after each search.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the search text is the trigger
  useEffect(() => setSelected(0), [p.search_text]);
  useEffect(() => {
    if (p.mode === CPMode.HISTORY) setHistorySelected(history.length - 1);
  }, [p.mode, history.length]);

  if (!p.is_open) return null;
  const list = p.mode === CPMode.HISTORY ? history : suggestions;
  const index = p.mode === CPMode.HISTORY ? history_selected : selected;
  const set_index = p.mode === CPMode.HISTORY ? setHistorySelected : setSelected;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      p.close();
    } else if (p.mode === CPMode.INPUT) {
      if (e.key === 'Enter') {
        e.preventDefault();
        p.submit_input(input.current?.value ?? '');
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      set_index(Math.min(index + 1, list.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (p.mode === CPMode.SEARCH && index === 0) p.show_history();
      else set_index(Math.max(index - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const op = list[index];
      if (op) p.activate(op);
    }
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a click on the backdrop closes; Escape does the same
    <div
      className="cp-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) p.close();
      }}
    >
      <div className="cp" role="dialog" aria-label={_('Command Palette')}>
        <input
          ref={(el) => {
            input.current = el;
            el?.focus();
          }}
          className="cp-filter"
          type="search"
          autoComplete="off"
          spellCheck={false}
          placeholder={p.hint}
          title={p.hint}
          aria-label={p.hint}
          // The history mode shows the selected entry in the field, like upstream.
          value={p.mode === CPMode.HISTORY ? (history[history_selected]?.name ?? '') : undefined}
          readOnly={p.mode === CPMode.HISTORY}
          defaultValue={p.mode === CPMode.HISTORY ? undefined : ''}
          key={p.mode}
          onChange={(e) => {
            if (p.mode === CPMode.SEARCH) p.set_search(e.target.value);
          }}
          onKeyDown={onKeyDown}
        />
        {p.mode !== CPMode.INPUT && (
          <div className="cp-list" role="listbox">
            {list.map((op, i) => (
              <Row
                // biome-ignore lint/suspicious/noArrayIndexKey: the history can list an action twice
                key={`${op.kind}:${op.full_name}:${i}`}
                op={op}
                selected={i === index}
                onActivate={() => p.activate(op)}
                onHover={() => set_index(i)}
              />
            ))}
            {list.length === 0 && <div className="cp-empty">{_('No matching commands')}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
