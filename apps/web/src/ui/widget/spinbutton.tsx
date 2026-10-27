// SPDX-License-Identifier: GPL-2.0-or-later
// A labeled number field for toolbars (the web version of upstream's InkSpinButton).
import { useEffect, useState } from 'react';

interface SpinButtonProps {
  label: string;
  tooltip: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** Digits after the decimal point that are shown. */
  digits: number;
  suffix?: string;
  disabled?: boolean;
  /** Called with the new value, clamped to [min, max]. */
  onChange: (value: number) => void;
}

/**
 * A number field. Typed text is applied on Enter or when the field loses the
 * focus; the arrow keys and the field's step buttons apply at once. Enter and
 * Escape leave the field (upstream: the defocus target).
 */
export function SpinButton(props: SpinButtonProps) {
  const { label, tooltip, value, min, max, step, digits, suffix, disabled, onChange } = props;
  const shown = format(value, digits);
  const [text, setText] = useState(shown);
  // Show changes from outside (selection, undo) unless the user is typing.
  useEffect(() => setText(shown), [shown]);

  const commit = (s: string) => {
    const v = Number.parseFloat(s);
    if (Number.isNaN(v)) {
      setText(shown);
      return;
    }
    const clamped = Math.min(Math.max(v, min), max);
    setText(format(clamped, digits));
    if (clamped !== value) onChange(clamped);
  };

  return (
    <label className="spinbutton" title={tooltip}>
      <span className="spinbutton-label">{label}</span>
      <input
        type="number"
        value={text}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value);
          // The step buttons and arrow keys give no input type; typing does.
          if (!(e.nativeEvent instanceof InputEvent && e.nativeEvent.inputType)) commit(e.target.value);
        }}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          // Enter applies, Escape reverts; both give the keyboard back to the canvas shortcuts.
          if (e.key === 'Enter') {
            commit(e.currentTarget.value);
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            // Reset the field before the blur, which applies the field's text.
            e.currentTarget.value = shown;
            setText(shown);
            e.currentTarget.blur();
          }
        }}
      />
      {suffix && <span className="spinbutton-suffix">{suffix}</span>}
    </label>
  );
}

function format(v: number, digits: number): string {
  return String(Number(v.toFixed(digits)));
}
