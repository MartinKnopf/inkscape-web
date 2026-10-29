// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/symbols.cpp, src/ui/dialog/symbols.h, share/ui/dialog-symbols.glade
/*
 * Authors:
 *   Tavmjong Bah, Martin Owens
 *
 * Copyright (C) 2012 Tavmjong Bah
 *               2013 Martin Owens
 *               2017 Jabiertxo Arraiza
 */
import { _, SPDocument, type SPSymbol } from '@inkscape-web/core';
import {
  ALL_SETS_ID,
  CURRENT_DOC_ID,
  collectSymbols,
  insertSymbolInDocument,
  revertSymbol,
  type SymbolItem,
  symbolItem,
  symbolMatches,
  symbolPreviewSvg,
  symbolSetTitle,
  symbolToClipboard,
} from '@inkscape-web/editor';
import { Rect } from '@inkscape-web/geom';
import { useEffect, useMemo, useState } from 'react';
import { useActiveDesktop } from '../../app/active-desktop.ts';
import { useReprVersion } from './use-repr.ts';

interface SymbolSet {
  id: string;
  title: string;
  document: SPDocument;
}

let setFiles: Promise<string[]> | null = null;
const loadedSets = new Map<string, Promise<SymbolSet | null>>();

/** The symbol set files of share/symbols. */
function symbolSetFiles(): Promise<string[]> {
  setFiles ??= fetch('/share/symbols/index.json').then((r) => r.json());
  return setFiles;
}

/** Load a symbol set once (upstream load_symbol_set). */
function loadSymbolSet(file: string): Promise<SymbolSet | null> {
  let p = loadedSets.get(file);
  if (!p) {
    p = fetch(`/share/symbols/${file}`)
      .then((r) => r.text())
      .then((text) => {
        const document = SPDocument.createNewDocFromMem(text);
        if (!document) return null;
        document.ensureUpToDate();
        return { id: file, title: symbolSetTitle(document, file), document };
      })
      .catch(() => null);
    loadedSets.set(file, p);
  }
  return p;
}

function setItems(set: SymbolSet): SymbolItem[] {
  return collectSymbols(set.document.getRoot()).map((s) => symbolItem(s, set.title, set.document));
}

/** The preview of a symbol, as an image so that the symbol cannot touch the page. */
function previewUrl(symbol: SPSymbol): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(symbolPreviewSvg(symbol))}`;
}

/** The Symbols dialog (dialog key "Symbols"): symbol sets and the symbols of the document. */
export function SymbolsDialog() {
  const desktop = useActiveDesktop();
  const [files, setFiles] = useState<string[]>([]);
  const [sets, setSets] = useState<SymbolSet[]>([]);
  const [setId, setSetId] = useState(CURRENT_DOC_ID);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const docVersion = useReprVersion(setId === CURRENT_DOC_ID ? (desktop?.doc.rroot ?? null) : null);

  useEffect(() => {
    void symbolSetFiles().then(setFiles);
  }, []);
  useEffect(() => {
    // The sets load when they are shown; all of them for "All symbol sets".
    const wanted = setId === ALL_SETS_ID ? files : files.filter((f) => f === setId);
    let cancelled = false;
    void Promise.all(wanted.map(loadSymbolSet)).then((loaded) => {
      if (!cancelled) setSets(loaded.filter((s): s is SymbolSet => s !== null));
    });
    return () => {
      cancelled = true;
    };
  }, [setId, files]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: docVersion marks changes of the symbols of the document
  const items = useMemo(() => {
    if (!desktop) return [];
    if (setId === CURRENT_DOC_ID) {
      return collectSymbols(desktop.doc.getRoot()).map((s) => symbolItem(s, _('Current document'), null));
    }
    return sets.flatMap(setItems);
  }, [desktop, setId, sets, docVersion]);
  const shown = items.filter((i) => symbolMatches(i, search));
  const current = items.find((i) => i.uniqueKey === selected) ?? null;
  const symbolOf = (item: SymbolItem): SPSymbol | null => {
    const doc = item.document ?? desktop?.doc;
    const o = doc?.getObjectById(item.symbolId);
    return o && collectSymbols(o)[0] === o ? (o as SPSymbol) : null;
  };

  if (!desktop) return null;
  const fromCurrent = setId === CURRENT_DOC_ID;
  return (
    <div className="swatches-dialog">
      <div className="swatches-header">
        <select aria-label={_('Symbol set')} value={setId} onChange={(e) => setSetId(e.target.value)}>
          <option value={CURRENT_DOC_ID}>{_('Current document')}</option>
          <option value={ALL_SETS_ID}>{_('All symbol sets')}</option>
          {files.map((f) => (
            <option key={f} value={f}>
              {sets.find((s) => s.id === f)?.title ?? f.replace(/\.svg$/, '')}
            </option>
          ))}
        </select>
        <input
          type="search"
          aria-label={_('Search for symbol')}
          placeholder={_('Search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="swatches-content symbols-grid">
        {shown.map((item) => {
          const symbol = symbolOf(item);
          return (
            <button
              key={item.uniqueKey}
              type="button"
              className="symbol-item"
              aria-pressed={item.uniqueKey === selected}
              title={item.symbolTitle}
              onClick={() => setSelected(item.uniqueKey)}
              onDoubleClick={() => void insertSymbolInDocument(desktop, item)}
            >
              {symbol && <img src={previewUrl(symbol)} alt="" width={48} height={48} />}
              <small>{item.label}</small>
            </button>
          );
        })}
        {shown.length === 0 && (
          <p>
            <b>{_('No symbols found.')}</b>
            <br />
            <small>
              {search
                ? _('Try a different search term,\nor switch to a different symbol set.')
                : fromCurrent
                  ? _('No symbols in current document.\nChoose a different symbol set\nor add a new symbol.')
                  : ''}
            </small>
          </p>
        )}
      </div>
      <div className="swatches-header">
        <small>{`${_('Symbols')}: ${shown.length === items.length ? items.length : `${shown.length} / ${items.length}`}`}</small>
        <button
          type="button"
          disabled={!current}
          title={_('Copy selected symbol onto clipboard')}
          onClick={() => {
            if (!current) return;
            const half = current.dimensions.mul(0.5);
            void symbolToClipboard(desktop, current, new Rect(half.neg(), half), true);
          }}
        >
          {_('Copy')}
        </button>
        <button
          type="button"
          disabled={!fromCurrent}
          title={_('Convert selected object(s) to symbol')}
          onClick={() => desktop.getSelection().toSymbol()}
        >
          +
        </button>
        <button
          type="button"
          disabled={!fromCurrent || !current}
          title={_(
            'Convert selected symbol to object, and all symbols of this type to clones of this object',
          )}
          onClick={() => current && revertSymbol(desktop, current)}
        >
          −
        </button>
        <button
          type="button"
          disabled={!current}
          onClick={() => current && void insertSymbolInDocument(desktop, current)}
        >
          {_('Insert')}
        </button>
      </div>
    </div>
  );
}
