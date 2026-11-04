// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/text-edit.cpp, src/ui/dialog/text-edit.h, share/ui/dialog-text-edit.glade, src/ui/widget/font-variants.cpp, src/ui/widget/font-variations.cpp
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
import { _, C_, Preferences } from '@inkscape-web/core';
import {
  FontLister,
  type FontVariantsAvailable,
  type FontVariantsState,
  fillTextStyle,
  font_variants_available,
  font_variants_get_markup,
  getSelectedTextCount,
  getSelectedTextItem,
  onApply,
  onReadSelection,
  onSetDefault,
  type SPDesktop,
  type TextEditFont,
  textEditFace,
} from '@inkscape-web/editor';
import { type ReactNode, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useActiveDesktop } from '../../app/active-desktop.ts';
import { FontCollectionSelector } from '../widget/font-collection-selector.tsx';
import { FontList } from '../widget/font-list.tsx';
import { openDialog } from './dialog-manager.ts';
import { useReprVersion, useSelectionVersion } from './use-repr.ts';

/** Remove the mnemonic underscore of a label. */
const label = (s: string) => s.replace('_', '');

/**
 * The Text and Font dialog (dialog key "Text"): the font family, style and
 * size with a preview, the OpenType features and variation axes, and the
 * text of the selected text; Apply sets them, Set as default makes the font
 * the style of new text.
 * TODO: spell checking, East Asian features.
 */
export function TextEditDialog() {
  const desktop = useActiveDesktop();
  if (!desktop) return null;
  return <TextEdit desktop={desktop} browser={false} />;
}

/**
 * The Font Browser (dialog key "FontBrowser", upstream TextEdit with
 * use_browser): the font list with previews instead of the font selector;
 * a chosen font is applied at once.
 */
export function FontBrowserDialog() {
  const desktop = useActiveDesktop();
  if (!desktop) return null;
  return <TextEdit desktop={desktop} browser={true} />;
}

function TextEdit({ desktop, browser }: { desktop: SPDesktop; browser: boolean }) {
  const selectionVersion = useSelectionVersion(desktop);
  const reprVersion = useReprVersion(desktop.doc.rroot);
  const [listVersion, update] = useReducer((n: number) => n + 1, 0);
  const lister = FontLister.get_instance();
  useEffect(() => lister.changedSignal.connect(update), [lister]);
  const [tab, setTab] = useState<'font' | 'feat' | 'text'>('font');
  const [font, setFont] = useState<TextEditFont>(() => onReadSelection(desktop).font);
  const [text, setText] = useState<string | null>(() => onReadSelection(desktop).text);
  const [dirty, setDirty] = useState(false);
  const [search, setSearch] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

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
  const changeVariants = (v: Partial<FontVariantsState>) => change({ variants: { ...font.variants, ...v } });
  /** The font browser applies font changes at once (upstream apply_changes). */
  const changeFont = (f: Partial<TextEditFont>) => {
    if (!browser) {
      change(f);
      return;
    }
    const next = { ...font, ...f };
    setFont(next);
    onApply(desktop, next, null);
  };

  // The OpenType tables and the variation axes of the chosen face.
  // biome-ignore lint/correctness/useExhaustiveDependencies: listVersion: faces finished loading
  const available = useMemo(
    () => font_variants_available(textEditFace(font)),
    [font.family, font.style, listVersion],
  );

  const has_text = !!getSelectedTextItem(desktop);
  const sample = Preferences.get().getString('/tools/text/font_sample', 'AaBbCcIiPpQq12369$€¢?.;/()');
  const preview_css = fillTextStyle(font);
  const preview: React.CSSProperties = {
    ...Object.fromEntries(
      ['font-family', 'font-weight', 'font-style', 'font-stretch'].map((k) => [
        k.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase()),
        preview_css.attribute(k) ?? undefined,
      ]),
    ),
    fontFeatureSettings: font_variants_get_markup(font.variants) || undefined,
    fontVariationSettings: preview_css.attribute('font-variation-settings') ?? undefined,
    fontSize: `${Math.min(font.size * 1.33, 48)}px`,
  };
  const unit = ['', 'px', 'pt', 'pc', 'mm', 'cm', 'in'][
    Preferences.get().getInt('/options/font/unitType', 2)
  ];
  const families = [...new Set([font.family, ...lister.families()])].filter(
    (f) => !search || f.toLowerCase().includes(search.toLowerCase()) || f === font.family,
  );

  return (
    <div className="docprops-tabs text-edit-dialog">
      <div className="docprops-tabbar" role="tablist">
        {(
          [
            ['font', label(_('_Font'))],
            ['feat', label(_('_Features'))],
            ['text', label(_('_Text'))],
          ] as const
        ).map(([key, title]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>
            {title}
          </button>
        ))}
      </div>
      {tab === 'font' && (
        <div className="text-edit-font">
          {browser ? (
            <FontList family={font.family} onChange={(f) => changeFont({ family: f })} />
          ) : (
            <>
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
                  title={_('Fonts installed on this computer (Local Font Access)')}
                  onClick={() => void lister.loadLocalFonts()}
                >
                  {_('System fonts')}
                </button>
                <button
                  type="button"
                  title={_('Add the fonts of a font file')}
                  onClick={() => fileInput.current?.click()}
                >
                  {_('Add font file…')}
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  hidden
                  accept=".ttf,.otf,.ttc,.otc,font/ttf,font/otf,font/collection"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const added = await lister.addFontFile(new Uint8Array(await file.arrayBuffer()));
                    if (added[0]) change({ family: added[0], style: 'Normal' });
                  }}
                />
              </div>
              <select
                className="text-edit-families"
                size={10}
                aria-label={_('Font family')}
                value={font.family}
                onChange={(e) => change({ family: e.target.value })}
              >
                {families.map((f) => (
                  <option key={f} value={f} style={{ fontFamily: `'${f}'` }}>
                    {f}
                  </option>
                ))}
              </select>
            </>
          )}
          <div className="text-edit-row">
            <select
              aria-label={_('Font style')}
              value={font.style}
              onChange={(e) => changeFont({ style: e.target.value })}
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
                  if (v > 0) changeFont({ size: v });
                }}
              />{' '}
              {unit}
            </label>
          </div>
          {available.axes.map((axis) => (
            <label key={axis.tag} className="text-edit-row text-edit-axis">
              <span>{axis.name || axis.tag}</span>
              <input
                type="range"
                min={axis.minimum}
                max={axis.maximum}
                step={(axis.maximum - axis.minimum) / 100 || 1}
                value={font.variants.variations[axis.tag] ?? axis.def}
                onChange={(e) =>
                  changeVariants({
                    variations: { ...font.variants.variations, [axis.tag]: Number(e.target.value) },
                  })
                }
              />
              <span>{Number((font.variants.variations[axis.tag] ?? axis.def).toFixed(2))}</span>
            </label>
          ))}
          <div className="text-edit-preview" style={preview}>
            {text?.split('\n')[0] || sample}
          </div>
        </div>
      )}
      {tab === 'feat' && (
        <FontVariants
          variants={font.variants}
          available={available}
          onChange={changeVariants}
          preview={preview}
        />
      )}
      {tab === 'text' && (
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
      <div className="dialog-toolbar text-edit-buttons" hidden={browser && tab === 'font'}>
        <button type="button" disabled={!has_text} onClick={() => onSetDefault(font)}>
          {label(_('Set as _default'))}
        </button>
        <button
          type="button"
          disabled={!dirty}
          onClick={() => {
            onApply(desktop, font, text);
            setDirty(false);
          }}
        >
          {label(_('_Apply'))}
        </button>
      </div>
    </div>
  );
}

const F = (s: string) => C_('Font feature', s);

/** The OpenType features (upstream FontVariants widget). */
function FontVariants({
  variants,
  available,
  onChange,
  preview,
}: {
  variants: FontVariantsState;
  available: FontVariantsAvailable;
  onChange: (v: Partial<FontVariantsState>) => void;
  preview: React.CSSProperties;
}) {
  const check = (
    key: keyof FontVariantsState & keyof FontVariantsAvailable,
    text: string,
    tooltip: string,
  ) => (
    <label title={tooltip}>
      <input
        type="checkbox"
        disabled={!available[key]}
        checked={!!variants[key]}
        onChange={(e) => onChange({ [key]: e.target.checked })}
      />{' '}
      {text}
    </label>
  );
  function radio<K extends 'position' | 'caps' | 'numeric_style' | 'numeric_width' | 'numeric_fractions'>(
    key: K,
    value: FontVariantsState[K],
    text: string,
    tooltip: string,
    enabled = true,
  ): ReactNode {
    return (
      <label title={tooltip}>
        <input
          type="radio"
          name={key}
          disabled={!enabled}
          checked={variants[key] === value}
          onChange={() => onChange({ [key]: value } as Partial<FontVariantsState>)}
        />{' '}
        {text}
      </label>
    );
  }
  return (
    <div className="text-edit-features">
      <fieldset>
        <legend>{F('Ligatures')}</legend>
        {check(
          'ligatures_common',
          F('Common'),
          _("Common ligatures. On by default. OpenType tables: 'liga', 'clig'"),
        )}
        {check(
          'ligatures_discretionary',
          F('Discretionary'),
          _("Discretionary ligatures. Off by default. OpenType table: 'dlig'"),
        )}
        {check(
          'ligatures_historical',
          F('Historical'),
          _("Historical ligatures. Off by default. OpenType table: 'hlig'"),
        )}
        {check(
          'ligatures_contextual',
          F('Contextual'),
          _("Contextual forms. On by default. OpenType table: 'calt'"),
        )}
      </fieldset>
      <fieldset>
        <legend>{F('Position')}</legend>
        {radio('position', 'normal', F('Normal'), _('Normal position.'))}
        {radio(
          'position',
          'sub',
          F('Subscript'),
          _("Subscript. OpenType table: 'subs'"),
          available.position_sub,
        )}
        {radio(
          'position',
          'super',
          F('Superscript'),
          _("Superscript. OpenType table: 'sups'"),
          available.position_super,
        )}
      </fieldset>
      <fieldset>
        <legend>{F('Capitals')}</legend>
        {radio('caps', 'normal', F('Normal'), _('Normal capitalization.'))}
        {radio(
          'caps',
          'small',
          F('Small'),
          _("Small-caps (lowercase). OpenType table: 'smcp'"),
          available.caps_small,
        )}
        {radio(
          'caps',
          'all_small',
          F('All small'),
          _("All small-caps (uppercase and lowercase). OpenType tables: 'c2sc' and 'smcp'"),
          available.caps_all_small,
        )}
        {radio(
          'caps',
          'petite',
          F('Petite'),
          _("Petite-caps (lowercase). OpenType table: 'pcap'"),
          available.caps_petite,
        )}
        {radio(
          'caps',
          'all_petite',
          F('All petite'),
          _("All petite-caps (uppercase and lowercase). OpenType tables: 'c2sc' and 'pcap'"),
          available.caps_all_petite,
        )}
        {radio(
          'caps',
          'unicase',
          F('Unicase'),
          _("Unicase (small caps for uppercase, normal for lowercase). OpenType table: 'unic'"),
          available.caps_unicase,
        )}
        {radio(
          'caps',
          'titling',
          F('Titling'),
          _("Titling caps (lighter-weight uppercase for use in titles). OpenType table: 'titl'"),
          available.caps_titling,
        )}
      </fieldset>
      <fieldset>
        <legend>{F('Numeric')}</legend>
        <div>
          {radio('numeric_style', 'default', F('Default Style'), _('Normal style.'))}
          {radio(
            'numeric_style',
            'lining',
            F('Lining'),
            _("Lining numerals. OpenType table: 'lnum'"),
            available.numeric_lining,
          )}
          {radio(
            'numeric_style',
            'old_style',
            F('Old Style'),
            _("Old style numerals. OpenType table: 'onum'"),
            available.numeric_old_style,
          )}
        </div>
        <div>
          {radio('numeric_width', 'default', F('Default Width'), _('Normal widths.'))}
          {radio(
            'numeric_width',
            'proportional',
            F('Proportional'),
            _("Proportional width numerals. OpenType table: 'pnum'"),
            available.numeric_proportional,
          )}
          {radio(
            'numeric_width',
            'tabular',
            F('Tabular'),
            _("Same width numerals. OpenType table: 'tnum'"),
            available.numeric_tabular,
          )}
        </div>
        <div>
          {radio('numeric_fractions', 'default', F('Default Fractions'), _('Normal fractions.'))}
          {radio(
            'numeric_fractions',
            'diagonal',
            F('Diagonal'),
            _("Diagonal fractions. OpenType table: 'frac'"),
            available.numeric_diagonal,
          )}
          {radio(
            'numeric_fractions',
            'stacked',
            F('Stacked'),
            _("Stacked fractions. OpenType table: 'afrc'"),
            available.numeric_stacked,
          )}
        </div>
        <div>
          {check('numeric_ordinal', F('Ordinal'), _("Ordinals (raised 'th', etc.). OpenType table: 'ordn'"))}
          {check('numeric_slashed_zero', F('Slashed Zero'), _("Slashed zeros. OpenType table: 'zero'"))}
        </div>
      </fieldset>
      <fieldset>
        <legend>{F('Feature Settings')}</legend>
        {available.tables.map((t) => (
          <label key={t.tag} title={t.input}>
            <input
              type="checkbox"
              checked={(variants.features[t.tag] ?? 0) > 0}
              onChange={(e) =>
                onChange({ features: { ...variants.features, [t.tag]: e.target.checked ? 1 : 0 } })
              }
            />{' '}
            {t.tag}{' '}
            <span style={{ ...preview, fontSize: '16px', fontFeatureSettings: `"${t.tag}" 1` }}>
              {[...t.input].slice(0, 6).join('')}
            </span>
          </label>
        ))}
        <input
          type="text"
          aria-label={F('Feature Settings')}
          title={_('Feature settings in CSS form (e.g. "wxyz" or "wxyz" 3).')}
          value={variants.feature_entry}
          onChange={(e) => onChange({ feature_entry: e.target.value })}
        />
      </fieldset>
      <div className="text-edit-preview" style={preview}>
        {Preferences.get().getString('/tools/text/font_sample', 'AaBbCcIiPpQq12369$€¢?.;/()')}
      </div>
    </div>
  );
}
