// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/widget/desktop-widget.cpp
// Which bars of the window are shown (upstream SPDesktopWidget::layoutWidgets()).
import { Preferences } from '@inkscape-web/core';
import { DesktopWidget, type ToolbarName } from '@inkscape-web/editor';
import { useSyncExternalStore } from 'react';

/** The visible bars and the interface mode of the current window mode. */
export interface Layout {
  readonly bars: Readonly<Record<ToolbarName, boolean>>;
  /** The wide screen setup: the commands bar is at the side. */
  readonly wide: boolean;
}

const BARS: readonly ToolbarName[] = [
  'commands',
  'snaptoolbox',
  'toppanel',
  'toolbox',
  'rulers',
  'scrollbars',
  'panels',
  'statusbar',
];

function read(): Layout {
  const widget = DesktopWidget.get();
  return {
    bars: Object.fromEntries(BARS.map((bar) => [bar, widget.isToolbarVisible(bar)])) as Record<
      ToolbarName,
      boolean
    >,
    wide: widget.isWideInterface(),
  };
}

let snapshot = read();

/** The same object while nothing changed, as useSyncExternalStore needs. */
function current(): Layout {
  const next = read();
  const same = next.wide === snapshot.wide && BARS.every((bar) => next.bars[bar] === snapshot.bars[bar]);
  if (!same) snapshot = next;
  return snapshot;
}

/** The layout; renders again when the mode or the preferences change. */
export function useLayout(): Layout {
  return useSyncExternalStore((cb) => {
    const off = [
      DesktopWidget.get().signal_layout_changed.connect(cb),
      // The stored preferences load at the start.
      Preferences.get().changedSignal.connect((path) => {
        if (/^\/(window|focus|fullscreen)\//.test(path)) cb();
      }),
    ];
    return () => {
      for (const f of off) f();
    };
  }, current);
}
