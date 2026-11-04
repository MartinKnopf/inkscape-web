// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/svg-fonts-dialog.cpp, src/ui/dialog/svg-fonts-dialog.h
/*
 * SVG Fonts dialog
 *
 * Authors:
 *   Felipe C. da S. Sanches <juca@members.fsf.org>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *
 * Copyright (C) 2008 Authors
 */
import {
  _,
  C_,
  type SPFont,
  type SPGlyph,
  type SPGlyphKerning,
  SvgFont,
  sp_svg_write_path,
} from '@inkscape-web/core';
import {
  add_font,
  add_glyph,
  add_kerning_pair,
  document_fonts,
  FONT_ATTRS,
  FONT_FACE_ATTRS,
  font_face,
  font_glyphs,
  font_kerning_pairs,
  glyph_advance_edit,
  glyph_name_edit,
  glyph_unicode_edit,
  missing_glyph_description_from_selected_path,
  remove_font_object,
  reset_missing_glyph_description,
  set_font_attribute,
  set_font_label,
  set_glyph_description_from_selected_path,
  set_kerning_value,
} from '@inkscape-web/editor';
import { useState } from 'react';
import { useActiveDesktop } from '../../app/active-desktop.ts';
import { useReprVersion } from './use-repr.ts';

/** The labels and tooltips of the Global settings tab (upstream AttrSpin/AttrEntry). */
const ATTR_LABELS: Record<string, [string, string]> = {
  'horiz-adv-x': [_('Horizontal advance X:'), _('Default glyph width for horizontal text')],
  'horiz-origin-x': [
    _('Horizontal origin X:'),
    _('Default X-coordinate of the origin of a glyph (for horizontal text)'),
  ],
  'horiz-origin-y': [
    _('Horizontal origin Y:'),
    _('Default Y-coordinate of the origin of a glyph (for horizontal text)'),
  ],
  'units-per-em': [_('Em-size:'), _("Display units per <i>em</i> (nominally width of 'M' character)")],
  ascent: [_('Ascender:'), _("Amount of space taken up by ascenders like the tall line on the letter 'h'")],
  'cap-height': [
    _('Caps height:'),
    _("The height of a capital letter above the baseline like the letter 'H' or 'I'"),
  ],
  'x-height': [_('x-height:'), _("The height of a lower-case letter above the baseline like the letter 'x'")],
  descent: [_('Descender:'), _("Amount of space taken up by descenders like the tail on the letter 'g'")],
};

/** Text without the Pango markup tags (for titles and the message line). */
const plain = (markup: string) => markup.replace(/<\/?[bi]>/g, '');

/** Text drawn with an SVG font, as an inline SVG (upstream SvgFontDrawingArea). */
function SvgFontText({ font, text, size }: { font: SvgFont; text: string; size: number }) {
  const d = sp_svg_write_path(font.text_path(text, size, 0, size));
  const width = Math.max(size, font.scaled_font_text_to_glyphs(text).length * size * 1.2);
  return (
    <svg className="svg-fonts-text" width={width} height={size * 1.3} aria-label={text}>
      <title>{text}</title>
      <path d={d} />
    </svg>
  );
}

/**
 * The SVG Font Editor (dialog key "SVGFonts"): the SVG fonts of the document,
 * and for the selected font the tabs Global settings (font and font-face
 * attributes, the missing glyph), Glyphs (characters, names, advances, curves
 * from the selection) and Kerning (horizontal kerning pairs), with a preview.
 * TODO: the glyph grid view, the typography canvas ("Set up canvas") and
 * editing glyphs in layers.
 */
export function SvgFontsDialog() {
  const desktop = useActiveDesktop();
  const doc = desktop?.doc ?? null;
  useReprVersion(doc?.rroot ?? null);
  const [current, setCurrent] = useState<SPFont | null>(null);
  const [tab, setTab] = useState<'global' | 'glyphs' | 'kerning'>('global');
  const [glyph, setGlyph] = useState<SPGlyph | null>(null);
  const [pair, setPair] = useState<SPGlyphKerning | null>(null);
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');
  const [preview, setPreview] = useState(_('Sample text'));
  const [message, setMessage] = useState<string | null>(null);
  if (!desktop || !doc) return null;
  doc.ensureUpToDate();

  const fonts = document_fonts(doc);
  const font = current && fonts.includes(current) ? current : (fonts[0] ?? null);
  const svgfont = font ? new SvgFont(font) : null;
  const glyphs = font ? font_glyphs(font) : [];
  const pairs = font ? font_kerning_pairs(font) : [];
  const selGlyph = glyph && glyphs.includes(glyph) ? glyph : null;
  const selPair = pair && pairs.includes(pair) ? pair : null;
  const face = font ? font_face(font) : null;
  const flash = (m: string | null) => setMessage(m && plain(m));

  const attrSpin = (name: string) => {
    const [label, tip] = ATTR_LABELS[name]!;
    const o = (FONT_ATTRS as readonly string[]).includes(name) ? font : face;
    return (
      <label key={name} className="svg-fonts-attr" title={plain(tip)}>
        <span>{label}</span>
        <input
          type="number"
          min={0}
          max={4096}
          step={10}
          value={o?.getRepr().getAttributeDouble(name, 0) ?? 0}
          onChange={(e) => font && set_font_attribute(font, name, String(e.target.valueAsNumber || 0))}
        />
      </label>
    );
  };

  return (
    <div className="svg-fonts-dialog">
      <div className="svg-fonts-fonts">
        <div className="svg-fonts-fontlist" role="listbox" aria-label={_('_Fonts').replace('_', '')}>
          {fonts.map((f) => (
            <input
              key={f.getId() ?? f.label() ?? ''}
              role="option"
              aria-selected={f === font}
              className="svg-fonts-fontname"
              value={f.label() ?? f.getId() ?? ''}
              onFocus={() => setCurrent(f)}
              onChange={(e) => set_font_label(f, e.target.value)}
            />
          ))}
        </div>
        <div className="text-edit-row">
          <button type="button" title={C_('Undo', 'Add font')} onClick={() => setCurrent(add_font(doc))}>
            +
          </button>
          <button
            type="button"
            title={C_('Undo', 'Remove font')}
            disabled={!font}
            onClick={() => font && remove_font_object(font, C_('Undo', 'Remove font'))}
          >
            −
          </button>
        </div>
      </div>
      {font && svgfont && (
        <>
          <div className="text-edit-tabs" role="tablist">
            {(
              [
                ['global', _('_Global settings')],
                ['glyphs', _('_Glyphs')],
                ['kerning', _('_Kerning')],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
              >
                {label.replace('_', '')}
              </button>
            ))}
          </div>
          {tab === 'global' && (
            <div className="svg-fonts-tab">
              <strong>{_('Font Attributes')}</strong>
              {FONT_ATTRS.map(attrSpin)}
              <strong>{_('Font face attributes')}</strong>
              <label
                className="svg-fonts-attr"
                title={_('Name of the font as it appears in font selectors and css font-family properties')}
              >
                <span>{_('Family name:')}</span>
                <input
                  value={face?.getAttribute('font-family') ?? ''}
                  onChange={(e) => set_font_attribute(font, 'font-family', e.target.value)}
                />
              </label>
              {FONT_FACE_ATTRS.map(attrSpin)}
              <div className="text-edit-row">
                <span>{_('Missing glyph')}</span>
                <SvgFontText font={svgfont} text={'\u{10FFFF}'} size={24} />
                <button
                  type="button"
                  onClick={() =>
                    flash(missing_glyph_description_from_selected_path(desktop.getSelection(), font))
                  }
                >
                  {_('From selection')}
                </button>
                <button type="button" onClick={() => reset_missing_glyph_description(font)}>
                  {_('Reset')}
                </button>
              </div>
            </div>
          )}
          {tab === 'glyphs' && (
            <div className="svg-fonts-tab">
              <table className="svg-fonts-glyphs">
                <thead>
                  <tr>
                    <th>{_('Glyph')}</th>
                    <th>{_('Name')}</th>
                    <th>{_('Characters')}</th>
                    <th>{_('Unicode')}</th>
                    <th>{_('Advance')}</th>
                  </tr>
                </thead>
                <tbody>
                  {glyphs.map((g, i) => (
                    <tr
                      // biome-ignore lint/suspicious/noArrayIndexKey: glyphs have no id
                      key={i}
                      aria-selected={g === selGlyph}
                      onFocus={() => setGlyph(g)}
                      onClick={() => setGlyph(g)}
                    >
                      <td>
                        <SvgFontText font={svgfont} text={g.unicode} size={24} />
                      </td>
                      <td>
                        <input value={g.glyph_name} onChange={(e) => glyph_name_edit(g, e.target.value)} />
                      </td>
                      <td>
                        <input value={g.unicode} onChange={(e) => glyph_unicode_edit(g, e.target.value)} />
                      </td>
                      <td>
                        {[...g.unicode]
                          .map((c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`)
                          .join(' ')}
                      </td>
                      <td>
                        <input
                          type="number"
                          value={g.getAttribute('horiz-adv-x') ?? ''}
                          placeholder={String(font.horiz_adv_x)}
                          onChange={(e) => glyph_advance_edit(g, e.target.value)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="text-edit-row">
                <button
                  type="button"
                  title={_('Get curves from selection to replace current glyph')}
                  onClick={() =>
                    flash(set_glyph_description_from_selected_path(desktop.getSelection(), font, selGlyph))
                  }
                >
                  {_('Get curves')}
                </button>
                <button
                  type="button"
                  title={_('Sort glyphs in Unicode order')}
                  onClick={() => font.sort_glyphs()}
                >
                  {_('Sort glyphs')}
                </button>
                <button type="button" title={_('Add new glyph')} onClick={() => setGlyph(add_glyph(font))}>
                  +
                </button>
                <button
                  type="button"
                  title={_('Delete current glyph')}
                  disabled={!selGlyph}
                  onClick={() => selGlyph && remove_font_object(selGlyph, C_('Undo', 'Remove glyph'))}
                >
                  −
                </button>
              </div>
            </div>
          )}
          {tab === 'kerning' && (
            <div className="svg-fonts-tab">
              <div className="text-edit-row">
                <span>{_('Select glyphs:')}</span>
                {[
                  [first, setFirst],
                  [second, setSecond],
                ].map(([value, set], i) => (
                  <select
                    // biome-ignore lint/suspicious/noArrayIndexKey: two fixed menus
                    key={i}
                    value={value as string}
                    onChange={(e) => (set as (v: string) => void)(e.target.value)}
                  >
                    <option value="" />
                    {glyphs
                      .filter((g) => g.unicode)
                      .map((g, j) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: glyphs have no id
                        <option key={j} value={g.unicode}>
                          {g.unicode}
                        </option>
                      ))}
                  </select>
                ))}
                <button type="button" onClick={() => setPair(add_kerning_pair(font, first, second))}>
                  {_('Add pair')}
                </button>
                <button
                  type="button"
                  disabled={!selPair}
                  onClick={() => selPair && remove_font_object(selPair, C_('Undo', 'Remove kerning pair'))}
                >
                  {_('Remove pair')}
                </button>
              </div>
              <table className="svg-fonts-glyphs">
                <thead>
                  <tr>
                    <th>{_('First glyph')}</th>
                    <th>{_('Second glyph')}</th>
                    <th>{_('Kerning value:')}</th>
                  </tr>
                </thead>
                <tbody>
                  {pairs.map((p, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: kerning pairs have no id
                    <tr key={i} aria-selected={p === selPair} onClick={() => setPair(p)}>
                      <td>{p.u1.attribute_string()}</td>
                      <td>{p.u2.attribute_string()}</td>
                      <td>{p.k}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {selPair && (
                <>
                  <SvgFontText
                    font={svgfont}
                    text={String.fromCodePoint(selPair.u1.sample_glyph(), selPair.u2.sample_glyph())}
                    size={48}
                  />
                  <label className="svg-fonts-attr">
                    <span>{_('Kerning value:')}</span>
                    {/* slider values increase from right to left so that they match the kerning pair preview */}
                    <input
                      type="range"
                      min={0}
                      max={font.horiz_adv_x}
                      value={font.horiz_adv_x - selPair.k}
                      onChange={(e) => set_kerning_value(font, selPair, e.target.valueAsNumber)}
                    />
                  </label>
                </>
              )}
            </div>
          )}
          <div className="svg-fonts-preview">
            <SvgFontText font={svgfont} text={preview} size={32} />
            <label className="svg-fonts-attr">
              <span>{_('Preview text:')}</span>
              <input value={preview} onChange={(e) => setPreview(e.target.value)} />
            </label>
          </div>
        </>
      )}
      {message && (
        <p className="svg-fonts-message" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
