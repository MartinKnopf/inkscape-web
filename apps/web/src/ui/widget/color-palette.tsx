// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/widget/color-palette.cpp, src/ui/widget/color-palette.h, src/ui/dialog/color-item.cpp, share/ui/dialog-swatches.glade
/*
 * Color palette widget.
 *
 * Authors:
 *   Michael Kowalski
 *
 * Copyright (C) 2021 Michael Kowalski
 */
import { _, type SPDocument } from '@inkscape-web/core';
import {
  AUTO_PALETTE_ID,
  type ColorItem,
  colorItemKey,
  currentPaintKeys,
  EMBEDDED_SWATCHES_PATH,
  isPinned,
  type PaletteCell,
  paletteCells,
  type SPDesktop,
  setColorItem,
} from '@inkscape-web/editor';
import { memo, useMemo, useRef, useSyncExternalStore } from 'react';
import { useActiveDesktop } from '../../app/active-desktop.ts';
import { selectPalette, useGlobalPalettes, usePaletteChoice } from '../dialog/palettes.ts';
import { useReprVersion } from '../dialog/use-repr.ts';
import './color-palette.css';

/** The CSS background of a swatch. */
function swatchBackground(item: ColorItem): string {
  const d = item.data;
  if (d.kind === 'color') return d.color.toString(false);
  if (d.kind === 'gradient') return d.gradient.getFirstStop()?.getColor().toString(false) ?? '#808080';
  return '';
}

/** The tip of a swatch (upstream: the message of ColorItem::on_motion_enter, without the markup). */
function swatchTip(item: ColorItem): string {
  return _('Color: <b>%1</b>; <b>Click</b> to set fill, <b>Shift+click</b> to set stroke')
    .replace('%1', item.description)
    .replace(/<[^>]+>/g, '');
}

/**
 * A swatch: click sets the fill, Shift+click or middle click the stroke.
 * The fill and stroke indicators show the paint of the selection.
 */
export const Swatch = memo(function Swatch(props: {
  desktop: SPDesktop;
  item: ColorItem;
  isFill: boolean;
  isStroke: boolean;
  label?: boolean;
}) {
  const { desktop, item } = props;
  return (
    <button
      type="button"
      className={`swatch${item.data.kind === 'none' ? ' paint-none' : ''}${props.isFill ? ' is-fill' : ''}${props.isStroke ? ' is-stroke' : ''}`}
      title={swatchTip(item)}
      aria-label={item.description}
      onClick={(e) => setColorItem(desktop, item, e.shiftKey)}
      onAuxClick={(e) => e.button === 1 && setColorItem(desktop, item, true)}
      // Keep the focus on the canvas.
      onMouseDown={(e) => e.preventDefault()}
    >
      <span className="swatch-color" style={{ background: swatchBackground(item) }} />
      {props.label && <span className="swatch-label">{item.description}</span>}
    </button>
  );
});

/** The fill and stroke keys of the selection of desktop, updated when the selection or its style changes. */
export function useCurrentPaint(desktop: SPDesktop | null): { fill: string | null; stroke: string | null } {
  const version = useRef(0);
  const v = useSyncExternalStore(
    (cb) => {
      if (!desktop) return () => {};
      const bump = () => {
        version.current++;
        cb();
      };
      const selection = desktop.getSelection();
      const off = [selection.connectChanged(bump), selection.connectModified(bump)];
      return () => {
        for (const f of off) f();
      };
    },
    () => version.current,
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: v is the change counter of the selection
  return useMemo(() => (desktop ? currentPaintKeys(desktop) : { fill: null, stroke: null }), [desktop, v]);
}

/** The cells of the palette with id, for the document swatches too (they follow the document). */
export function usePaletteCells(
  id: string,
  palette: Parameters<typeof paletteCells>[0],
  doc: SPDocument | null,
  docVersion: number,
): PaletteCell[] {
  // biome-ignore lint/correctness/useExhaustiveDependencies: docVersion marks changes of the document swatches
  return useMemo(
    () => paletteCells(palette, id === AUTO_PALETTE_ID ? doc : null),
    [id, palette, doc, docVersion],
  );
}

/** The palette chooser (upstream: the selector menu button). */
export function PaletteSelect(props: { prefsPath: string; value: string }) {
  const palettes = useGlobalPalettes();
  return (
    <select
      className="palette-select"
      aria-label={_('Palette')}
      title={_('Select a palette')}
      value={props.value}
      onChange={(e) => selectPalette(props.prefsPath, e.target.value)}
    >
      {/* TRANSLATORS: A list of swatches in the document */}
      <option value={AUTO_PALETTE_ID}>{_('Document swatches')}</option>
      {palettes.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}

/**
 * The palette bar at the bottom of the window (upstream: the compact
 * SwatchesPanel with preference path /embedded/swatches). The pinned colors
 * (none, black, 50% gray, white) are at the left, then the colors of the palette.
 */
export function ColorPaletteBar() {
  const desktop = useActiveDesktop();
  const { id, palette } = usePaletteChoice(EMBEDDED_SWATCHES_PATH);
  const paint = useCurrentPaint(desktop);
  const doc = desktop?.doc ?? null;
  const docVersion = useReprVersion(id === AUTO_PALETTE_ID ? (doc?.rroot ?? null) : null);
  const cells = usePaletteCells(id, palette, doc, docVersion);
  if (!desktop) return <div className="palette-bar" />;

  const swatches = cells.filter((c): c is Extract<PaletteCell, { kind: 'swatch' }> => c.kind === 'swatch');
  const pinned = swatches.filter((c) => isPinned(c.item, EMBEDDED_SWATCHES_PATH));
  const render = (c: { key: string; item: ColorItem }) => {
    const key = colorItemKey(c.item);
    return (
      <Swatch
        key={c.key}
        desktop={desktop}
        item={c.item}
        isFill={paint.fill === key}
        isStroke={paint.stroke === key}
      />
    );
  };
  return (
    <div className="palette-bar">
      <div className="palette-pinned">{pinned.map(render)}</div>
      <div className="palette-colors">
        {cells.map((c) => {
          if (c.kind === 'swatch') return isPinned(c.item, EMBEDDED_SWATCHES_PATH) ? null : render(c);
          if (c.kind === 'spacer') return <span key={c.key} className="swatch-spacer" />;
          return null; // Group titles are only in the dialog.
        })}
      </div>
      <PaletteSelect prefsPath={EMBEDDED_SWATCHES_PATH} value={id} />
    </div>
  );
}
