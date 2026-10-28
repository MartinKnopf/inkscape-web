// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/global-palettes.cpp
// Load the palettes of share/palettes (served by @inkscape-web/assets) and follow the preferences of a palette.
import { _ } from '@inkscape-web/core';
import {
  AUTO_PALETTE_ID,
  currentPaletteId,
  GlobalPalettes,
  type PaletteFileData,
  parseGimpPalette,
  setCurrentPaletteId,
} from '@inkscape-web/editor';
import { useEffect, useSyncExternalStore } from 'react';

let loading: Promise<void> | null = null;

/** Load all palettes once (upstream GlobalPalettes constructor); a broken file is skipped with a warning. */
export function loadGlobalPalettes(): Promise<void> {
  loading ??= (async () => {
    const files: string[] = await (await fetch('/share/palettes/index.json')).json();
    const results = await Promise.all(
      files.map(async (file): Promise<PaletteFileData | null> => {
        try {
          const response = await fetch(`/share/palettes/${file}`);
          return parseGimpPalette(await response.text(), `palettes/${file}`);
        } catch (e) {
          console.warn(`${_('Error loading palette %1: %2').replace('%1', file).replace('%2', String(e))}`);
          return null;
        }
      }),
    );
    GlobalPalettes.get().set(results.filter((p): p is PaletteFileData => p !== null));
  })();
  return loading;
}

/** The global palettes; they load on first use. */
export function useGlobalPalettes(): readonly PaletteFileData[] {
  useEffect(() => {
    void loadGlobalPalettes();
  }, []);
  return useSyncExternalStore(
    (cb) => GlobalPalettes.get().onChanged(cb),
    () => GlobalPalettes.get().palettes(),
  );
}

/**
 * The palette of a swatches panel with its preference path: its id, and the
 * palette itself (null for the "Auto" palette of the document swatches).
 */
export function usePaletteChoice(prefsPath: string): { id: string; palette: PaletteFileData | null } {
  useGlobalPalettes(); // render again when the palettes are loaded
  const saved = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => currentPaletteId(prefsPath),
  );
  // The saved value is an id or a name; an unknown palette falls back to the document swatches.
  const palette = saved === AUTO_PALETTE_ID ? null : (GlobalPalettes.get().findPalette(saved) ?? null);
  return { id: palette?.id ?? AUTO_PALETTE_ID, palette };
}

const listeners = new Set<() => void>();

/** Select a palette (upstream SwatchesPanel::set_palette); the panels follow. */
export function selectPalette(prefsPath: string, id: string): void {
  setCurrentPaletteId(prefsPath, id);
  for (const f of [...listeners]) f();
}
