// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/widget/font-list.cpp, src/ui/widget/font-list.h, share/ui/font-list.glade
/*
 * Authors:
 *   Michael Kowalski
 *
 * Copyright (C) 2024 Authors
 */
import { _, C_, Preferences } from '@inkscape-web/core';
import { FontLister } from '@inkscape-web/editor';
import { useEffect, useReducer, useState } from 'react';
import { openDialog } from '../dialog/dialog-manager.ts';
import { FontCollectionSelector, fontCountLabel, useFontCollections } from './font-collection-selector.tsx';

/** The sample texts of the preview (upstream font-list.glade, context "font-sample-text"). */
const SAMPLES = [
  C_('font-sample-text', 'AbcdEfgh1234'),
  C_('font-sample-text', '1234567890'),
  C_('font-sample-text', 'abcdefghijklmnopqrstuvwxyz'),
  C_('font-sample-text', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
  C_('font-sample-text', 'The quick brown fox jumps over the lazy dog.'),
  C_('font-sample-text', 'Yélløw ťüřtle fröm Áłphårettä íś čōmińġ fôr ďïññęr tòđây.'),
];

/**
 * The font list of the Font Browser (upstream FontList): the families with a
 * preview in each font, a search field, the font collections, list or grid
 * view and the preview size. Choosing a family calls onChange.
 */
export function FontList({
  family,
  onChange,
  prefs = '/font-selector',
}: {
  family: string;
  onChange: (family: string) => void;
  prefs?: string;
}) {
  const prefsObj = Preferences.get();
  const [, update] = useReducer((n: number) => n + 1, 0);
  const lister = FontLister.get_instance();
  useEffect(() => lister.changedSignal.connect(update), [lister]);
  useFontCollections();
  const [search, setSearch] = useState('');
  const [grid, setGrid] = useState(() => prefsObj.getBool(`${prefs}/show-grid`, false));
  const [size, setSize] = useState(() => prefsObj.getInt(`${prefs}/preview-size`, 24));
  const [sample, setSample] = useState(() => prefsObj.getString(`${prefs}/sample`, SAMPLES[0]!));
  const [showName, setShowName] = useState(() => prefsObj.getBool(`${prefs}/show-font-name`, true));

  const all = lister.all_families();
  const listed = lister.families();
  const families = listed.filter((f) => !search || f.toLowerCase().includes(search.toLowerCase()));
  const store = (key: string, v: string | number | boolean) => {
    if (typeof v === 'boolean') prefsObj.setBool(`${prefs}/${key}`, v);
    else if (typeof v === 'number') prefsObj.setInt(`${prefs}/${key}`, v);
    else prefsObj.setString(`${prefs}/${key}`, v);
  };

  return (
    <div className="font-list">
      <div className="text-edit-row">
        <input
          type="search"
          className="text-edit-search"
          placeholder={_('Search fonts')}
          aria-label={_('Search fonts')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <details className="font-list-popover">
          <summary title={_('Font collections')}>{_('Collections')}</summary>
          <FontCollectionSelector onEdit={() => openDialog('FontCollections')} />
        </details>
        <button
          type="button"
          aria-pressed={!grid}
          title={_('Show fonts in a list')}
          onClick={() => {
            setGrid(false);
            store('show-grid', false);
          }}
        >
          ☰
        </button>
        <button
          type="button"
          aria-pressed={grid}
          title={_('Show fonts in a grid')}
          onClick={() => {
            setGrid(true);
            store('show-grid', true);
          }}
        >
          ▦
        </button>
      </div>
      <div className="text-edit-row">
        <label title={_('Preview size')}>
          <input
            type="range"
            min={8}
            max={64}
            value={size}
            onChange={(e) => {
              setSize(Number(e.target.value));
              store('preview-size', Number(e.target.value));
            }}
          />
        </label>
        {!grid && (
          <select
            aria-label={_('Sample')}
            value={sample}
            onChange={(e) => {
              setSample(e.target.value);
              store('sample', e.target.value);
            }}
          >
            {SAMPLES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
        <label>
          <input
            type="checkbox"
            checked={showName}
            onChange={(e) => {
              setShowName(e.target.checked);
              store('show-font-name', e.target.checked);
            }}
          />{' '}
          {_('Show font name')}
        </label>
      </div>
      <div className={grid ? 'font-list-items font-list-grid' : 'font-list-items'} role="listbox">
        {families.map((f) => (
          <button
            key={f}
            type="button"
            role="option"
            aria-selected={f === family}
            title={f}
            className="font-list-item"
            onClick={() => onChange(f)}
          >
            {showName && !grid && <span className="font-list-name">{f}</span>}
            <span style={{ fontFamily: `'${f}'`, fontSize: `${size}px` }}>
              {grid ? C_('font-sample-text', 'Aa') : sample}
            </span>
            {showName && grid && <span className="font-list-name">{f}</span>}
          </button>
        ))}
      </div>
      <div className="font-list-count">{fontCountLabel(families.length, all.length)}</div>
    </div>
  );
}
