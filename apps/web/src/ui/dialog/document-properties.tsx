// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/document-properties.cpp, src/ui/widget/page-properties.cpp
import { _, C_, Colors, convertUnit, formatNumber, PAGE_SIZES, type SPGrid } from '@inkscape-web/core';
import {
  get_document_scale,
  getPageSize,
  grid_get_origin,
  grid_get_spacing,
  grid_new,
  grid_remove,
  grid_set_color,
  grid_set_flag,
  grid_set_major_line_interval,
  grid_set_origin,
  grid_set_spacing,
  grid_set_unit,
  isLandscape,
  matchingPaperSize,
  PAGE_UNITS,
  type SPDesktop,
  set_background_color,
  set_border_color,
  set_checkerboard,
  set_desk_color,
  set_display_unit,
  set_document_dimensions,
  set_document_scale,
  set_orientation,
  set_paper_size,
  set_show_border,
  set_viewbox_pos,
  set_viewbox_size,
} from '@inkscape-web/editor';
import { Point } from '@inkscape-web/geom';
import { useState } from 'react';
import { useActiveDesktop } from '../../app/active-desktop.ts';
import { objectKey, useReprVersion } from './use-repr.ts';

/** A number field that commits on Enter or blur and reverts on Escape. */
function NumberField(props: { label: string; value: number; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = formatNumber(props.value, 4);
  const finish = (commit: boolean) => {
    const text = draft;
    setDraft(null);
    const value = Number.parseFloat(text ?? '');
    if (commit && text !== null && Number.isFinite(value) && value !== props.value) props.onCommit(value);
  };
  return (
    <input
      className="docprops-number"
      aria-label={props.label}
      value={draft ?? shown}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        else if (e.key === 'Escape') finish(false);
      }}
    />
  );
}

/** The #rrggbb of a namedview color, for input[type=color]. */
const hex = (color: Colors.Color) => color.toString(false);

function ColorField(props: { label: string; value: Colors.Color; onChange: (color: Colors.Color) => void }) {
  return (
    <label className="docprops-row">
      <span>{props.label}</span>
      <input
        type="color"
        value={hex(props.value)}
        onChange={(e) => {
          const color = Colors.Color.parse(e.target.value);
          if (color) props.onChange(color);
        }}
      />
    </label>
  );
}

/**
 * The Document Properties dialog (dialog key "DocumentProperties"): the page tab
 * (page size, scale, viewBox, display units, colors, border, checkerboard)
 * and the grids tab (rectangular grids).
 * TODO: the other tabs (guides, color management, scripting, metadata, license),
 * margins and bleed, multiple pages, content scaling when the scale changes,
 * axonometric and modular grids.
 */
export function DocumentPropertiesDialog() {
  const desktop = useActiveDesktop();
  if (!desktop) return null;
  return <DocumentProperties key={objectKey(desktop.doc)} desktop={desktop} />;
}

function DocumentProperties({ desktop }: { desktop: SPDesktop }) {
  const [tab, setTab] = useState<'page' | 'grids'>('page');
  useReprVersion(desktop.doc.rroot);
  return (
    <div className="docprops-tabs">
      <div className="docprops-tabbar" role="tablist">
        {(
          [
            ['page', _('Page')],
            ['grids', _('Grids')],
          ] as const
        ).map(([key, text]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>
            {text}
          </button>
        ))}
      </div>
      {tab === 'page' ? <PageTab desktop={desktop} /> : <GridsTab desktop={desktop} />}
    </div>
  );
}

/** The grids of the namedview, each with its settings, and a button to add a rectangular grid. */
function GridsTab({ desktop }: { desktop: SPDesktop }) {
  const doc = desktop.doc;
  const grids = doc.getNamedView().grids;
  return (
    <div className="docprops">
      {grids.map((grid) => (
        <GridSettings key={objectKey(grid)} grid={grid} />
      ))}
      <button type="button" onClick={() => grid_new(doc)}>
        {`${_('Add grid')}: ${C_('Grid', 'Rectangular')}`}
      </button>
    </div>
  );
}

/** The settings of a grid (upstream GridWidget). */
function GridSettings({ grid }: { grid: SPGrid }) {
  const origin = grid_get_origin(grid);
  const spacing = grid_get_spacing(grid);
  const unit = grid.getUnit();
  const flag = (text: string, f: Parameters<typeof grid_set_flag>[1], value: boolean) => (
    <label className="docprops-row">
      <span>{text}</span>
      <input type="checkbox" checked={value} onChange={(e) => grid_set_flag(grid, f, e.target.checked)} />
    </label>
  );
  return (
    <fieldset>
      <legend>{grid.displayName()}</legend>
      {flag(_('Enabled'), 'enabled', grid.isEnabled())}
      {flag(_('Visible'), 'visible', grid._visible.value)}
      {flag(
        _('Snap to visible _grid lines only').replace('_', ''),
        'snapvisiblegridlinesonly',
        grid.getSnapToVisibleOnly(),
      )}
      {flag(_('_Show dots instead of lines').replace('_', ''), 'dotted', grid.getDotted())}
      <label className="docprops-row">
        <span>{_('Grid _units:').replace('_', '')}</span>
        <select
          aria-label={_('Grid units')}
          value={unit}
          onChange={(e) => grid_set_unit(grid, e.target.value)}
        >
          {PAGE_UNITS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </label>
      <div className="docprops-row">
        <span>{_('_Origin X:').replace('_', '')}</span>
        <NumberField
          label={_('X coordinate of grid origin')}
          value={origin.x}
          onCommit={(x) => grid_set_origin(grid, new Point(x, origin.y))}
        />
        <span>{_('O_rigin Y:').replace('_', '')}</span>
        <NumberField
          label={_('Y coordinate of grid origin')}
          value={origin.y}
          onCommit={(y) => grid_set_origin(grid, new Point(origin.x, y))}
        />
      </div>
      <div className="docprops-row">
        <span>{_('Spacing _X:').replace('_', '')}</span>
        <NumberField
          label={_('Distance between vertical grid lines')}
          value={spacing.x}
          onCommit={(x) => grid_set_spacing(grid, new Point(x, spacing.y))}
        />
        <span>{_('Spacing _Y:').replace('_', '')}</span>
        <NumberField
          label={_('Distance between horizontal grid lines')}
          value={spacing.y}
          onCommit={(y) => grid_set_spacing(grid, new Point(spacing.x, y))}
        />
      </div>
      <ColorField
        label={_('Minor grid line color:')}
        value={grid.getMinorColor()}
        onChange={(c) => grid_set_color(grid, keepOpacity(c, grid.getMinorColor()), false)}
      />
      <ColorField
        label={_('Major grid line color:')}
        value={grid.getMajorColor()}
        onChange={(c) => grid_set_color(grid, keepOpacity(c, grid.getMajorColor()), true)}
      />
      <div className="docprops-row">
        <span>{_('Major grid line e_very:').replace('_', '')}</span>
        <NumberField
          label={_('Number of lines')}
          value={grid.getMajorLineInterval()}
          onCommit={(n) => grid_set_major_line_interval(grid, Math.round(n))}
        />
      </div>
      <button type="button" title={_('Delete this grid')} onClick={() => grid_remove(grid)}>
        {_('Remove')}
      </button>
    </fieldset>
  );
}

/** color with the opacity of old (input[type=color] has no alpha). */
function keepOpacity(color: Colors.Color, old: Colors.Color): Colors.Color {
  color.setOpacity(old.getOpacity());
  return color;
}

/** The page tab. */
function PageTab({ desktop }: { desktop: SPDesktop }) {
  const doc = desktop.doc;
  const nv = doc.getNamedView();
  const size = getPageSize(doc);
  const paper = matchingPaperSize(size);
  const landscape = isLandscape(size);
  const scale = get_document_scale(doc);
  const vb = doc.getViewBox();
  const border = nv.getBorderColor();

  return (
    <div className="docprops">
      <fieldset>
        <legend>{_('Page')}</legend>
        <label className="docprops-row">
          <span>{_('Page size')}</span>
          <select
            aria-label={_('Page size')}
            value={paper?.name ?? ''}
            onChange={(e) => {
              const chosen = PAGE_SIZES.find((p) => p.name === e.target.value);
              if (chosen) set_paper_size(doc, chosen, landscape);
            }}
          >
            {!paper && <option value="">{_('Custom')}</option>}
            {PAGE_SIZES.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name} ({formatNumber(p.width, 2)} × {formatNumber(p.height, 2)} {p.unit})
              </option>
            ))}
          </select>
        </label>
        <div className="docprops-row">
          <span>{_('Width')}</span>
          <NumberField
            label={_('Width')}
            value={size.width}
            onCommit={(w) => set_document_dimensions(doc, w, size.height, size.unit)}
          />
          <span>{_('Height')}</span>
          <NumberField
            label={_('Height')}
            value={size.height}
            onCommit={(h) => set_document_dimensions(doc, size.width, h, size.unit)}
          />
          <select
            aria-label={_('Custom size units')}
            value={size.unit}
            onChange={(e) => {
              // Same page, other unit: the numbers change, not the size.
              const to = e.target.value;
              const w = convertUnit(size.width, size.unit, to);
              const h = convertUnit(size.height, size.unit, to);
              set_document_dimensions(doc, w, h, to);
            }}
          >
            {PAGE_UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
        <div className="docprops-row" role="radiogroup" aria-label={_('Orientation')}>
          <span>{_('Orientation')}</span>
          <label>
            <input
              type="radio"
              name="orientation"
              checked={!landscape}
              onChange={() => set_orientation(doc, false)}
            />
            {_('Portrait')}
          </label>
          <label>
            <input
              type="radio"
              name="orientation"
              checked={landscape}
              onChange={() => set_orientation(doc, true)}
            />
            {_('Landscape')}
          </label>
        </div>
        <label className="docprops-row">
          <span>{_('Display units')}</span>
          <select
            aria-label={_('Display units')}
            value={nv.getDisplayUnit()}
            onChange={(e) => set_display_unit(doc, e.target.value)}
          >
            {PAGE_UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      <fieldset>
        <legend>{_('Scale')}</legend>
        <div className="docprops-row">
          <span>{_('Scale')}</span>
          {scale ? (
            <NumberField label={_('Scale')} value={scale.x} onCommit={(s) => set_document_scale(doc, s)} />
          ) : (
            <span>{_('No scale')}</span>
          )}
        </div>
        <div className="docprops-row">
          <span>{_('ViewBox')}</span>
          <NumberField label="X" value={vb.left()} onCommit={(x) => set_viewbox_pos(doc, x, vb.top())} />
          <NumberField label="Y" value={vb.top()} onCommit={(y) => set_viewbox_pos(doc, vb.left(), y)} />
          <NumberField
            label={_('Width')}
            value={vb.width()}
            onCommit={(w) => set_viewbox_size(doc, w, vb.height())}
          />
          <NumberField
            label={_('Height')}
            value={vb.height()}
            onCommit={(h) => set_viewbox_size(doc, vb.width(), h)}
          />
        </div>
      </fieldset>

      <fieldset>
        <legend>{_('Background')}</legend>
        <ColorField
          label={_('Background color')}
          value={nv.getBackgroundColor()}
          onChange={(c) => set_background_color(doc, c)}
        />
        <label className="docprops-row">
          <span>{_('Checkerboard background')}</span>
          <input
            type="checkbox"
            checked={nv.checkerboard.value}
            onChange={(e) => set_checkerboard(doc, e.target.checked)}
          />
        </label>
        <ColorField
          label={_('Desk color')}
          value={nv.getDeskColor()}
          onChange={(c) => set_desk_color(doc, c)}
        />
      </fieldset>

      <fieldset>
        <legend>{_('Border')}</legend>
        <label className="docprops-row">
          <span>{_('Show page border')}</span>
          <input
            type="checkbox"
            checked={nv.border_show.value}
            onChange={(e) => set_show_border(doc, e.target.checked)}
          />
        </label>
        <ColorField label={_('Border color')} value={border} onChange={(c) => set_border_color(doc, c)} />
      </fieldset>
    </div>
  );
}
