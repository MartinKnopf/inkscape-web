// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/guides.cpp, src/ui/dialog/guides.h
/*
 * Simple guideline dialog.
 *
 * Authors:
 *   Lauris Kaplinski <lawrence@kaplinski.com>
 *   Andrius R. <knutux@gmail.com>
 *   Johan Engelen
 *   Abhishek Sharma
 *
 * Copyright (C) 1999-2007 Authors
 */
import { _, C_, convertUnit, formatNumber, type SPGuide } from '@inkscape-web/core';
import {
  type GuidelineProperties,
  guideline_properties,
  guideline_properties_delete,
  guideline_properties_duplicate,
  guideline_properties_ok,
  signal_guide_dialog,
} from '@inkscape-web/editor';
import { useEffect, useState } from 'react';

/** The text of a mnemonic label without the marker. */
const label = (s: string) => s.replace('_', '');

/**
 * The guideline dialog (upstream GuidelinePropertiesDialog), opened by a
 * double click on a guide: position in the display unit, angle in degrees,
 * label, locked, relative change; OK, Duplicate, Delete, Cancel.
 * TODO: the color, the unit menus.
 */
function GuidelineDialog({ guide, onClose }: { guide: SPGuide; onClose: () => void }) {
  const unit = guide.document.getNamedView().getDisplayUnit();
  const toUnit = (px: number) => convertUnit(px, 'px', unit);
  const toPx = (v: number) => convertUnit(v, unit, 'px');
  const initial = guideline_properties(guide);
  const [relative, setRelative] = useState(false);
  const [x, setX] = useState(formatNumber(toUnit(initial.x), 3));
  const [y, setY] = useState(formatNumber(toUnit(initial.y), 3));
  const [angle, setAngle] = useState(formatNumber(initial.angle, 3));
  const [text, setText] = useState(initial.label);
  const [locked, setLocked] = useState(initial.locked);

  const values = (): GuidelineProperties => ({
    x: toPx(Number.parseFloat(x) || 0),
    y: toPx(Number.parseFloat(y) || 0),
    angle: Number.parseFloat(angle) || 0,
    label: text,
    locked,
  });
  const changeMode = (rel: boolean) => {
    // relative: start from zero; absolute: the current values
    setRelative(rel);
    setX(rel ? '0' : formatNumber(toUnit(initial.x), 3));
    setY(rel ? '0' : formatNumber(toUnit(initial.y), 3));
    setAngle(rel ? '0' : formatNumber(initial.angle, 3));
  };
  const close = (f?: () => void) => {
    f?.();
    onClose();
  };

  return (
    <div className="guide-dialog-backdrop">
      <form
        className="guide-dialog"
        role="dialog"
        aria-label={_('Guideline')}
        onSubmit={(e) => {
          e.preventDefault();
          close(() => guideline_properties_ok(guide, values(), relative));
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close();
        }}
      >
        <h3>{_('Guideline')}</h3>
        <div className="guide-dialog-info">{_('Guideline ID: %s').replace('%s', guide.getId() ?? '')}</div>
        <div className="guide-dialog-info">{_('Current: %s').replace('%s', guide.description(false))}</div>
        <label>
          <span>{label(_('_Label:'))}</span>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            title={_('Optionally give this guideline a name')}
          />
        </label>
        <label>
          <span>{label(C_('Guides', '_X:'))}</span>
          <input value={x} onChange={(e) => setX(e.target.value)} inputMode="decimal" />
          <span>{unit}</span>
        </label>
        <label>
          <span>{label(C_('Guides', '_Y:'))}</span>
          <input value={y} onChange={(e) => setY(e.target.value)} inputMode="decimal" />
          <span>{unit}</span>
        </label>
        <label>
          <span>{label(_('_Angle:'))}</span>
          <input value={angle} onChange={(e) => setAngle(e.target.value)} inputMode="decimal" />
          <span>°</span>
        </label>
        <label title={_('Lock the movement of guides')}>
          <input type="checkbox" checked={locked} onChange={(e) => setLocked(e.target.checked)} />
          <span>{label(_('Lo_cked'))}</span>
        </label>
        <label title={_('Move and/or rotate the guide relative to current settings')}>
          <input type="checkbox" checked={relative} onChange={(e) => changeMode(e.target.checked)} />
          <span>{label(_('Rela_tive change'))}</span>
        </label>
        <div className="guide-dialog-buttons">
          <button type="submit">{label(_('_OK'))}</button>
          <button
            type="button"
            onClick={() => close(() => guideline_properties_duplicate(guide, values(), relative))}
          >
            {label(_('_Duplicate'))}
          </button>
          <button type="button" onClick={() => close(() => guideline_properties_delete(guide))}>
            {label(_('_Delete'))}
          </button>
          <button type="button" onClick={() => close()}>
            {label(_('_Cancel'))}
          </button>
        </div>
      </form>
    </div>
  );
}

/** Shows the guideline dialog when a guide is double-clicked (signal_guide_dialog). */
export function GuidelineDialogHost() {
  const [guide, setGuide] = useState<SPGuide | null>(null);
  useEffect(() => signal_guide_dialog.connect((g) => setGuide(g)), []);
  if (!guide) return null;
  return <GuidelineDialog key={guide.getId() ?? ''} guide={guide} onClose={() => setGuide(null)} />;
}
