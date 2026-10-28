// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/toolbar/text-toolbar.cpp, src/ui/toolbar/text-toolbar.h, share/ui/toolbar-text.ui
/*
 * Text aux toolbar
 *
 * Authors:
 *   MenTaLguY <mental@rydia.net>
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   bulia byak <buliabyak@users.sf.net>
 *   Frank Felfe <innerspace@iname.com>
 *   John Cliff <simarilius@yahoo.com>
 *   David Turner <novalis@gnu.org>
 *   Josh Andler <scislac@scislac.com>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Maximilian Albert <maximilian.albert@gmail.com>
 *   Tavmjong Bah <tavmjong@free.fr>
 *   Abhishek Sharma
 *   Kris De Gussem <Kris.DeGussem@gmail.com>
 *   Vaibhav Malik <vaibhavmalik2018@gmail.com>
 *
 * Copyright (C) 2004 David Turner
 * Copyright (C) 2003 MenTaLguY
 * Copyright (C) 1999-2011 authors
 * Copyright (C) 2001-2002 Ximian, Inc.
 */
import {
  _,
  C_,
  computeFontLineHeight,
  DocumentUndo,
  Preferences,
  type SPCSSAttr,
  SPCSSDirection,
  SPCSSTextAlign,
  SPCSSUnit,
  type SPObject,
  SPStyle,
  SPText,
  spCssAttrScale,
  spReprCssAttrNew,
  spReprCssAttrUnsetAll,
  spReprCssChange,
  spReprCssMerge,
  spReprCssSetProperty,
  spStyleCssSizePxToUnits,
  spStyleCssSizeUnitsToPx,
  spStyleGetCssUnitString,
} from '@inkscape-web/core';
import {
  FontLister,
  fontSizeUnit,
  isTextObject,
  type SPDesktop,
  sp_desktop_set_style,
} from '@inkscape-web/editor';
import { Point } from '@inkscape-web/geom';
import { useEffect, useReducer } from 'react';
import { SpinButton } from '../widget/spinbutton.tsx';
import { IconButton, useSelectionUpdates } from './toolbar.tsx';

/** Set css on object and unset its properties in the descendants (elements only). */
function recursively_set_properties(object: SPObject, css: SPCSSAttr, unset_descendents = true): void {
  spReprCssChange(object.getRepr(), css, 'style');
  const css_unset = spReprCssAttrUnsetAll(css);
  for (const child of object.children) {
    if (child.getRepr().type() === 'element')
      recursively_set_properties(child, unset_descendents ? css_unset : css);
  }
}

/** The selected texts. */
function selectedTexts(desktop: SPDesktop) {
  return desktop.getSelection().items().filter(isTextObject);
}

/**
 * Apply css to the selected text objects directly (upstream
 * text_outer_set_style), scaled by the inverse of their transform to the document.
 */
export function text_outer_set_style(desktop: SPDesktop, css: SPCSSAttr): void {
  for (const item of selectedTexts(desktop)) {
    // Scale by inverse of accumulated parent transform
    const css_set = spReprCssAttrNew();
    spReprCssMerge(css_set, css);
    const ex = item.i2docAffine().descrim();
    if (ex !== 0 && ex !== 1) spCssAttrScale(css_set, 1 / ex);
    recursively_set_properties(item, css_set);
  }
}

/**
 * Merge css into the text tool style if no text is selected, and into the
 * last used style (and the selection). Returns true if a text is selected.
 */
export function mergeDefaultStyle(desktop: SPDesktop, css: SPCSSAttr): boolean {
  const any = selectedTexts(desktop).length > 0;
  if (!any) Preferences.get().mergeStyle('/tools/text/style', css);
  // This updates the global style
  sp_desktop_set_style(desktop, css, true, true);
  return any;
}

export function fontfamily_value_changed(desktop: SPDesktop, family: string, style: string): void {
  const css = spReprCssAttrNew();
  FontLister.get_instance().fill_css(css, family, style);
  if (mergeDefaultStyle(desktop, css)) {
    DocumentUndo.done(desktop.getDocument(), C_('Undo', 'Text: Change font family'), 'draw-text');
  }
  FontLister.get_instance().add_document_fonts_at_top(desktop.getDocument());
}

export function fontstyle_value_changed(desktop: SPDesktop, family: string, style: string): void {
  const css = spReprCssAttrNew();
  FontLister.get_instance().fill_css(css, family, style);
  if (mergeDefaultStyle(desktop, css)) {
    DocumentUndo.done(desktop.getDocument(), C_('Undo', 'Text: Change font style'), 'draw-text');
  }
}

/** Set the font size (in the unit of /options/font/unitType). */
export function fontsize_value_changed(desktop: SPDesktop, size: number): void {
  const css = spReprCssAttrNew();
  const unit = fontSizeUnit();
  const value = Preferences.get().getBool('/options/font/textOutputPx', true)
    ? `${spStyleCssSizeUnitsToPx(size, unit)}${spStyleGetCssUnitString(SPCSSUnit.SP_CSS_UNIT_PX)}`
    : `${size}${spStyleGetCssUnitString(unit)}`;
  spReprCssSetProperty(css, 'font-size', value);
  // Apply font size to selected objects.
  text_outer_set_style(desktop, css);
  if (mergeDefaultStyle(desktop, css)) {
    DocumentUndo.maybeDone(
      desktop.getDocument(),
      'ttb:size',
      C_('Undo', 'Text: Change font size'),
      'draw-text',
    );
  }
}

/** Set the line height (unitless, a multiple of the font size). TODO: line height units. */
export function lineheight_value_changed(desktop: SPDesktop, value: number): void {
  const css = spReprCssAttrNew();
  spReprCssSetProperty(css, 'line-height', String(value));
  text_outer_set_style(desktop, css);
  const texts = selectedTexts(desktop);
  if (texts.length) {
    // Rebuild the layout and save the new x and y of the line tspans.
    desktop.getDocument().ensureUpToDate();
    for (const item of texts) item.updateRepr();
    DocumentUndo.maybeDone(
      desktop.getDocument(),
      'ttb:line-height',
      C_('Undo', 'Text: Change line-height'),
      'draw-text',
    );
  }
  mergeDefaultStyle(desktop, css);
}

/** The css of an alignment mode (0 left, 1 center, 2 right, 3 justify) in direction. */
function cssForTextAlignment(align_mode: number, direction: SPCSSDirection): SPCSSAttr {
  const css = spReprCssAttrNew();
  const ltr = direction === SPCSSDirection.SP_CSS_DIRECTION_LTR;
  const set = (anchor: string, align: string) => {
    spReprCssSetProperty(css, 'text-anchor', anchor);
    spReprCssSetProperty(css, 'text-align', align);
  };
  if ((align_mode === 0 && ltr) || (align_mode === 2 && !ltr)) set('start', 'start');
  if ((align_mode === 0 && !ltr) || (align_mode === 2 && ltr)) set('end', 'end');
  if (align_mode === 1) set('middle', 'center');
  if (align_mode === 3) set('start', 'justify');
  return css;
}

/** Any text alignment in, right/center/left/justify out. */
function text_align_to_side(align: SPCSSTextAlign, direction: SPCSSDirection): SPCSSTextAlign {
  const ltr = direction === SPCSSDirection.SP_CSS_DIRECTION_LTR;
  if (
    (align === SPCSSTextAlign.SP_CSS_TEXT_ALIGN_START && ltr) ||
    (align === SPCSSTextAlign.SP_CSS_TEXT_ALIGN_END && !ltr)
  )
    return SPCSSTextAlign.SP_CSS_TEXT_ALIGN_LEFT;
  if (
    (align === SPCSSTextAlign.SP_CSS_TEXT_ALIGN_START && !ltr) ||
    (align === SPCSSTextAlign.SP_CSS_TEXT_ALIGN_END && ltr)
  )
    return SPCSSTextAlign.SP_CSS_TEXT_ALIGN_RIGHT;
  return align;
}

/**
 * Set the alignment and move the alignment point of the texts so that they
 * keep their place. TODO: vertical text.
 */
export function align_mode_changed(desktop: SPDesktop, align_mode: number): void {
  const prefs = Preferences.get();
  prefs.setInt('/tools/text/align_mode', align_mode);
  let changed = false;
  const selection = desktop.getSelection();
  for (const text of selection.items()) {
    if (!(text instanceof SPText)) continue;
    // Find current text inline-size (width for horizontal text).
    const bbox = text.get_frame() ?? text.geometricBounds();
    if (!bbox) continue; // No bounding box, no joy!
    const width = bbox.width();
    const direction = text.style.direction.value;
    // Switch alignment point
    const factor = [0, 0.5, 1, 0][align_mode] ?? 0;
    const old = {
      [SPCSSTextAlign.SP_CSS_TEXT_ALIGN_LEFT]: 0,
      [SPCSSTextAlign.SP_CSS_TEXT_ALIGN_CENTER]: 0.5,
      [SPCSSTextAlign.SP_CSS_TEXT_ALIGN_RIGHT]: 1,
    }[text_align_to_side(text.style.text_align.value, direction) as number];
    const move = old === undefined || align_mode === 3 ? 0 : (factor - old) * width;
    spReprCssChange(text.getRepr(), cssForTextAlignment(align_mode, direction), 'style');
    text.attributes.setFirstXY(text.attributes.firstXY().add(new Point(move, 0)));
    text.updateRepr();
    changed = true;
  }
  // Update the default style css if nothing is selected, based off of the default direction.
  if (selection.isEmpty()) {
    const direction = prefs.getInt('/tools/text/direction_mode', SPCSSDirection.SP_CSS_DIRECTION_LTR);
    changed = mergeDefaultStyle(desktop, cssForTextAlignment(align_mode, direction));
  }
  if (changed) DocumentUndo.done(desktop.getDocument(), C_('Undo', 'Text: Change alignment'), 'draw-text');
}

/**
 * The style the toolbar shows: of the first selected text, else the text tool
 * style; scale converts its lengths to desktop px (upstream objects_query_fontnumbers).
 */
function queryStyle(desktop: SPDesktop): { style: SPStyle; scale: number } {
  const text = selectedTexts(desktop)[0];
  if (text) return { style: text.style, scale: text.i2dtAffine().descrim() };
  const style = new SPStyle(desktop.getDocument());
  style.mergeString(Preferences.get().getString('/tools/text/style'));
  return { style, scale: 1 };
}

const FONT_UNITS: readonly [SPCSSUnit, string][] = [
  [SPCSSUnit.SP_CSS_UNIT_PX, 'px'],
  [SPCSSUnit.SP_CSS_UNIT_PT, 'pt'],
  [SPCSSUnit.SP_CSS_UNIT_PC, 'pc'],
  [SPCSSUnit.SP_CSS_UNIT_MM, 'mm'],
  [SPCSSUnit.SP_CSS_UNIT_CM, 'cm'],
  [SPCSSUnit.SP_CSS_UNIT_IN, 'in'],
];
const ALIGN_MODES: readonly [string, string][] = [
  ['format-justify-left', 'Align left'],
  ['format-justify-center', 'Align center'],
  ['format-justify-right', 'Align right'],
  ['format-justify-fill', 'Justify (only flowed text)'],
];

/**
 * Controls of the text tool: font family (the families of the document, web
 * fonts and, with permission, the system fonts), style, size and its unit,
 * line spacing and alignment, of the selected texts or of new text.
 * TODO: the text subselection (style of selected characters), font collections,
 * superscript/subscript, letter/word spacing, kerning, rotation, writing mode,
 * orientation, direction, line height units.
 */
export function TextToolbar({ desktop }: { desktop: SPDesktop }) {
  useSelectionUpdates(desktop);
  const [, update] = useReducer((n: number) => n + 1, 0);
  const lister = FontLister.get_instance();
  useEffect(() => lister.changedSignal.connect(update), [lister]);
  useEffect(() => lister.add_document_fonts_at_top(desktop.getDocument()), [lister, desktop]);

  const { style, scale } = queryStyle(desktop);
  const family = lister.family_from_style(style);
  const fontStyle = lister.style_from_style(style);
  const unit = fontSizeUnit();
  const size = spStyleCssSizePxToUnits(style.font_size.computed * scale, unit);
  const unitName = FONT_UNITS.find(([u]) => u === unit)?.[1] ?? 'pt';
  const align = text_align_to_side(style.text_align.computed, style.direction.computed);
  const align_mode =
    align === SPCSSTextAlign.SP_CSS_TEXT_ALIGN_CENTER
      ? 1
      : align === SPCSSTextAlign.SP_CSS_TEXT_ALIGN_RIGHT
        ? 2
        : align === SPCSSTextAlign.SP_CSS_TEXT_ALIGN_JUSTIFY
          ? 3
          : 0;
  const styles = lister.styles(family);

  return (
    <>
      <label className="spinbutton" title={_('Select Font Family (Alt-X to access)')}>
        <input
          key={family}
          className="font-family-entry"
          list="text-toolbar-families"
          defaultValue={family}
          aria-label={_('Font Family')}
          onFocus={() => void lister.loadLocalFonts()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v && v !== family) fontfamily_value_changed(desktop, v, fontStyle);
          }}
        />
        <datalist id="text-toolbar-families">
          {lister.families().map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
      </label>
      <select
        title={_('Font style')}
        aria-label={_('Font Style')}
        value={fontStyle}
        onChange={(e) => fontstyle_value_changed(desktop, family, e.target.value)}
      >
        {(styles.includes(fontStyle) ? styles : [fontStyle, ...styles]).map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <SpinButton
        label=""
        tooltip={`${_('Font size')} (${unitName})`}
        value={size}
        min={0.1}
        max={10000}
        step={1}
        digits={3}
        onChange={(v) => fontsize_value_changed(desktop, v)}
      />
      <select
        title={_('Font size')}
        aria-label={_('Unit')}
        value={unit}
        onChange={(e) => {
          Preferences.get().setInt('/options/font/unitType', Number(e.target.value));
          update();
        }}
      >
        {FONT_UNITS.map(([u, name]) => (
          <option key={u} value={u}>
            {name}
          </option>
        ))}
      </select>
      <span className="toolbar-separator" />
      <SpinButton
        label={_('Line height')}
        tooltip={_('Spacing between baselines')}
        value={computeFontLineHeight(style)}
        min={0}
        max={1000}
        step={0.1}
        digits={3}
        onChange={(v) => lineheight_value_changed(desktop, v)}
      />
      <span className="toolbar-separator" />
      {ALIGN_MODES.map(([icon, tooltip], mode) => (
        <IconButton
          key={icon}
          icon={icon}
          tooltip={_(tooltip)}
          active={align_mode === mode}
          onClick={() => align_mode_changed(desktop, mode)}
        />
      ))}
    </>
  );
}
