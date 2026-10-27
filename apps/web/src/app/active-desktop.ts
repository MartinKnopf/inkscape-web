// SPDX-License-Identifier: GPL-2.0-or-later
// The desktop that menus and the status bar act on (upstream: the active
// desktop of InkscapeApplication). There is one desktop for now.
import { Signal } from '@inkscape-web/core';
import type { SPDesktop } from '@inkscape-web/editor';
import { useSyncExternalStore } from 'react';

let active: SPDesktop | null = null;
const changed = new Signal<[]>();

export function getActiveDesktop(): SPDesktop | null {
  return active;
}

export function setActiveDesktop(desktop: SPDesktop | null): void {
  active = desktop;
  changed.emit();
}

export function useActiveDesktop(): SPDesktop | null {
  return useSyncExternalStore((cb) => changed.connect(cb), getActiveDesktop);
}

/** The zoom factor of desktop (1 is 100%). */
export function useZoom(desktop: SPDesktop | null): number {
  return useSyncExternalStore(
    (cb) => desktop?.signal_zoom_changed.connect(cb) ?? (() => {}),
    () => desktop?.current_zoom() ?? 1,
  );
}
