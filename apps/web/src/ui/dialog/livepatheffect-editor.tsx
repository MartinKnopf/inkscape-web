// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/livepatheffect-editor.cpp, src/ui/dialog/livepatheffect-editor.h
import {
  _,
  type BoolParam,
  type Effect,
  type EnumParam,
  type Parameter,
  type ParamWidget,
  type PathParam,
  type PointParam,
  type RandomParam,
  type ScalarParam,
  type SPLPEItem,
  type ToggleButtonParam,
  type UnitParam,
} from '@inkscape-web/core';
import { LivePathEffectEditor as LPE, type SPDesktop } from '@inkscape-web/editor';
import { Point } from '@inkscape-web/geom';
import { useState } from 'react';
import { useActiveDesktop } from '../../app/active-desktop.ts';
import { iconFallback, iconUrl } from '../icon-loader.ts';
import { SpinButton } from '../widget/spinbutton.tsx';
import { objectKey, useReprVersion, useSelectionVersion } from './use-repr.ts';
import './livepatheffect-editor.css';

/** A GTK label without the mnemonic marker and markup entities (e.g. "&amp;"). */
const label = (s: string) => s.replace('_', '').replaceAll('&amp;', '&');

function Icon({ name }: { name: string }) {
  return <img className="lpe-icon" src={iconUrl(name)} onError={iconFallback(name)} alt="" />;
}

/** The widget of one parameter (upstream param_newWidget). */
function ParamRow(props: {
  desktop: SPDesktop;
  item: SPLPEItem;
  param: Parameter | null;
  widget: ParamWidget;
}) {
  const { desktop, item, param, widget } = props;
  const title = param?.param_getTooltip().replace(/<[^>]+>/g, '');
  const text = param ? label(param.param_label) : '';
  switch (widget.kind) {
    case 'scalar':
      return (
        <div className="lpe-param">
          <SpinButton
            label={text}
            tooltip={title ?? ''}
            value={widget.value}
            min={widget.min}
            max={widget.max}
            step={widget.inc_step}
            digits={widget.digits}
            onChange={(v) => (param as ScalarParam).param_set_from_widget(v)}
          />
          {widget.slider && (
            <input
              type="range"
              aria-label={text}
              min={Math.max(widget.min, -1e6)}
              max={Math.min(widget.max, 1e6)}
              step={widget.inc_step}
              value={widget.value}
              onChange={(e) => (param as ScalarParam).param_set_from_widget(Number(e.target.value))}
            />
          )}
        </div>
      );
    case 'bool':
      return (
        <label className="lpe-param lpe-check" title={title}>
          <input
            type="checkbox"
            checked={widget.value}
            onChange={(e) => (param as BoolParam).param_set_from_widget(e.target.checked)}
          />
          {text}
        </label>
      );
    case 'toggle':
      return (
        <button
          type="button"
          className="lpe-param lpe-toggle"
          aria-pressed={widget.value}
          title={title}
          onClick={() => (param as ToggleButtonParam).param_set_from_widget(!widget.value)}
        >
          {label(widget.value ? widget.label_on : widget.label_off)}
        </button>
      );
    case 'enum':
      return (
        <label className="lpe-param" title={title}>
          <span>{text}</span>
          <select
            value={widget.value}
            onChange={(e) => (param as EnumParam<number>).param_set_from_widget(e.target.value)}
          >
            {widget.options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      );
    case 'unit':
      return (
        <label className="lpe-param" title={title}>
          <span>{text}</span>
          <select
            value={widget.value}
            onChange={(e) => (param as UnitParam).param_set_from_widget(e.target.value)}
          >
            {widget.options.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </label>
      );
    case 'point':
      return (
        <div className="lpe-param lpe-point" title={title}>
          <span>{text}</span>
          <SpinButton
            label="X"
            tooltip=""
            value={widget.x}
            min={-1e9}
            max={1e9}
            step={1}
            digits={3}
            onChange={(x) => (param as PointParam).param_set_from_widget(new Point(x, widget.y))}
          />
          <SpinButton
            label="Y"
            tooltip=""
            value={widget.y}
            min={-1e9}
            max={1e9}
            step={1}
            digits={3}
            onChange={(y) => (param as PointParam).param_set_from_widget(new Point(widget.x, y))}
          />
        </div>
      );
    case 'random':
      return (
        <div className="lpe-param lpe-random">
          <SpinButton
            label={text}
            tooltip={title ?? ''}
            value={widget.value}
            min={widget.min}
            max={widget.max}
            step={widget.integer ? 1 : 0.1}
            digits={widget.integer ? 0 : 2}
            onChange={(v) => (param as RandomParam).param_set_from_widget(v, widget.seed)}
          />
          <button
            type="button"
            title={_(
              'Reseed the random number generator; this creates a different sequence of random numbers.',
            )}
            onClick={() =>
              (param as RandomParam).param_set_from_widget(
                widget.value,
                Math.floor(Math.random() * 2147483646) + 1,
              )
            }
          >
            <Icon name="randomize" />
          </button>
        </div>
      );
    case 'path':
      return (
        <div className="lpe-param lpe-path" title={title}>
          <span>{text}</span>
          <button
            type="button"
            title={_('Edit on-canvas')}
            onClick={() => LPE.param_editOncanvas(desktop, param as PathParam, item)}
          >
            <Icon name="tool-node-editor" />
          </button>
        </div>
      );
    case 'buttons':
      return (
        <div className="lpe-param lpe-buttons">
          {widget.buttons.map((b) => (
            <button key={b.label} type="button" onClick={b.onClick}>
              {b.label}
            </button>
          ))}
        </div>
      );
  }
}

/** The parameters of the current effect. */
function EffectParams({ desktop, item, effect }: { desktop: SPDesktop; item: SPLPEItem; effect: Effect }) {
  const widgets = LPE.effectWidgets(effect);
  if (widgets.length === 0) return <div className="lpe-noparams">{_('Without parameters')}</div>;
  return (
    <div className="lpe-params">
      {widgets.map(({ param, widget }, i) => (
        <ParamRow
          key={param?.param_key ?? `w${i}`}
          desktop={desktop}
          item={item}
          param={param}
          widget={widget}
        />
      ))}
    </div>
  );
}

/** The searchable list of the effects that can be added (upstream _lpes_popup). */
function AddEffect({ desktop, item }: { desktop: SPDesktop; item: SPLPEItem }) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const lpes = LPE.filter_lpes(LPE.get_list_of_applicable_lpes(item), search);
  let category = -1;
  return (
    <div className="lpe-add">
      <input
        type="search"
        placeholder={_('Add Live Path Effect')}
        value={search}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setSearch(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
          const first = lpes.find((l) => l.sensitive);
          if (e.key === 'Enter' && first) {
            LPE.onAdd(desktop, item, first.type);
            setOpen(false);
            setSearch('');
          }
        }}
      />
      <button
        type="button"
        aria-expanded={open}
        title={_('Add Live Path Effect')}
        onClick={() => setOpen(!open)}
      >
        +
      </button>
      {open && (
        <div className="lpe-gallery" role="listbox">
          {lpes.map((lpe) => {
            const header = lpe.category !== category;
            category = lpe.category;
            return (
              <div key={lpe.type} className="lpe-gallery-group">
                {header && <div className="lpe-category">{LPE.get_category_name(lpe.category)}</div>}
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  className="lpe-gallery-item"
                  disabled={!lpe.sensitive}
                  title={lpe.tooltip}
                  onClick={() => {
                    LPE.onAdd(desktop, item, lpe.type);
                    setOpen(false);
                    setSearch('');
                  }}
                >
                  <Icon name={lpe.icon_name} />
                  <span>{lpe.label}</span>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * The Path Effects dialog (dialog key "LivePathEffect"): the effects of the selected item, top
 * of the stack last, with the parameters of the current one; a gallery to add effects.
 * TODO: drag and drop to reorder, favorites, experimental effects, set/forget defaults.
 */
export function LivePathEffectDialog() {
  const desktop = useActiveDesktop();
  useReprVersion(desktop?.doc.rroot ?? null);
  useSelectionVersion(desktop);
  // The current effect is not stored in the document: re-render when it changes.
  const [, setCurrentVersion] = useState(0);
  if (!desktop) return null;
  const state = LPE.lpeEditorState(desktop);
  const item = state.item;
  return (
    <div className="lpe-dialog">
      {state.info && <div className="lpe-info">{state.info}</div>}
      {state.convert_label && (
        <button type="button" onClick={() => LPE.convertToPaths(desktop)}>
          {state.convert_label}
        </button>
      )}
      {item && (
        <>
          <div className="lpe-current-item">{item.label() ?? item.getId()}</div>
          <div className="lpe-list">
            {state.rows.map((row) => (
              <div key={objectKey(row.lperef)} className={`lpe-row${row.current ? ' current' : ''}`}>
                <div className="lpe-row-header">
                  <button
                    type="button"
                    className="lpe-row-label"
                    aria-expanded={row.current}
                    onClick={() => {
                      LPE.setCurrent(desktop, item, row.lperef);
                      setCurrentVersion((v) => v + 1);
                    }}
                  >
                    <Icon name={row.icon_name} />
                    <span>{row.label}</span>
                  </button>
                  {row.effect && (
                    <button
                      type="button"
                      title={_('Show/hide this Live Path Effect')}
                      aria-pressed={!row.visible}
                      onClick={() => {
                        if (row.effect) LPE.toggleVisible(desktop, item, row.effect);
                      }}
                    >
                      <Icon name={row.visible ? 'object-visible' : 'object-hidden'} />
                    </button>
                  )}
                  <button
                    type="button"
                    title={_('Move Up')}
                    disabled={row.is_first}
                    onClick={() => {
                      LPE.do_item_action_undoable(desktop, item, row.lperef, 'move-up');
                    }}
                  >
                    <Icon name="go-up" />
                  </button>
                  <button
                    type="button"
                    title={_('Move Down')}
                    disabled={row.is_last}
                    onClick={() => {
                      LPE.do_item_action_undoable(desktop, item, row.lperef, 'move-down');
                    }}
                  >
                    <Icon name="go-down" />
                  </button>
                  <button
                    type="button"
                    title={_('Duplicate')}
                    onClick={() => {
                      LPE.do_item_action_undoable(desktop, item, row.lperef, 'duplicate');
                    }}
                  >
                    <Icon name="edit-duplicate" />
                  </button>
                  <button
                    type="button"
                    title={_('Flatten')}
                    onClick={() => {
                      LPE.lpeFlatten(desktop, item, row.lperef);
                    }}
                  >
                    <Icon name="object-to-path" />
                  </button>
                  <button
                    type="button"
                    title={_('Remove this Live Path Effect')}
                    onClick={() => {
                      LPE.removeEffect(desktop, item, row.lperef);
                    }}
                  >
                    <Icon name="list-remove" />
                  </button>
                </div>
                {row.current && row.effect && (
                  <EffectParams desktop={desktop} item={item} effect={row.effect} />
                )}
              </div>
            ))}
          </div>
          <AddEffect desktop={desktop} item={item} />
        </>
      )}
    </div>
  );
}
