// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/filter-effects-dialog.cpp, src/ui/dialog/filter-effects-dialog.h, share/ui/dialog-filter-editor.glade
/*
 * Filter Effects dialog.
 *
 * Authors:
 *   Nicholas Bishop <nicholasbishop@gmail.org>
 *   Rodrigo Kumpera <kumpera@gmail.com>
 *   Felipe C. da S. Sanches <juca@members.fsf.org>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *   insaner
 *
 * Copyright (C) 2007 Authors
 */
import {
  _,
  C_,
  ColorMatrixTypeConverter,
  ComponentTransferTypeData,
  FilterColorMatrixType,
  type FilterComponentTransferType,
  type FilterPrimitiveType,
  type LightSource,
  LightSourceData,
  SPFeColorMatrix,
  SPFeComponentTransfer,
  SPFeConvolveMatrix,
  type SPFilter,
  type SPFilterPrimitive,
  type SPObject,
} from '@inkscape-web/core';
import { FilterEffectsDialog as FE, type SPDesktop } from '@inkscape-web/editor';
import { type ReactNode, useEffect, useState } from 'react';
import { useActiveDesktop } from '../../app/active-desktop.ts';
import { SpinButton } from '../widget/spinbutton.tsx';
import { objectKey, useReprVersion, useSelectionVersion } from './use-repr.ts';

/** A GTK label without the mnemonic marker. */
const label = (s: string) => s.replace('_', '');
const num = (v: number, digits: number) => String(digits === 0 ? Math.trunc(v) : Number(v.toFixed(digits)));

/** Writes an attribute of the object of a settings widget. */
type SetAttr = (o: SPObject, name: string, val: string | null) => void;

/** A SpinScale: a number field with a slider (upstream SpinScaleAttr). */
function SpinScale(props: {
  label: string;
  tip?: string | undefined;
  value: number;
  lo: number;
  hi: number;
  step: number;
  digits: number;
  disabled?: boolean | undefined;
  onChange: (v: number) => void;
}) {
  return (
    <div className="filter-setting" title={props.tip}>
      <SpinButton
        label={props.label}
        tooltip={props.tip ?? ''}
        value={props.value}
        min={props.lo}
        max={props.hi}
        step={props.step}
        digits={props.digits}
        disabled={props.disabled ?? false}
        onChange={props.onChange}
      />
      <input
        type="range"
        aria-label={props.label}
        min={props.lo}
        max={props.hi}
        step={props.step}
        value={props.value}
        disabled={props.disabled ?? false}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </div>
  );
}

/** The matrix of feConvolveMatrix and feColorMatrix (upstream MatrixAttr). */
function Matrix(props: { o: SPObject; attr: string; tip: string; setAttr: SetAttr }) {
  const { rows, cols } = FE.matrix_size(props.o);
  const values = FE.matrix_values(props.o);
  return (
    <div className="filter-matrix" title={props.tip} style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {values.slice(0, rows * cols).map((v, i) => (
        <input
          // biome-ignore lint/suspicious/noArrayIndexKey: the cells are positions of the matrix
          key={i}
          className="filter-cell"
          type="number"
          step={0.1}
          aria-label={`${Math.floor(i / cols) + 1},${(i % cols) + 1}`}
          defaultValue={v}
          onBlur={(e) => {
            const n = Number.parseFloat(e.target.value);
            if (!Number.isFinite(n) || n === v) return;
            const next = [...values];
            next[i] = n;
            props.setAttr(props.o, props.attr, FE.matrix_as_attribute(next));
          }}
        />
      ))}
    </div>
  );
}

/** A text entry that commits on Enter or blur (upstream EntryAttr). */
function Entry(props: {
  label: string;
  tip?: string | undefined;
  value: string;
  onCommit: (v: string) => void;
}) {
  return (
    <label className="filter-setting" title={props.tip}>
      <span>{props.label}</span>
      <input
        className="attr-input"
        key={props.value}
        defaultValue={props.value}
        onBlur={(e) => e.target.value !== props.value && props.onCommit(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
    </label>
  );
}

/** The settings of one primitive or one of its children (upstream Settings::show_and_update). */
function Settings(props: {
  desktop: SPDesktop;
  filter: SPFilter;
  o: SPObject;
  specs: readonly FE.AttrWidgetSpec[];
  setAttr: SetAttr;
}) {
  const { desktop, filter, o, specs, setAttr } = props;
  const prim = o as SPFilterPrimitive;
  return (
    <>
      {specs.map((spec, i) => {
        const key = i;
        switch (spec.kind) {
          case 'checkbutton':
            return (
              <label key={key} className="filter-setting" title={spec.tip}>
                <input
                  type="checkbox"
                  checked={FE.read_check(o, spec)}
                  onChange={(e) => setAttr(o, spec.attr, e.target.checked ? spec.on : spec.off)}
                />
                {spec.label}
              </label>
            );
          case 'multispinbutton':
            return (
              <div key={key} className="filter-setting">
                <span>{spec.label}</span>
                {spec.attrs.map((attr, j) => {
                  // The convolve target is inside the kernel.
                  const order =
                    o instanceof SPFeConvolveMatrix ? FE.read_number_opt_number(o, 'order', '3') : null;
                  const hi = order ? (order[j] ?? 3) - 1 : spec.hi;
                  return (
                    <SpinButton
                      key={attr}
                      label=""
                      tooltip={spec.tips[j] ?? ''}
                      value={FE.read_spin(o, attr, spec.defs[j] ?? 0)}
                      min={spec.lo}
                      max={hi}
                      step={spec.step}
                      digits={spec.digits}
                      onChange={(v) => setAttr(o, attr, num(v, spec.digits))}
                    />
                  );
                })}
              </div>
            );
          case 'dualspinbutton': {
            const [v1, v2] = FE.read_number_opt_number(o, spec.attr, spec.def);
            const set = (a: number, b: number) =>
              setAttr(o, spec.attr, `${num(a, spec.digits)} ${num(b, spec.digits)}`);
            return (
              <div key={key} className="filter-setting">
                <span>{spec.label}</span>
                {[v1, v2].map((v, j) => (
                  <SpinButton
                    key={spec.tips[j]}
                    label=""
                    tooltip={spec.tips[j] ?? ''}
                    value={v}
                    min={spec.lo}
                    max={spec.hi}
                    step={spec.step}
                    digits={spec.digits}
                    onChange={(n) => (j === 0 ? set(n, v2) : set(v1, n))}
                  />
                ))}
              </div>
            );
          }
          case 'combo': {
            const value = o.getAttribute(spec.attr) ?? spec.def;
            return (
              <label key={key} className="filter-setting" title={spec.tip}>
                <span>{spec.label}</span>
                <select value={value} onChange={(e) => setAttr(o, spec.attr, e.target.value || null)}>
                  {spec.options.map((opt) => (
                    <option key={opt.key} value={opt.key}>
                      {_(opt.label)}
                    </option>
                  ))}
                </select>
              </label>
            );
          }
          case 'spinscale':
            return (
              <SpinScale
                key={key}
                label={spec.label}
                tip={spec.tip}
                value={FE.read_spin(o, spec.attr, spec.def)}
                lo={spec.lo}
                hi={spec.hi}
                step={spec.step}
                digits={spec.digits}
                disabled={/^k[1-4]$/.test(spec.attr) && !FE.use_k(prim)}
                onChange={(v) => setAttr(o, spec.attr, num(v, spec.digits))}
              />
            );
          case 'dualspinscale': {
            const { v1, v2, linked } = FE.read_dual(o, spec.attr, spec.lo);
            const set = (a: number, b: number, l: boolean) =>
              setAttr(
                o,
                spec.attr,
                FE.dual_as_attribute(Number(a.toFixed(spec.digits)), Number(b.toFixed(spec.digits)), l),
              );
            return (
              <div key={key} className="filter-dual">
                <SpinScale
                  {...spec}
                  label={spec.label}
                  value={v1}
                  onChange={(v) => set(v, linked ? v : v2, linked)}
                />
                {!linked && <SpinScale {...spec} label="" value={v2} onChange={(v) => set(v1, v, false)} />}
                <label className="filter-setting">
                  <input
                    type="checkbox"
                    checked={linked}
                    onChange={(e) => set(v1, e.target.checked ? v1 : v2, e.target.checked)}
                  />
                  {_('Link')}
                </label>
              </div>
            );
          }
          case 'color':
            return (
              <label key={key} className="filter-setting" title={spec.tip}>
                <span>{spec.label}</span>
                <input
                  type="color"
                  value={FE.read_color(o, spec.attr, spec.def)}
                  onChange={(e) => setAttr(o, spec.attr, e.target.value)}
                />
              </label>
            );
          case 'matrix':
            return (
              <div key={key} className="filter-setting filter-column">
                <span>{spec.label}</span>
                <Matrix
                  key={o.getAttribute('order') ?? ''}
                  o={o}
                  attr={spec.attr}
                  tip={spec.tip}
                  setAttr={setAttr}
                />
              </div>
            );
          case 'colormatrixvalues':
            return o instanceof SPFeColorMatrix ? (
              <ColorMatrixValues key={key} o={o} label={spec.label} setAttr={setAttr} />
            ) : null;
          case 'componenttransfer':
            return o instanceof SPFeComponentTransfer ? (
              <ComponentTransfer
                key={key}
                desktop={desktop}
                filter={filter}
                ct={o}
                channel={spec.channel}
                label={spec.label}
                setAttr={setAttr}
              />
            ) : null;
          case 'lightsource':
            return (
              <LightSourceControl key={key} desktop={desktop} filter={filter} prim={prim} setAttr={setAttr} />
            );
          case 'fileorelement':
            return (
              <div key={key} className="filter-setting">
                <Entry
                  label={spec.label}
                  value={o.getAttribute(spec.attr) ?? ''}
                  onCommit={(v) => setAttr(o, spec.attr, v)}
                />
                <button
                  type="button"
                  title={_('Use selected SVG element')}
                  onClick={() => {
                    const id = desktop.getSelection().items()[0]?.getId();
                    if (id) setAttr(o, spec.attr, `#${id}`);
                  }}
                >
                  {_('SVG Element')}
                </button>
              </div>
            );
          case 'entry':
            return (
              <Entry
                key={key}
                label={spec.label}
                tip={spec.tip}
                value={o.getAttribute(spec.attr) ?? ''}
                onCommit={(v) => setAttr(o, spec.attr, v)}
              />
            );
          case 'subregion': {
            const on = FE.has_subregion(o);
            return (
              <div key={key} className="filter-column">
                <label className="filter-setting">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) => FE.set_subregion(filter, prim, e.target.checked)}
                  />
                  {_('Define subregion')}
                </label>
                {on &&
                  (
                    [
                      ['x', _('Position X'), 0],
                      ['y', _('Position Y'), 0],
                      ['width', _('Width'), 100],
                      ['height', _('Height'), 100],
                    ] as const
                  ).map(([attr, tip, def]) => (
                    <SpinButton
                      key={attr}
                      label={attr === 'width' ? 'W' : attr === 'height' ? 'H' : attr.toUpperCase()}
                      tooltip={tip}
                      value={FE.read_spin(o, attr, def)}
                      min={-10000000}
                      max={10000000}
                      step={1}
                      digits={3}
                      onChange={(v) => setAttr(o, attr, String(v))}
                    />
                  ))}
              </div>
            );
          }
          case 'noparams':
            return (
              <p key={key} className="filter-empty">
                {_('This SVG filter effect does not require any parameters.')}
              </p>
            );
          default:
            return null;
        }
      })}
    </>
  );
}

/** The values of feColorMatrix: a matrix, a saturation, an angle or nothing (upstream ColorMatrixValues). */
function ColorMatrixValues(props: { o: SPFeColorMatrix; label: string; setAttr: SetAttr }) {
  const { o, setAttr } = props;
  const { type, value } = FE.color_matrix_state(o);
  let widget: ReactNode;
  switch (type) {
    case FilterColorMatrixType.COLORMATRIX_SATURATE:
      widget = (
        <SpinScale
          label=""
          value={value}
          lo={0}
          hi={1}
          step={0.1}
          digits={2}
          onChange={(v) => setAttr(o, 'values', num(v, 2))}
        />
      );
      break;
    case FilterColorMatrixType.COLORMATRIX_HUEROTATE:
      widget = (
        <SpinScale
          label=""
          value={value}
          lo={0}
          hi={360}
          step={0.1}
          digits={2}
          onChange={(v) => setAttr(o, 'values', num(v, 2))}
        />
      );
      break;
    case FilterColorMatrixType.COLORMATRIX_LUMINANCETOALPHA:
      widget = <span className="filter-empty">{C_('Label', 'None')}</span>;
      break;
    default:
      widget = (
        <Matrix
          key={ColorMatrixTypeConverter.get_key(type)}
          o={o}
          attr="values"
          tip={_(
            'This matrix determines a linear transform on color space. Each line affects one of the color components. Each column determines how much of each color component from the input is passed to the output. The last column does not depend on input colors, so can be used to adjust a constant component value.',
          )}
          setAttr={setAttr}
        />
      );
  }
  return (
    <div className="filter-setting filter-column">
      <span>{props.label}</span>
      {widget}
    </div>
  );
}

/** The transfer function of one channel (upstream ComponentTransferValues). */
function ComponentTransfer(props: {
  desktop: SPDesktop;
  filter: SPFilter;
  ct: SPFeComponentTransfer;
  channel: number;
  label: string;
  setAttr: SetAttr;
}) {
  const { desktop, filter, ct, channel, setAttr } = props;
  const type = FE.func_type(ct, channel);
  const node = FE.find_func_node(ct, channel);
  return (
    <fieldset className="filter-column">
      <legend>{props.label}</legend>
      <select
        aria-label={props.label}
        value={type}
        onChange={(e) =>
          FE.set_func_type(filter, ct, channel, Number(e.target.value) as FilterComponentTransferType)
        }
      >
        {ComponentTransferTypeData.map((d) => (
          <option key={d.id} value={d.id}>
            {_(d.label)}
          </option>
        ))}
      </select>
      {node && (
        <Settings
          desktop={desktop}
          filter={filter}
          o={node}
          specs={FE.component_transfer_settings(type)}
          setAttr={setAttr}
        />
      )}
    </fieldset>
  );
}

/** The light source of a lighting primitive (upstream LightSourceControl). */
function LightSourceControl(props: {
  desktop: SPDesktop;
  filter: SPFilter;
  prim: SPFilterPrimitive;
  setAttr: SetAttr;
}) {
  const { desktop, filter, prim, setAttr } = props;
  const ls = FE.get_light_source(prim);
  const child = prim.children[0];
  return (
    <div className="filter-column">
      <label className="filter-setting">
        <span>{_('Light Source:')}</span>
        <select
          value={ls ?? ''}
          onChange={(e) =>
            FE.set_light_source(prim, e.target.value === '' ? null : (Number(e.target.value) as LightSource))
          }
        >
          <option value="" />
          {LightSourceData.map((d) => (
            <option key={d.id} value={d.id}>
              {_(d.label)}
            </option>
          ))}
        </select>
      </label>
      {ls !== null && child && (
        <Settings
          desktop={desktop}
          filter={filter}
          o={child}
          specs={FE.light_source_settings(ls)}
          setAttr={setAttr}
        />
      )}
    </div>
  );
}

/** The input selectors of a primitive (the connections of upstream PrimitiveList). */
function Inputs(props: { filter: SPFilter; prim: SPFilterPrimitive }) {
  const { filter, prim } = props;
  const sources = FE.input_sources(filter, prim);
  const count = FE.input_count(prim);
  const selectedOf = (n: number): string => {
    const v = FE.get_input(prim, n);
    if (v === null) return '';
    const i = sources.findIndex(({ source }) =>
      'input' in source ? source.input === v : source.primitive.getAttribute('result') === v,
    );
    return i < 0 ? '' : String(i);
  };
  return (
    <div className="filter-inputs">
      {Array.from({ length: count }, (_x, n) => (
        <select
          // biome-ignore lint/suspicious/noArrayIndexKey: the inputs are positions
          key={n}
          aria-label={`${_('Input')} ${n + 1}`}
          value={selectedOf(n)}
          onChange={(e) =>
            FE.set_input(
              filter,
              prim,
              n,
              e.target.value === '' ? null : (sources[Number(e.target.value)]?.source ?? null),
            )
          }
        >
          <option value="">{n === 0 && count < 3 ? _('Default') : '—'}</option>
          {sources.map((s, i) => (
            <option key={s.label + String(i)} value={i}>
              {s.label}
            </option>
          ))}
        </select>
      ))}
    </div>
  );
}

/**
 * The Filter Editor dialog (dialog key "FilterEffects"): the filters of the document (add,
 * rename, duplicate, delete, apply to the selection), the filter region, the primitives of the
 * selected filter (add, reorder, delete, inputs) and the settings of the selected primitive.
 * TODO: the connection canvas of upstream (the inputs are drop-down lists here), the image file
 * chooser of feImage.
 */
export function FilterEffectsDialog() {
  const desktop = useActiveDesktop();
  useReprVersion(desktop?.doc.rroot ?? null);
  const selVersion = useSelectionVersion(desktop);
  const [filterKey, setFilterKey] = useState<SPFilter | null>(null);
  const [primKey, setPrimKey] = useState<SPFilterPrimitive | null>(null);
  const [renaming, setRenaming] = useState<SPFilter | null>(null);
  const [addType, setAddType] = useState<FilterPrimitiveType | null>(null);

  const doc = desktop?.getDocument() ?? null;
  const filters = doc ? FE.get_filters(doc) : [];
  // Keeps the same selection if possible, otherwise selects the first element
  const filter = filterKey && filters.includes(filterKey) ? filterKey : (filters[0] ?? null);
  const rows = FE.primitive_rows(filter);
  const prim = rows.find((r) => r.primitive === primKey)?.primitive ?? rows[0]?.primitive ?? null;
  const counts = desktop
    ? FE.filter_selection_counts(desktop.getSelection().items())
    : new Map<SPFilter, number>();

  // If only one filter is in use by the selection, select it (upstream update_selection).
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the selection changes
  useEffect(() => {
    if (counts.size === 1) setFilterKey([...counts.keys()][0] ?? null);
  }, [selVersion]);

  if (!desktop || !doc) return null;
  const setAttr: SetAttr = (o, name, val) => filter && FE.set_attr(filter, o, name, val);
  const menu = FE.get_effect_menu();

  return (
    <div className="filter-editor">
      <section>
        <div className="docprops-row">
          <b>{label(_('_Filter'))}</b>
          <button
            type="button"
            title={_('Add filter')}
            onClick={() => setFilterKey(FE.add_filter(doc, filters.length))}
          >
            {_('New')}
          </button>
          <button
            type="button"
            disabled={!filter}
            onClick={() => filter && setFilterKey(FE.duplicate_filter(filter))}
          >
            {label(_('_Duplicate'))}
          </button>
          <button type="button" disabled={!filter} onClick={() => filter && setRenaming(filter)}>
            {label(_('R_ename'))}
          </button>
          <button
            type="button"
            disabled={!filter}
            onClick={() => filter && FE.remove_filter(desktop, filter)}
          >
            {label(_('_Remove'))}
          </button>
          <button
            type="button"
            disabled={!filter}
            onClick={() => filter && FE.select_filter_elements(desktop, filter)}
          >
            {_('Select Filter Elements')}
          </button>
        </div>
        <table className="filter-list">
          <thead>
            <tr>
              <th />
              <th>{label(_('_Filter'))}</th>
              <th>{_('Used')}</th>
            </tr>
          </thead>
          <tbody>
            {filters.map((f) => (
              <tr key={objectKey(f)} aria-selected={f === filter} onClick={() => setFilterKey(f)}>
                <td>
                  <input
                    type="radio"
                    aria-label={_('Apply filter')}
                    checked={(counts.get(f) ?? 0) > 0}
                    disabled={desktop.getSelection().isEmpty()}
                    onChange={() => FE.selection_toggled(desktop, f, false)}
                  />
                </td>
                <td onDoubleClick={() => setRenaming(f)}>
                  {renaming === f ? (
                    <input
                      className="attr-input"
                      aria-label={_('Rename filter')}
                      // biome-ignore lint/a11y/noAutofocus: the rename entry replaces the name
                      autoFocus
                      defaultValue={FE.get_filter_name(f)}
                      onBlur={(e) => {
                        if (e.target.value !== FE.get_filter_name(f)) FE.rename_filter(f, e.target.value);
                        setRenaming(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                        else if (e.key === 'Escape') setRenaming(null);
                      }}
                    />
                  ) : (
                    FE.get_filter_name(f)
                  )}
                </td>
                <td>{f.hrefcount}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filter ? (
          <Settings
            desktop={desktop}
            filter={filter}
            o={filter}
            specs={FE.filter_general_settings()}
            setAttr={(_o, n, v) => FE.set_filternode_attr(filter, n, v ?? '')}
          />
        ) : (
          <p className="filter-empty">{_('No filter selected')}</p>
        )}
      </section>
      {filter && (
        <section>
          <div className="docprops-row">
            <b>{_('Effects')}</b>
            <select
              aria-label={_('Add Effect:')}
              value={addType ?? ''}
              onChange={(e) =>
                setAddType(e.target.value === '' ? null : (Number(e.target.value) as FilterPrimitiveType))
              }
            >
              <option value="" />
              {[0, 1, 2, 3].map((cat) => (
                <optgroup key={cat} label={FE.get_category_name(cat)}>
                  {menu
                    .filter((m) => m.category === cat)
                    .map((m) => (
                      <option key={m.type} value={m.type} title={m.tooltip}>
                        {m.label}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
            <button
              type="button"
              disabled={addType === null}
              onClick={() => addType !== null && setPrimKey(FE.add_filter_primitive(filter, addType))}
            >
              {_('Add Effect')}
            </button>
          </div>
          <ol className="filter-primitives">
            {rows.map((row, i) => (
              <li key={objectKey(row.primitive)} aria-current={row.primitive === prim}>
                <button
                  type="button"
                  className="filter-primitive-name"
                  onClick={() => setPrimKey(row.primitive)}
                >
                  {row.type}
                  {row.primitive.getAttribute('result') ? ` → ${row.primitive.getAttribute('result')}` : ''}
                </button>
                <Inputs filter={filter} prim={row.primitive} />
                <span className="filter-primitive-actions">
                  <button
                    type="button"
                    title={_('Move up')}
                    disabled={i === 0}
                    onClick={() => FE.move_primitive(filter, row.primitive, i - 1)}
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    title={_('Move down')}
                    disabled={i === rows.length - 1}
                    onClick={() => FE.move_primitive(filter, row.primitive, i + 1)}
                  >
                    ▼
                  </button>
                  <button
                    type="button"
                    title={label(_('_Duplicate'))}
                    onClick={() => setPrimKey(FE.duplicate_primitive(filter, row.primitive))}
                  >
                    ⧉
                  </button>
                  <button
                    type="button"
                    title={label(_('_Remove'))}
                    onClick={() => FE.remove_primitive(row.primitive)}
                  >
                    ✕
                  </button>
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
      <section className="filter-settings">
        {filter && prim ? (
          <>
            <b>{rows.find((r) => r.primitive === prim)?.type}</b>
            <Settings
              desktop={desktop}
              filter={filter}
              o={prim}
              specs={FE.primitive_settings(rows.find((r) => r.primitive === prim)?.type_id ?? 0)}
              setAttr={setAttr}
            />
          </>
        ) : (
          <p className="filter-empty">{FE.empty_settings_text(filter, filters.length > 0)}</p>
        )}
      </section>
    </div>
  );
}
