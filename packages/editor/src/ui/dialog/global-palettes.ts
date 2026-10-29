// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/global-palettes.cpp, src/ui/dialog/global-palettes.h
/*
 * Global color palette information.
 *
 * Authors: PBS <pbs3141@gmail.com>
 * Copyright (C) 2022 PBS
 */
import { C_, Colors } from '@inkscape-web/core';

/** An empty cell of a palette (upstream PaletteFileData::SpacerItem). */
export interface SpacerItem {
  kind: 'spacer';
}

/** The title of a group of colors (upstream PaletteFileData::GroupStart). */
export interface GroupStart {
  kind: 'group';
  name: string;
}

export interface ColorEntry {
  kind: 'color';
  color: Colors.Color;
}

export type PaletteItem = ColorEntry | SpacerItem | GroupStart;

/** The data loaded from a palette file (upstream PaletteFileData). */
export interface PaletteFileData {
  /** The path of the file; palettes are looked up by it. */
  id: string;
  name: string;
  /** The number of colors in a row (page size) of the palette. */
  columns: number;
  colors: PaletteItem[];
}

/**
 * Parse a GIMP color palette (.gpl). path names the palette when the file has
 * no "Name:" line. Throws an Error with a message for a malformed file.
 * Upstream: load_gimp_palette.
 */
export function parseGimpPalette(text: string, path: string): PaletteFileData {
  const palette: PaletteFileData = {
    id: path,
    name: path.slice(path.lastIndexOf('/') + 1),
    columns: 1,
    colors: [],
  };
  const lines = text.split(/\r?\n/);
  if (!lines[0]?.startsWith('GIMP Palette')) {
    throw new Error(lines[0] === undefined || text === '' ? 'File is empty' : 'First line is wrong');
  }
  // A final empty line from the trailing newline is no line.
  if (lines[lines.length - 1] === '') lines.pop();
  for (const line of lines.slice(1)) {
    const rgb = /^\s*(\d+)\s+(\d+)\s+(\d+)\s*(?:\s(.*\S)\s*)?$/.exec(line);
    const name = /^\s*Name:\s*(.*)\s*/.exec(line);
    const columns = /^\s*Columns:\s*(.*\S)/.exec(line);
    if (rgb) {
      // An 8-bit RGB color, followed by an optional name.
      const [r, g, b] = [rgb[1], rgb[2], rgb[3]].map((v) => Number.parseInt(v as string, 10) / 255);
      const color = new Colors.Color(Colors.SpaceType.RGB, [r as number, g as number, b as number]);
      color.setName(rgb[4] ? C_('Palette', rgb[4]) : Colors.rgba_to_hex(color.toRGBA(), false, true));
      palette.colors.push({ kind: 'color', color });
    } else if (name) {
      // Header entry for the name.
      if (name[1]) palette.name = name[1];
    } else if (columns) {
      // Header entry for the columns.
      palette.columns = Math.min(Math.max(Number.parseInt(columns[1] as string, 10) || 0, 1), 1000);
    } else if (!/^\s*(?:$|#)/.test(line)) {
      // Not a comment or a blank line.
      throw new Error(`${C_('Palette', 'Invalid line ')}${line}`);
    }
  }
  return palette;
}

/**
 * The palettes of share/palettes, sorted by name (upstream GlobalPalettes).
 * The app loads the files and calls set().
 */
export class GlobalPalettes {
  static #instance: GlobalPalettes | null = null;
  #palettes: PaletteFileData[] = [];
  #access = new Map<string, PaletteFileData>();
  /** Emitted by set(). */
  readonly #listeners = new Set<() => void>();

  static get(): GlobalPalettes {
    GlobalPalettes.#instance ??= new GlobalPalettes();
    return GlobalPalettes.#instance;
  }

  palettes(): readonly PaletteFileData[] {
    return this.#palettes;
  }

  set(palettes: PaletteFileData[]): void {
    this.#palettes = [...palettes].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    this.#access.clear();
    // First priority for lookup: by id. Second priority: by name.
    for (const p of this.#palettes) this.#access.set(p.id, p);
    for (const p of this.#palettes) if (p.name && !this.#access.has(p.name)) this.#access.set(p.name, p);
    for (const f of [...this.#listeners]) f();
  }

  /** The palette with this id (path) or name. */
  findPalette(id: string): PaletteFileData | undefined {
    return this.#access.get(id);
  }

  onChanged(slot: () => void): () => void {
    this.#listeners.add(slot);
    return () => this.#listeners.delete(slot);
  }
}
