// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/swatches.cpp, src/ui/dialog/swatches.h, share/ui/dialog-swatches.glade
/*
 * Authors:
 *   Jon A. Cruz
 *   John Bintz
 *   Abhishek Sharma
 *   PBS <pbs3141@gmail.com>
 *
 * Copyright (C) 2005 Jon A. Cruz
 * Copyright (C) 2008 John Bintz
 * Copyright (C) 2022 PBS
 */
import { _ } from '@inkscape-web/core';
import { AUTO_PALETTE_ID, colorItemKey, DIALOG_SWATCHES_PATH, swatchMatches } from '@inkscape-web/editor';
import { useState } from 'react';
import { useActiveDesktop } from '../../app/active-desktop.ts';
import { PaletteSelect, Swatch, useCurrentPaint, usePaletteCells } from '../widget/color-palette.tsx';
import { usePaletteChoice } from './palettes.ts';
import { useReprVersion } from './use-repr.ts';

/**
 * The Swatches dialog (dialog key "Swatches"): the colors of a palette, as a
 * list with names or as a grid. Click sets the fill of the selection,
 * Shift+click the stroke. The palette "Document swatches" lists the gradient
 * swatches of the document.
 * TODO: the pinned palette settings, swatch editing, loading a palette file,
 * the context menu of a swatch.
 */
export function SwatchesDialog() {
  const desktop = useActiveDesktop();
  const { id, palette } = usePaletteChoice(DIALOG_SWATCHES_PATH);
  const paint = useCurrentPaint(desktop);
  const docVersion = useReprVersion(id === AUTO_PALETTE_ID ? (desktop?.doc.rroot ?? null) : null);
  const cells = usePaletteCells(id, palette, desktop?.doc ?? null, docVersion);
  const [search, setSearch] = useState('');
  const [list, setList] = useState(true);
  if (!desktop) return null;

  return (
    <div className="swatches-dialog">
      <div className="swatches-header">
        <PaletteSelect prefsPath={DIALOG_SWATCHES_PATH} value={id} />
        <input
          type="search"
          aria-label={_('Search')}
          placeholder={_('Search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button type="button" aria-pressed={list} title={_('List')} onClick={() => setList(true)}>
          ☰
        </button>
        <button type="button" aria-pressed={!list} title={_('Grid')} onClick={() => setList(false)}>
          ▦
        </button>
      </div>
      <div className={`swatches-content ${list ? 'list' : 'grid'}`}>
        {cells.map((cell) => {
          if (!swatchMatches(cell, search)) return null;
          if (cell.kind === 'group') {
            return (
              <div key={cell.key} className="swatch-group">
                {cell.name}
              </div>
            );
          }
          if (cell.kind === 'spacer') return list ? null : <span key={cell.key} className="swatch-spacer" />;
          const key = colorItemKey(cell.item);
          return (
            <Swatch
              key={cell.key}
              desktop={desktop}
              item={cell.item}
              isFill={paint.fill === key}
              isStroke={paint.stroke === key}
              label={list}
            />
          );
        })}
      </div>
    </div>
  );
}
