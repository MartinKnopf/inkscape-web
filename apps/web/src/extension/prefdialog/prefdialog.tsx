// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/prefdialog/prefdialog.cpp, src/extension/prefdialog/widget-box.cpp, src/extension/prefdialog/widget-image.cpp, src/extension/prefdialog/widget-label.cpp, src/extension/prefdialog/widget-separator.cpp, src/extension/prefdialog/widget-spacer.cpp, src/extension/prefdialog/parameter-bool.cpp, src/extension/prefdialog/parameter-color.cpp, src/extension/prefdialog/parameter-float.cpp, src/extension/prefdialog/parameter-int.cpp, src/extension/prefdialog/parameter-notebook.cpp, src/extension/prefdialog/parameter-optiongroup.cpp, src/extension/prefdialog/parameter-path.cpp, src/extension/prefdialog/parameter-string.cpp, src/extension/execution-env.cpp
/*
 * Authors:
 *   Ted Gould <ted@gould.cx>
 *   Johan Engelen <johan@shouraizou.nl>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Christopher Brown <audiere@gmail.com>
 *   Patrick Storz <eduard.braun2@gmx.de>
 *
 * Copyright (C) 2005-2019 Authors
 */
// The parameter dialog of the extensions (the get_widget() of the widgets of upstream) and the
// "working" message of a running extension.
import { _, Colors, Signal } from '@inkscape-web/core';
import {
  Effect,
  type InxWidget,
  LabelMode,
  ParamBool,
  ParamColor,
  ParamDescription,
  ParamFloat,
  ParamInt,
  ParamNotebook,
  ParamOptionGroup,
  ParamPath,
  ParamString,
  type PrefDialog,
  WidgetBox,
  WidgetImage,
  WidgetLabel,
  WidgetSeparator,
  WidgetSpacer,
} from '@inkscape-web/editor';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { SpinButton } from '../../ui/widget/spinbutton.tsx';
import './prefdialog.css';

const dialogs: PrefDialog[] = [];
let working: string | null = null;
const changed = new Signal<[]>();
let version = 0;
const bump = () => {
  version++;
  changed.emit();
};

/** Show a dialog of an effect (Effect.show_pref_dialog). */
Effect.show_pref_dialog = (dialog) => {
  if (!dialogs.includes(dialog)) dialogs.push(dialog);
  bump();
};

/** Show or hide the "Running '...'" message (upstream ExecutionEnv::createWorkingDialog). */
export function setWorking(text: string | null): void {
  working = text || null;
  bump();
}

/** A GTK label without the mnemonic marker. */
const label = (s: string | null) => (s ?? '').replace('_', '');

/** The widget of an InxWidget; onChange is called after a parameter changed (upstream get_widget). */
function Widget({ widget, onChange }: { widget: InxWidget; onChange: () => void }) {
  if (widget.get_hidden()) return null;
  const style = { marginLeft: widget.get_indent() * 12 };
  const tip = widget.get_tooltip() ?? undefined;
  const children = (list: readonly InxWidget[]) =>
    list.map((child, i) => (
      // biome-ignore lint/suspicious/noArrayIndexKey: the widgets of an extension are fixed
      <Widget key={i} widget={child} onChange={onChange} />
    ));

  if (widget instanceof WidgetBox) {
    return (
      <div className={`ext-box ext-${widget._orientation}`} style={style}>
        {children(widget._children)}
      </div>
    );
  }
  if (widget instanceof WidgetLabel || widget instanceof ParamDescription) {
    const l = widget instanceof ParamDescription ? widget.label : widget;
    if (l._mode === LabelMode.HEADER) return <h4 style={style}>{l._value}</h4>;
    if (l._mode === LabelMode.URL)
      return (
        <a style={style} href={l._value} target="_blank" rel="noreferrer">
          {l._value}
        </a>
      );
    return (
      <p className="ext-label" style={style}>
        {l._value}
      </p>
    );
  }
  if (widget instanceof WidgetSeparator) return <hr />;
  if (widget instanceof WidgetSpacer)
    return <div style={{ margin: widget._size / 2, flex: widget._expand ? 1 : undefined }} />;
  if (widget instanceof WidgetImage)
    return (
      <img
        style={style}
        src={widget._image_path}
        alt=""
        width={widget._width || undefined}
        height={widget._height || undefined}
      />
    );
  if (widget instanceof ParamBool) {
    return (
      <label className="ext-row" style={style} title={tip}>
        <input
          type="checkbox"
          checked={widget.get()}
          onChange={(e) => {
            widget.set_bool(e.target.checked);
            onChange();
          }}
        />
        {label(widget.get_text())}
      </label>
    );
  }
  if (widget instanceof ParamInt || widget instanceof ParamFloat) {
    const digits = widget instanceof ParamFloat ? widget._precision : 0;
    const step = digits ? 10 ** -digits : 1;
    const set = (v: number) => {
      if (widget instanceof ParamInt) widget.set_int(v);
      else widget.set_float(v);
      onChange();
    };
    return (
      <div className="ext-row ext-number" style={style} title={tip}>
        <span>{label(widget.get_text())}</span>
        {widget._full && (
          <input
            type="range"
            aria-label={label(widget.get_text())}
            min={widget._min}
            max={widget._max}
            step={step}
            value={widget.get()}
            onChange={(e) => set(Number(e.target.value))}
          />
        )}
        <SpinButton
          label=""
          tooltip={tip ?? ''}
          value={widget.get()}
          min={widget._min}
          max={widget._max}
          step={step}
          digits={digits}
          onChange={set}
        />
      </div>
    );
  }
  if (widget instanceof ParamString || widget instanceof ParamPath) {
    const set = (v: string) => {
      if (widget instanceof ParamString) widget.set_string(v);
      else widget.set_path(v);
      onChange();
    };
    const max = widget instanceof ParamString && widget._max_length ? widget._max_length : undefined;
    return (
      <div className="ext-row" style={style} title={tip}>
        <span>{label(widget.get_text())}</span>
        {widget instanceof ParamString && widget._multiline ? (
          <textarea
            aria-label={label(widget.get_text())}
            value={widget.get()}
            maxLength={max}
            onChange={(e) => set(e.target.value)}
          />
        ) : (
          <input
            aria-label={label(widget.get_text())}
            value={widget.get()}
            maxLength={max}
            onChange={(e) => set(e.target.value)}
          />
        )}
      </div>
    );
  }
  if (widget instanceof ParamOptionGroup) {
    const set = (v: string) => {
      widget.set_optiongroup(v);
      onChange();
    };
    if (widget._mode === 'combo')
      return (
        <label className="ext-row" style={style} title={tip}>
          <span>{label(widget.get_text())}</span>
          <select value={widget.get()} onChange={(e) => set(e.target.value)}>
            {widget.choices.map((c) => (
              <option key={c._value} value={c._value}>
                {c._text}
              </option>
            ))}
          </select>
        </label>
      );
    return (
      <fieldset className="ext-radio" style={style} title={tip}>
        <legend>{label(widget.get_text())}</legend>
        {widget.choices.map((c) => (
          <label key={c._value}>
            <input type="radio" checked={widget.get() === c._value} onChange={() => set(c._value)} />
            {c._text}
          </label>
        ))}
      </fieldset>
    );
  }
  if (widget instanceof ParamNotebook) {
    const pages = widget.pages();
    const current = pages.find((p) => p.name() === widget.get()) ?? pages[0];
    return (
      <div className="ext-notebook" style={style}>
        <div className="ext-tabs" role="tablist">
          {pages.map((p, i) => (
            <button
              key={p.name()}
              type="button"
              role="tab"
              aria-selected={p === current}
              onClick={() => {
                widget.set_page(i);
                onChange();
              }}
            >
              {label(p.get_text())}
            </button>
          ))}
        </div>
        <div className="ext-page">{current && children(current._children)}</div>
      </div>
    );
  }
  if (widget instanceof ParamColor) {
    const rgba = widget.get().toString(true);
    const set = (rgb: string, alpha: number) => {
      const a = Math.round(alpha * 255)
        .toString(16)
        .padStart(2, '0');
      const color = Colors.Color.parse(`${rgb}${a}`);
      if (color) widget.set_color(color);
      onChange();
    };
    const rgb = rgba.slice(0, 7);
    const alpha = Number.parseInt(rgba.slice(7, 9) || 'ff', 16) / 255;
    return (
      <div className="ext-row" style={style} title={tip}>
        <span>{label(widget.get_text())}</span>
        <input type="color" value={rgb} onChange={(e) => set(e.target.value, alpha)} />
        <input
          type="range"
          aria-label={_('Alpha')}
          min={0}
          max={1}
          step={0.01}
          value={alpha}
          onChange={(e) => set(rgb, Number(e.target.value))}
        />
      </div>
    );
  }
  return null;
}

/** The dialog of one effect (upstream PrefDialog). */
function EffectDialog({ dialog }: { dialog: PrefDialog }) {
  const [, setVersion] = useState(0);
  const [busy, setBusy] = useState(dialog.busy());
  useEffect(() => dialog.connect_changed(() => setBusy(dialog.busy())), [dialog]);
  const onChange = () => {
    setVersion((v) => v + 1);
    dialog.param_change();
  };
  const close = (ok: boolean) => {
    void dialog.on_response(ok).then(() => {
      if (!ok) {
        dialogs.splice(dialogs.indexOf(dialog), 1);
        bump();
      } else setVersion((v) => v + 1);
    });
  };
  const preview = dialog._param_preview;
  return (
    <div
      className="guide-dialog ext-dialog"
      role="dialog"
      aria-label={dialog._name}
      onKeyDown={(e) => {
        if (e.key === 'Escape') close(false);
      }}
    >
      <h3>{dialog._name}</h3>
      <div className="ext-widgets">
        {dialog._effect.get_widgets().map((w, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the widgets of an extension are fixed
          <Widget key={i} widget={w} onChange={onChange} />
        ))}
      </div>
      {preview && (
        <>
          <hr />
          <label className="ext-row" title={preview.get_tooltip() ?? undefined}>
            <input
              type="checkbox"
              checked={preview.get()}
              onChange={(e) => {
                void dialog.set_preview(e.target.checked);
                setVersion((v) => v + 1);
              }}
            />
            {preview.get_text()}
          </label>
        </>
      )}
      <div className="guide-dialog-buttons">
        {busy && <span className="ext-busy">{_('Working, please wait...')}</span>}
        <button type="button" onClick={() => close(false)}>
          {label(_('_Close'))}
        </button>
        <button type="button" onClick={() => close(true)}>
          {label(_('_Apply'))}
        </button>
      </div>
    </div>
  );
}

/** The open extension dialogs and the "working" message. Render once in the app. */
export function PrefDialogHost() {
  useSyncExternalStore(
    (cb) => changed.connect(cb),
    () => version,
  );
  return (
    <>
      {dialogs.map((d) => (
        <EffectDialog key={d._effect.get_id()} dialog={d} />
      ))}
      {working && (
        <div className="ext-working" role="status">
          {working}
        </div>
      )}
    </>
  );
}
