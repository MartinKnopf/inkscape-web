// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/text-edit.cpp, src/ui/dialog/text-edit.h
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
import {
  C_,
  DocumentUndo,
  Preferences,
  type SPCSSAttr,
  SPCSSUnit,
  type SPFlowtext,
  type SPItem,
  SPStyle,
  type SPText,
  sp_te_get_string_multiline,
  sp_te_set_repr_text_multiline,
  spReprCssAttrNew,
  spReprCssSetProperty,
  spStyleCssSizePxToUnits,
  spStyleCssSizeUnitsToPx,
  spStyleGetCssUnitString,
} from '@inkscape-web/core';
import type { SPDesktop } from '../../desktop.ts';
import { sp_desktop_set_style } from '../../desktop-style.ts';
import { FontLister, isTextObject } from '../../libnrtype/font-lister.ts';

/** The font size unit of the user interface (/options/font/unitType, an SPCSSUnit). */
export function fontSizeUnit(): number {
  return Preferences.get().getInt('/options/font/unitType', SPCSSUnit.SP_CSS_UNIT_PT);
}

/** The font of the dialog: family, style ("Bold Italic") and size in the unit of fontSizeUnit(). */
export interface TextEditFont {
  family: string;
  style: string;
  size: number;
}

/** The first text or flowed text of the selection (upstream getSelectedTextItem). */
export function getSelectedTextItem(desktop: SPDesktop): SPText | SPFlowtext | null {
  return desktop.getSelection().items().find(isTextObject) ?? null;
}

/** The number of texts in the selection. */
export function getSelectedTextCount(desktop: SPDesktop): number {
  return desktop.getSelection().items().filter(isTextObject).length;
}

/**
 * The font and the text of the selection (upstream onReadSelection): of the
 * first selected text, or of the text tool style for new texts.
 */
export function onReadSelection(desktop: SPDesktop): { font: TextEditFont; text: string | null } {
  const text = getSelectedTextItem(desktop);
  let style: SPStyle;
  // Font sizes are shown in desktop px (upstream objects_query_fontnumbers).
  let scale = 1;
  if (text) {
    style = text.style;
    scale = text.i2dtAffine().descrim();
  } else {
    // If querying returned nothing, read the style from the text tool prefs (default style for new texts).
    style = new SPStyle(desktop.getDocument());
    style.mergeString(Preferences.get().getString('/tools/text/style'));
  }
  const lister = FontLister.get_instance();
  return {
    font: {
      family: lister.family_from_style(style),
      style: lister.style_from_style(style),
      size: spStyleCssSizePxToUnits(style.font_size.computed * scale, fontSizeUnit()),
    },
    text: text && getSelectedTextCount(desktop) === 1 ? sp_te_get_string_multiline(text) : null,
  };
}

/** The css of font (upstream fillTextStyle). TODO: font features and variations. */
export function fillTextStyle(font: TextEditFont): SPCSSAttr {
  const css = spReprCssAttrNew();
  FontLister.get_instance().fill_css(css, font.family, font.style);
  // Set font size
  const unit = fontSizeUnit();
  const size = Preferences.get().getBool('/options/font/textOutputPx', true)
    ? `${spStyleCssSizeUnitsToPx(font.size, unit)}${spStyleGetCssUnitString(SPCSSUnit.SP_CSS_UNIT_PX)}`
    : `${font.size}${spStyleGetCssUnitString(unit)}`;
  spReprCssSetProperty(css, 'font-size', size);
  return css;
}

/** Use font for new texts (the "Set as default" button). */
export function onSetDefault(font: TextEditFont): void {
  Preferences.get().mergeStyle('/tools/text/style', fillTextStyle(font));
}

/**
 * Apply font to the selected texts and, for one text, replace its content
 * with text (the "Apply" button). Without texts, font becomes the default.
 */
export function onApply(desktop: SPDesktop, font: TextEditFont, text: string | null): void {
  const css = fillTextStyle(font);
  sp_desktop_set_style(desktop, css, true);
  const items = getSelectedTextCount(desktop);
  if (items === 0) {
    // no text objects; apply style to prefs for new objects
    Preferences.get().mergeStyle('/tools/text/style', css);
  } else if (items === 1 && text !== null) {
    // exactly one text object; now set its text, too
    const item = getSelectedTextItem(desktop) as SPItem;
    if (sp_te_get_string_multiline(item) !== text) sp_te_set_repr_text_multiline(item, text);
  }
  FontLister.get_instance().add_document_fonts_at_top(desktop.getDocument());
  DocumentUndo.done(desktop.getDocument(), C_('Undo', 'Set text style'), 'draw-text');
}
