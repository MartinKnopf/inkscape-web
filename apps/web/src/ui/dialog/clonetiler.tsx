// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/clonetiler.cpp, src/ui/dialog/clonetiler.h
/*
 * Clone tiling dialog
 *
 * Authors:
 *   bulia byak <buliabyak@users.sf.net>
 *   Johan Engelen <goejendaagh@zonnet.nl>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *   Romain de Bossoreille
 *
 * Copyright (C) 2004-2011 Authors
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { _, C_, Colors, convertUnit, N_, Preferences, UnitType, unitsOfType } from '@inkscape-web/core';
import {
  clonetiler_apply,
  clonetiler_remove,
  clonetiler_reset,
  clonetiler_status,
  clonetiler_status_text,
  clonetiler_tabs,
  clonetiler_unclump,
  PickType,
  prefs_path,
  type SPDesktop,
  sym_groups,
  type TilerCell,
  type TilerSpin,
  trace_controls,
} from '@inkscape-web/editor';
import { Fragment, type ReactNode, useEffect, useReducer, useState } from 'react';
import { useActiveDesktop } from '../../app/active-desktop.ts';
import { useSelectionUpdates } from '../toolbar/toolbar.tsx';
import { SpinButton } from '../widget/spinbutton.tsx';
import { objectKey } from './use-repr.ts';

/** Pango markup (<b>, <small> and numeric entities) as elements; the mnemonic marker is dropped. */
function Markup({ text }: { text: string }) {
  const parts = text
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .split(/(<\/?(?:b|small)>)/);
  let bold = false;
  let small = false;
  const out: ReactNode[] = [];
  parts.forEach((part, i) => {
    if (part === '<b>') bold = true;
    else if (part === '</b>') bold = false;
    else if (part === '<small>') small = true;
    else if (part === '</small>') small = false;
    else if (part) {
      let node: ReactNode = part;
      if (bold) node = <b>{node}</b>;
      if (small) node = <small>{node}</small>;
      // biome-ignore lint/suspicious/noArrayIndexKey: the parts are static
      out.push(<Fragment key={i}>{node}</Fragment>);
    }
  });
  return <>{out}</>;
}

/** A label of the dialog without the mnemonic marker. */
const plain = (msgid: string): string => _(msgid).replace('_', '');

/** Re-render when a preference of the dialog changes. */
function usePrefsUpdates(): void {
  const [, update] = useReducer((n: number) => n + 1, 0);
  useEffect(
    () =>
      Preferences.get().changedSignal.connect((path) => {
        if (path.startsWith(prefs_path)) update();
      }),
    [],
  );
}

const prefs = () => Preferences.get();

/** A number field bound to the preference key (upstream spinbox()). */
function SpinCell({ cell }: { cell: TilerSpin }) {
  const value = prefs().getDoubleLimited(
    prefs_path + cell.key,
    cell.exponent ? 1 : 0,
    cell.lower,
    cell.upper,
  );
  return (
    <span className="clonetiler-cell">
      <SpinButton
        label=""
        tooltip={_(cell.tip)}
        value={value}
        min={cell.lower}
        max={cell.upper}
        step={cell.exponent ? 0.01 : 0.1}
        digits={3}
        onChange={(v) => prefs().setDouble(prefs_path + cell.key, v)}
      />
      {cell.suffix && (
        <span>
          <Markup text={cell.suffix} />
        </span>
      )}
    </span>
  );
}

/** A check box bound to the preference key (upstream checkbox()). */
function Check(props: { prefKey: string; tip: string; label?: string; def?: boolean }) {
  return (
    <label className="clonetiler-cell" title={props.tip}>
      <input
        type="checkbox"
        checked={prefs().getBool(prefs_path + props.prefKey, props.def ?? false)}
        onChange={(e) => prefs().setBool(prefs_path + props.prefKey, e.target.checked)}
      />
      {props.label && <span>{props.label}</span>}
    </label>
  );
}

const Cell = ({ cell }: { cell: TilerCell | null }) =>
  !cell ? (
    <span />
  ) : cell.kind === 'spin' ? (
    <SpinCell cell={cell} />
  ) : (
    <Check prefKey={cell.key} tip={_(cell.tip)} />
  );

/** The grid of a tab (upstream table_x_y_rand()). */
function Table({ rows }: { rows: (typeof clonetiler_tabs)[number]['rows'] }) {
  return (
    <div className="clonetiler-table">
      <span />
      <small>{_('Per row:')}</small>
      <small>{_('Per column:')}</small>
      <small>{_('Randomize:')}</small>
      {rows.map((row) => (
        <Fragment key={row.label + row.cells.map((c) => c?.key).join()}>
          <span>
            <Markup text={_(row.label)} />
          </span>
          {[0, 1, 2].map((c) => (
            <Cell key={c} cell={row.cells[c] ?? null} />
          ))}
        </Fragment>
      ))}
    </div>
  );
}

function SymmetryTab() {
  const current = prefs().getInt(`${prefs_path}symmetrygroup`, 0);
  return (
    <select
      value={current}
      title={_('Select one of the 17 symmetry groups for the tiling')}
      onChange={(e) => prefs().setInt(`${prefs_path}symmetrygroup`, Number(e.target.value))}
    >
      {sym_groups.map((label, i) => (
        <option key={label} value={i}>
          {_(label)
            .replace(/<\/?b>/g, '')
            .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))}
        </option>
      ))}
    </select>
  );
}

/** The initial color of the clones (the color picker above the table of the Color tab). */
function InitialColor() {
  const stored = Colors.Color.parse(prefs().getString(`${prefs_path}initial_color`, '#000000ff'));
  const hex = (stored?.toString(false) ?? '#000000').slice(0, 7);
  return (
    <label
      className="clonetiler-cell"
      title={_(
        'Initial color for clones (works only if the original has unset fill or stroke or on spray tool in copy mode)',
      )}
    >
      <span>{_('Initial color: ')}</span>
      <input
        type="color"
        aria-label={_('Initial color of tiled clones')}
        value={hex}
        onChange={(e) => prefs().setString(`${prefs_path}initial_color`, `${e.target.value}ff`)}
      />
    </label>
  );
}

const PICKS: readonly [PickType, string, string][] = [
  [PickType.PICK_COLOR, N_('Color'), N_('Pick the visible color and opacity')],
  [PickType.PICK_OPACITY, N_('Opacity'), N_('Pick the total accumulated opacity')],
  [PickType.PICK_R, N_('R'), N_('Pick the Red component of the color')],
  [PickType.PICK_G, N_('G'), N_('Pick the Green component of the color')],
  [PickType.PICK_B, N_('B'), N_('Pick the Blue component of the color')],
  [PickType.PICK_H, 'H', N_('Pick the hue of the color')],
  [PickType.PICK_S, 'S', N_('Pick the saturation of the color')],
  [PickType.PICK_L, 'L', N_('Pick the lightness of the color')],
];

/** The label of a pick radio button; H, S and L have a context. */
const pickLabel = (type: PickType, msgid: string): string =>
  type === PickType.PICK_H
    ? C_('Clonetiler color hue', 'H')
    : type === PickType.PICK_S
      ? C_('Clonetiler color saturation', 'S')
      : type === PickType.PICK_L
        ? C_('Clonetiler color lightness', 'L')
        : _(msgid);

function TraceTab() {
  const dotrace = prefs().getBool(`${prefs_path}dotrace`);
  const pick = prefs().getInt(`${prefs_path}pick`, 0);
  const [gamma, rand, invert] = trace_controls;
  return (
    <div>
      <Check
        prefKey="dotrace"
        label={_('Map clones to the appearance of objects positioned underneath')}
        tip={_('For each clone/sprayed item, pick a value from the drawing in its location and apply it')}
      />
      <div className="clonetiler-trace" aria-disabled={!dotrace}>
        <fieldset disabled={!dotrace}>
          <legend>{_('1. Pick from the drawing:')}</legend>
          <div className="clonetiler-picks">
            {PICKS.map(([type, label, tip]) => (
              <label key={type} title={_(tip)}>
                <input
                  type="radio"
                  name="clonetiler-pick"
                  checked={pick === type}
                  onChange={() => prefs().setInt(`${prefs_path}pick`, type)}
                />
                {pickLabel(type, label)}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset disabled={!dotrace}>
          <legend>{_('2. Tweak the picked value:')}</legend>
          <div className="clonetiler-table">
            <span>{_('Gamma-correct:')}</span>
            <Cell cell={gamma ?? null} />
            <span>{_('Randomize:')}</span>
            <Cell cell={rand ?? null} />
            <span>{_('Invert:')}</span>
            <Cell cell={invert ?? null} />
          </div>
        </fieldset>
        <fieldset disabled={!dotrace}>
          <legend>{_("3. Apply the value to the clones':")}</legend>
          <div className="clonetiler-picks">
            <Check
              prefKey="pick_to_presence"
              def
              label={_('Presence')}
              tip={_(
                'Each clone is created with the probability determined by the picked value in that point',
              )}
            />
            <Check
              prefKey="pick_to_size"
              label={_('Size')}
              tip={_("Each clone's size is determined by the picked value in that point")}
            />
            <Check
              prefKey="pick_to_color"
              label={_('Color')}
              tip={_(
                'Each clone is painted by the picked color (the original must have unset fill or stroke)',
              )}
            />
            <Check
              prefKey="pick_to_opacity"
              label={_('Opacity')}
              tip={_("Each clone's opacity is determined by the picked value in that point")}
            />
          </div>
        </fieldset>
      </div>
    </div>
  );
}

/** The rows and columns, or the width and height of the tiling. */
function SizeControls({ desktop }: { desktop: SPDesktop }) {
  const fillrect = prefs().getBool(`${prefs_path}fillrect`);
  const [unit, setUnit] = useState(() => desktop.getNamedView().getDisplayUnit());
  const units = unitsOfType(UnitType.LINEAR).map((u) => u.abbr);
  const size = (key: 'fillwidth' | 'fillheight', tip: string) => (
    <SpinButton
      label=""
      tooltip={tip}
      value={convertUnit(prefs().getDoubleLimited(prefs_path + key, 50, 0, 1e6), 'px', unit)}
      min={-1e6}
      max={1e6}
      step={1}
      digits={4}
      disabled={!fillrect}
      onChange={(v) => prefs().setDouble(prefs_path + key, convertUnit(v, unit, 'px'))}
    />
  );
  const count = (key: 'jmax' | 'imax', tip: string) => (
    <SpinButton
      label=""
      tooltip={tip}
      value={prefs().getInt(prefs_path + key, 2)}
      min={1}
      max={500}
      step={1}
      digits={0}
      disabled={fillrect}
      onChange={(v) => prefs().setInt(prefs_path + key, Math.floor(v + 0.5))}
    />
  );
  return (
    <div className="clonetiler-size">
      <label title={_('Create the specified number of rows and columns')}>
        <input
          type="radio"
          name="clonetiler-fill"
          checked={!fillrect}
          onChange={() => prefs().setBool(`${prefs_path}fillrect`, false)}
        />
        {_('Rows, columns: ')}
      </label>
      {count('jmax', _('How many rows in the tiling'))}
      <span>×</span>
      {count('imax', _('How many columns in the tiling'))}
      <label title={_('Fill the specified width and height with the tiling')}>
        <input
          type="radio"
          name="clonetiler-fill"
          checked={fillrect}
          onChange={() => prefs().setBool(`${prefs_path}fillrect`, true)}
        />
        {_('Width, height: ')}
      </label>
      {size('fillwidth', _('Width of the rectangle to be filled'))}
      <span>×</span>
      {size('fillheight', _('Height of the rectangle to be filled'))}
      <select value={unit} disabled={!fillrect} onChange={(e) => setUnit(e.target.value)}>
        {units.map((u) => (
          <option key={u} value={u}>
            {u}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * The Clone Tiler dialog (dialog key "CloneTiler"): create a tiling of clones of the selected
 * object in one of the 17 symmetry groups, with shift, scale, rotation, blur, opacity and color
 * that change per row and per column or at random, optionally from the drawing under the clones.
 * The values are the preferences /dialogs/clonetiler/*, as upstream.
 */
export function CloneTilerDialog() {
  const desktop = useActiveDesktop();
  if (!desktop) return null;
  return <CloneTilerDialogImpl key={objectKey(desktop.doc) + objectKey(desktop)} desktop={desktop} />;
}

function CloneTilerDialogImpl({ desktop }: { desktop: SPDesktop }) {
  useSelectionUpdates(desktop);
  usePrefsUpdates();
  const tabs = [
    { label: _('_Symmetry'), body: <SymmetryTab /> },
    ...clonetiler_tabs.map((tab) => ({
      label: _(tab.label),
      body: (
        <>
          {tab.label === 'Co_lor' && <InitialColor />}
          <Table rows={tab.rows} />
        </>
      ),
    })),
    { label: _('_Trace'), body: <TraceTab /> },
  ];
  const [tab, setTab] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const status = clonetiler_status(desktop);
  const hasClones = status.kind === 'clones' && status.count > 0;
  // A warning is for the selection that caused it.
  const selected = desktop.getSelection().singleItem();
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a changed selection clears the message.
  useEffect(() => setMessage(null), [selected]);

  const run = (f: () => string | null) => setMessage(f());
  const create = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      setMessage(await clonetiler_apply(desktop));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="docprops-tabs clonetiler">
      <div className="docprops-tabbar" role="tablist">
        {tabs.map((t, i) => (
          <button key={t.label} type="button" role="tab" aria-selected={tab === i} onClick={() => setTab(i)}>
            {t.label.replace('_', '')}
          </button>
        ))}
      </div>
      <div className="docprops clonetiler-page">{tabs[tab]?.body}</div>
      <div className="clonetiler-bottom">
        <span>
          <Markup text={_('Apply to tiled clones:')} />
        </span>
        <SizeControls desktop={desktop} />
        <Check
          prefKey="keepbbox"
          def
          label={_('Use saved size and position of the tile')}
          tip={_(
            'Pretend that the size and position of the tile are the same as the last time you tiled it (if any), instead of using the current size',
          )}
        />
        <div className="clonetiler-status" role="status">
          <Markup
            text={busy ? _('<small>Creating tiled clones...</small>') : clonetiler_status_text(status)}
          />
          {message && (
            <div className="clonetiler-warning">
              <Markup text={message} />
            </div>
          )}
        </div>
        <div className="clonetiler-buttons">
          <button
            type="button"
            title={_('Reset all shifts, scales, rotates, opacity and color changes in the dialog to zero')}
            onClick={clonetiler_reset}
          >
            {plain(' R_eset ').trim()}
          </button>
          <button
            type="button"
            disabled={!hasClones}
            title={_('Remove existing tiled clones of the selected object (siblings only)')}
            onClick={() => run(() => clonetiler_remove(desktop))}
          >
            {plain(' Re_move ').trim()}
          </button>
          <button
            type="button"
            disabled={!hasClones}
            title={_('Spread out clones to reduce clumping; can be applied repeatedly')}
            onClick={() => run(() => clonetiler_unclump(desktop))}
          >
            {plain(' _Unclump ').trim()}
          </button>
          <button
            type="button"
            disabled={busy}
            title={_('Create and tile the clones of the selection')}
            onClick={() => void create()}
          >
            <b>
              {plain(' <b>_Create</b> ')
                .replace(/<\/?b>/g, '')
                .trim()}
            </b>
          </button>
        </div>
      </div>
    </div>
  );
}
