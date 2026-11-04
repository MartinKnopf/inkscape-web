// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-text.cpp, src/actions/actions-text.h
/*
 * Actions Related to Text
 *
 * Authors:
 *   Sushant A A <sushant.co19@gmail.com>
 *
 * Copyright (C) 2021 Authors
 */
import {
  flowtext_to_text,
  N_,
  NC_,
  SPText,
  text_flow_into_shape,
  text_flow_shape_subtract,
  text_hide_shape_inside,
  text_or_flowtext_in_selection,
  text_put_on_path,
  text_remove_all_kerns,
  text_remove_from_path,
  text_select_by_font,
  text_to_glyphs,
  text_unflow,
} from '@inkscape-web/core';
import type { InkscapeApplication } from '../inkscape-application.ts';

const SECTION = NC_('Action Section', 'Text');

/** Action id, label, section and tooltip (untranslated), of the text actions. */
export const raw_data_text: readonly (readonly [string, string, string, string])[] = [
  ['app.text-put-on-path', N_('Put on Path'), SECTION, N_('Put text on path')],
  ['app.text-remove-from-path', N_('Remove from Path'), SECTION, N_('Remove text from path')],
  [
    'app.text-flow-into-frame',
    N_('Flow into Frame'),
    SECTION,
    N_('Put text into a frame (path or shape), creating a flowed text linked to the frame object'),
  ],
  [
    'app.text-flow-subtract-frame',
    N_('Set Subtraction Frames'),
    SECTION,
    N_('Flow text around a frame (path or shape), only available for SVG 2.0 Flow text.'),
  ],
  [
    'app.text-unflow',
    N_('Unflow'),
    SECTION,
    N_('Remove text from frame (creates a single-line text object)'),
  ],
  ['app.text-unflow-and-keep-shape', N_('Unflow and Keep Shape'), SECTION, N_('Remove text from shape')],
  [
    'app.text-convert-to-regular',
    N_('Convert to Text'),
    SECTION,
    N_('Convert flowed text to regular text object (preserves appearance)'),
  ],
  ['app.text-convert-to-glyphs', N_('Convert to Glyphs'), SECTION, N_('Convert text into individual glyphs')],
  [
    'app.text-unkern',
    N_('Remove Manual Kerns'),
    SECTION,
    N_('Remove all manual kerns and glyph rotations from a text object'),
  ],
  [
    'app.text-select-by-font',
    N_('Select text by Font'),
    SECTION,
    N_('Select all text objects which use the selected font, or the last font used.'),
  ],
];

/** Register the text actions. */
export function add_actions_text(app: InkscapeApplication): void {
  const withSelection =
    (f: (selection: NonNullable<ReturnType<InkscapeApplication['get_active_selection']>>) => void) => () => {
      const selection = app.get_active_selection();
      if (selection) f(selection);
    };
  const a = app.actions.app;
  a.add_action('text-put-on-path', withSelection(text_put_on_path));
  a.add_action('text-remove-from-path', withSelection(text_remove_from_path));
  a.add_action('text-flow-into-frame', withSelection(text_flow_into_shape));
  a.add_action('text-flow-subtract-frame', withSelection(text_flow_shape_subtract));
  a.add_action('text-unflow', withSelection(text_unflow));
  a.add_action(
    'text-unflow-and-keep-shape',
    withSelection((selection) => {
      const text = selection.singleItem();
      if (!(text instanceof SPText)) return;
      // TODO: insert_text_fallback() (actions-svg-processing.cpp) to keep the line positions.
      text_hide_shape_inside(text);
    }),
  );
  a.add_action('text-convert-to-regular', withSelection(flowtext_to_text));
  a.add_action('text-convert-to-glyphs', withSelection(text_to_glyphs));
  a.add_action('text-unkern', withSelection(text_remove_all_kerns));
  a.add_action(
    'text-select-by-font',
    withSelection((selection) => {
      // Upstream also uses the style of the text tool selection and the text tool preferences.
      const text = text_or_flowtext_in_selection(selection);
      const style = text?.style;
      const font_style = style?.font_family.set
        ? style.font_family.value()
        : style?.font_specification.set
          ? style.font_specification.value()
          : null;
      const doc = selection.document();
      // TODO: Could select the layer instead of the document root here
      if (font_style && doc) text_select_by_font(selection, font_style, doc.getRoot());
    }),
  );
  app.get_action_extra_data().add_data(raw_data_text);
}
