// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/text-edit.cpp, src/ui/dialog/text-edit.h, share/ui/dialog-text-edit.glade
/*
 * Text editing dialog.
 *
 * Authors:
 *   Lauris Kaplinski <lauris@ximian.com>
 *   bulia byak <buliabyak@users.sf.net>
 *   Johan Engelen <goejendaagh@zonnet.nl>
 *   Abhishek Sharma
 *   John Smith
 *   Tavmjong Bah
 *
 * Copyright (C) 1999-2013 Authors
 * Copyright (C) 2000-2001 Ximian, Inc.
 */
import { _, Preferences } from '@inkscape-web/core';
import {
  FontLister,
  fillTextStyle,
  getSelectedTextCount,
  getSelectedTextItem,
  onApply,
  onReadSelection,
  onSetDefault,
  type SPDesktop,
  type TextEditFont,
} from '@inkscape-web/editor';
import { useEffect, useReducer, useState } from 'react';
import { useActiveDesktop } from '../../app/active-desktop.ts';
import { useReprVersion, useSelectionVersion } from './use-repr.ts';

/**
 * The Text and Font dialog (dialog key "Text"): the font family, style and
 * size with a preview, and the text of the selected text; Apply sets them,
 * Set as default makes the font the style of new text.
 * TODO: the font features and variations tabs, font collections, the font
 * list filter, spell checking.
 */
export function TextEditDialog() {
  const desktop = useActiveDesktop();
  if (!desktop) return null;
  return <TextEdit desktop={desktop} />;
}

function TextEdit({ desktop }: { desktop: SPDesktop }) {
  const selectionVersion = useSelectionVersion(desktop);
  const reprVersion = useReprVersion(desktop.doc.rroot);
  const [, update] = useReducer((n: number) => n + 1, 0);
  const lister = FontLister.get_instance();
  useEffect(() => lister.changedSignal.connect(update), [lister]);
  const [tab, setTab] = useState<'font' | 'text'>('font');
  const [font, setFont] = useState<TextEditFont>(() => onReadSelection(desktop).font);
  const [text, setText] = useState<string | null>(() => onReadSelection(desktop).text);
  const [dirty, setDirty] = useState(false);

  // Read the selection when it (or the document) changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the versions trigger the update
  useEffect(() => {
    const read = onReadSelection(desktop);
    setFont(read.font);
    setText(read.text);
    setDirty(false);
    lister.add_document_fonts_at_top(desktop.getDocument());
  }, [desktop, selectionVersion, reprVersion, lister]);

  const change = (f: Partial<TextEditFont>) => {
    setFont((old) => ({ ...old, ...f }));
    setDirty(true);
  };
  const has_text = !!getSelectedTextItem(desktop);
  const sample = Preferences.get().getString('/tools/text/font_sample', 'AaBbCcIiPpQq12369$€¢?.;/()');
  const preview_css = fillTextStyle(font);
  const preview = Object.fromEntries(
    ['font-family', 'font-weight', 'font-style', 'font-stretch', 'font-variant'].map((k) => [
      k.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase()),
      preview_css.attribute(k) ?? undefined,
    ]),
  );
  const unit = ['', 'px', 'pt', 'pc', 'mm', 'cm', 'in'][
    Preferences.get().getInt('/options/font/unitType', 2)
  ];

  return (
    <div className="docprops-tabs text-edit-dialog">
      <div className="docprops-tabbar" role="tablist">
        {(
          [
            ['font', _('_Font').replace('_', '')],
            ['text', _('_Text').replace('_', '')],
          ] as const
        ).map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'font' ? (
        <div className="text-edit-font">
          <select
            className="text-edit-families"
            size={10}
            aria-label={_('Font family')}
            value={font.family}
            onFocus={() => void lister.loadLocalFonts()}
            onChange={(e) => change({ family: e.target.value })}
          >
            {[...new Set([font.family, ...lister.families()])].map((f) => (
              <option key={f} value={f} style={{ fontFamily: f }}>
                {f}
              </option>
            ))}
          </select>
          <div className="text-edit-row">
            <select
              aria-label={_('Font style')}
              value={font.style}
              onChange={(e) => change({ style: e.target.value })}
            >
              {[...new Set([font.style, ...lister.styles(font.family)])].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <label>
              {_('Font size')}{' '}
              <input
                type="number"
                min={0.1}
                step={1}
                value={Number(font.size.toFixed(3))}
                onChange={(e) => {
                  const v = Number.parseFloat(e.target.value);
                  if (v > 0) change({ size: v });
                }}
              />{' '}
              {unit}
            </label>
          </div>
          <div
            className="text-edit-preview"
            style={{ ...preview, fontSize: `${Math.min(font.size * 1.33, 48)}px` }}
          >
            {text?.split('\n')[0] || sample}
          </div>
        </div>
      ) : (
        <textarea
          className="text-edit-text"
          aria-label={_('Text')}
          disabled={getSelectedTextCount(desktop) !== 1}
          value={text ?? ''}
          onChange={(e) => {
            setText(e.target.value);
            setDirty(true);
          }}
        />
      )}
      <div className="dialog-toolbar text-edit-buttons">
        <button type="button" disabled={!has_text} onClick={() => onSetDefault(font)}>
          {_('Set as _default').replace('_', '')}
        </button>
        <button
          type="button"
          disabled={!dirty}
          onClick={() => {
            onApply(desktop, font, text);
            setDirty(false);
          }}
        >
          {_('_Apply').replace('_', '')}
        </button>
      </div>
    </div>
  );
}
