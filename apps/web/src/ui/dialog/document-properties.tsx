// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/document-properties.cpp, src/ui/widget/page-properties.cpp
import { _, Colors, convertUnit, formatNumber, PAGE_SIZES } from '@inkscape-web/core';
import {
  get_document_scale,
  getPageSize,
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
 * (page size, scale, viewBox, display units, colors, border, checkerboard).
 * TODO: the other tabs (guides, grids, color management, scripting, metadata, license),
 * margins and bleed, multiple pages, content scaling when the scale changes.
 */
export function DocumentPropertiesDialog() {
  const desktop = useActiveDesktop();
  if (!desktop) return null;
  return <DocumentProperties key={objectKey(desktop.doc)} desktop={desktop} />;
}

function DocumentProperties({ desktop }: { desktop: SPDesktop }) {
  const doc = desktop.doc;
  useReprVersion(doc.rroot);
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
