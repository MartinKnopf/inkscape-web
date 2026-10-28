// SPDX-License-Identifier: GPL-2.0-or-later
// The number entry of the dialogs (upstream: Inkscape::UI::Widget::Scalar, InkSpinButton).
import { formatNumber } from '@inkscape-web/core';
import { useState } from 'react';

/** A number field that commits on Enter or blur; Enter also applies (upstream: the spin buttons activate Apply). */
export function NumberField(props: {
  label: string;
  tooltip?: string;
  value: number;
  onCommit: (value: number) => void;
  onEnter?: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = formatNumber(props.value, 3);
  const finish = () => {
    const value = Number.parseFloat(draft ?? '');
    setDraft(null);
    if (draft !== null && Number.isFinite(value)) props.onCommit(value);
  };
  return (
    <input
      className="docprops-number"
      aria-label={props.label}
      title={props.tooltip}
      value={draft ?? shown}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={finish}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          finish();
          props.onEnter?.();
        } else if (e.key === 'Escape') setDraft(null);
      }}
    />
  );
}
