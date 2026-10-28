// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/widget/preferences-widget.cpp, src/ui/widget/preferences-widget.h
/*
 * Widgets that show and set one preference.
 *
 * Authors:
 *   Marco Scholten
 *   Bruno Dilly <bruno.dilly@gmail.com>
 *   Carl Hetherington <inkscape@carlh.net>
 *
 * Copyright (C) 2004-2011 Authors
 */
import { Preferences } from '@inkscape-web/core';
import { type ReactNode, useId, useState, useSyncExternalStore } from 'react';

/** The value of the preference at path as a string; def if it is not set. Updates when it changes. */
export function usePref(path: string, def: string): string {
  const prefs = Preferences.get();
  return useSyncExternalStore(
    (cb) =>
      prefs.changedSignal.connect((changed) => {
        if (changed === path) cb();
      }),
    () => prefs.getString(path, def),
  );
}

/** A line of a preferences page: label, widget, suffix (upstream DialogPage::add_line). */
export function PrefRow(props: {
  label?: string | undefined;
  suffix?: string | undefined;
  tip?: string | undefined;
  /** Indent below a group header. */
  indent?: boolean | undefined;
  children: ReactNode;
}) {
  return (
    <div className={`pref-row${props.indent ? ' indent' : ''}`} title={props.tip}>
      <span className="pref-label">{props.label}</span>
      <span className="pref-widget">{props.children}</span>
      {props.suffix && <span className="pref-suffix">{props.suffix}</span>}
    </div>
  );
}

/** A group header of a page (upstream DialogPage::add_group_header). */
export function PrefHeader({ text }: { text: string }) {
  return <h4 className="pref-header">{text}</h4>;
}

/** A checkbox for a boolean preference (upstream PrefCheckButton). */
export function PrefCheckButton(props: {
  label: string;
  path: string;
  def: boolean;
  tip?: string;
  indent?: boolean;
}) {
  const prefs = Preferences.get();
  const checked = usePref(props.path, props.def ? '1' : '0');
  return (
    <PrefRow tip={props.tip} indent={props.indent}>
      <label>
        <input
          type="checkbox"
          checked={checked === '1' || checked === 'true'}
          onChange={(e) => prefs.setBool(props.path, e.target.checked)}
        />
        {props.label}
      </label>
    </PrefRow>
  );
}

/** One option of a PrefRadioGroup. */
export interface PrefOption {
  label: string;
  /** The value that the preference gets. */
  value: string | number;
  tip?: string;
}

/** Radio buttons for the values of one preference (upstream PrefRadioButton, one per option). */
export function PrefRadioGroup(props: {
  path: string;
  def: string | number;
  options: readonly PrefOption[];
}) {
  const prefs = Preferences.get();
  const name = useId();
  const current = usePref(props.path, String(props.def));
  return (
    <>
      {props.options.map((o) => (
        <PrefRow key={o.value} tip={o.tip} indent>
          <label>
            <input
              type="radio"
              name={name}
              checked={current === String(o.value)}
              onChange={() => prefs.setString(props.path, String(o.value))}
            />
            {o.label}
          </label>
        </PrefRow>
      ))}
    </>
  );
}

/** How a number maps to the stored preference value. */
export interface PrefNumberFormat {
  /** The number that the user sees for the stored value. Default: the value. */
  toDisplay?: (stored: number) => number;
  /** The stored value for the number that the user typed. Default: the number. */
  fromDisplay?: (shown: number) => number;
  /** Text written after the number in the stored value, e.g. "px" for "2px". */
  storedSuffix?: string;
}

/**
 * A number field for a numeric preference (upstream PrefSpinButton). The value
 * is applied when it is a number within the range; Escape or leaving the field
 * shows the stored value again.
 */
export function PrefSpinButton(
  props: {
    path: string;
    min: number;
    max: number;
    step: number;
    def: number;
    /** Digits after the decimal point that are shown. */
    digits?: number;
    /** Store whole numbers. */
    integer?: boolean;
    label?: string;
    suffix?: string;
    tip?: string;
    indent?: boolean;
  } & PrefNumberFormat,
) {
  const { path, min, max, step, def, digits = 0, toDisplay = (v) => v, fromDisplay = (v) => v } = props;
  const prefs = Preferences.get();
  const stored = Number.parseFloat(usePref(path, String(def)));
  const shown = String(Number(toDisplay(Number.isNaN(stored) ? def : stored).toFixed(digits)));
  const [text, setText] = useState<string | null>(null);
  return (
    <PrefRow label={props.label} suffix={props.suffix} tip={props.tip} indent={props.indent}>
      <input
        type="number"
        className="pref-number"
        min={min}
        max={max}
        step={step}
        value={text ?? shown}
        onChange={(e) => {
          setText(e.target.value);
          const v = Number.parseFloat(e.target.value);
          if (Number.isNaN(v) || v < min || v > max) return;
          const value = fromDisplay(v);
          prefs.setString(path, `${props.integer ? Math.round(value) : value}${props.storedSuffix ?? ''}`);
        }}
        onBlur={() => setText(null)}
      />
    </PrefRow>
  );
}

/** A drop-down list for the values of one preference (upstream PrefCombo). */
export function PrefCombo(props: {
  path: string;
  def: string | number;
  options: readonly { label: string; value: string | number }[];
  label?: string;
  tip?: string;
  /** Called after the user picked a value. */
  onChange?: (value: string) => void;
}) {
  const prefs = Preferences.get();
  const current = usePref(props.path, String(props.def));
  return (
    <PrefRow label={props.label} tip={props.tip}>
      <select
        value={current}
        onChange={(e) => {
          // An empty value is "not set": the default applies.
          if (e.target.value === '') prefs.remove(props.path);
          else prefs.setString(props.path, e.target.value);
          props.onChange?.(e.target.value);
        }}
      >
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </PrefRow>
  );
}
