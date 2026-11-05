// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-dialogs.cpp, src/actions/actions-dialogs.h
/*
 * Actions for opening dialogs.
 *
 * Copyright (C) 2020 Tavmjong Bah
 */
import { N_, NC_ } from '@inkscape-web/core';
import type { InkscapeApplication } from '../inkscape-application.ts';
import { get_dialog_container } from '../ui/dialog/dialog-container.ts';
import { show_output } from './actions-helper.ts';

const SECTION = NC_('Action Section', 'Dialog');

/** The detailed names add the dialog key, like "win.dialog-open('Find')". */
const DIALOG_OPEN = 'win.dialog-open';
const DIALOG_TOGGLE = 'win.dialog-toggle';

/** Action id, label, section and tooltip (untranslated). */
export const raw_data_dialogs: readonly (readonly [string, string, string, string])[] = [
  [
    `${DIALOG_OPEN}('AlignDistribute')`,
    N_('Open Align and Distribute'),
    SECTION,
    N_('Align and distribute objects'),
  ],
  [
    `${DIALOG_OPEN}('CloneTiler')`,
    N_('Open Clone Tiler'),
    SECTION,
    N_('Create multiple clones of selected object, arranging them into a pattern or scattering'),
  ],
  [`${DIALOG_OPEN}('DebugWindow')`, N_('Open Debugger'), SECTION, N_('Open debugger')],
  [
    `${DIALOG_OPEN}('DocumentProperties')`,
    N_('Open Document Properties'),
    SECTION,
    N_('Edit properties of this document (to be saved with the document)'),
  ],
  [
    `${DIALOG_OPEN}('DocumentResources')`,
    N_('Open Document Resources'),
    SECTION,
    N_('Show document overview and resources'),
  ],
  [
    `${DIALOG_OPEN}('ExtensionsGallery')`,
    N_('Open Extension Gallery'),
    SECTION,
    N_('Show and run available extensions'),
  ],
  [
    `${DIALOG_OPEN}('Export')`,
    N_('Open Export'),
    SECTION,
    N_('Export this document or a selection as a PNG image'),
  ],
  [
    `${DIALOG_OPEN}('FillStroke')`,
    N_('Open Fill and Stroke'),
    SECTION,
    N_("Edit objects' colors, gradients, arrowheads, and other fill and stroke properties..."),
  ],
  [
    `${DIALOG_OPEN}('FilterEffects')`,
    N_('Open Filter Effects'),
    SECTION,
    N_('Manage, edit, and apply SVG filters'),
  ],
  [
    `${DIALOG_OPEN}('FilterGallery')`,
    N_('Open Filter Gallery'),
    SECTION,
    N_('Show and apply available filters'),
  ],
  [`${DIALOG_OPEN}('Find')`, N_('Open Find'), SECTION, N_('Find objects in document')],
  [`${DIALOG_OPEN}('FontCollections')`, N_('Open Font Collections'), SECTION, N_('Manage Font Collections')],
  [`${DIALOG_OPEN}('IconPreview')`, N_('Open Icon Preview'), SECTION, N_('Preview Icon')],
  [
    `${DIALOG_OPEN}('Input')`,
    N_('Open Input'),
    SECTION,
    N_('Configure extended input devices, such as a graphics tablet'),
  ],
  [
    `${DIALOG_OPEN}('LivePathEffect')`,
    N_('Open Live Path Effect'),
    SECTION,
    N_('Manage, edit, and apply path effects'),
  ],
  [
    `${DIALOG_OPEN}('ObjectProperties')`,
    N_('Open Object Properties'),
    SECTION,
    N_('Edit the object attributes (context dependent)...'),
  ],
  [`${DIALOG_OPEN}('Objects')`, N_('Open Objects'), SECTION, N_('View Objects')],
  [`${DIALOG_OPEN}('Preferences')`, N_('Open Preferences'), SECTION, N_('Edit global Inkscape preferences')],
  [
    `${DIALOG_OPEN}('Selectors')`,
    N_('Open Selectors'),
    SECTION,
    N_('View and edit CSS selectors and styles'),
  ],
  [`${DIALOG_OPEN}('SVGFonts')`, N_('Open SVG Fonts'), SECTION, N_('Edit SVG fonts')],
  // TRANSLATORS: "Swatches" -> color samples
  [`${DIALOG_OPEN}('Swatches')`, N_('Open Swatches'), SECTION, N_('Select colors from a swatches palette')],
  [`${DIALOG_OPEN}('Symbols')`, N_('Open Symbols'), SECTION, N_('Select symbol from a symbols palette')],
  [
    `${DIALOG_OPEN}('Text')`,
    N_('Open Text'),
    SECTION,
    N_('View and select font family, font size and other text properties'),
  ],
  [
    `${DIALOG_OPEN}('Trace')`,
    N_('Open Trace'),
    SECTION,
    N_('Create one or more paths from a bitmap by tracing it'),
  ],
  [
    `${DIALOG_OPEN}('Transform')`,
    N_('Open Transform'),
    SECTION,
    N_("Precisely control objects' transformations"),
  ],
  [`${DIALOG_OPEN}('UndoHistory')`, N_('Open Undo History'), SECTION, N_('Undo History')],
  [
    `${DIALOG_OPEN}('XMLEditor')`,
    N_('Open XML Editor'),
    SECTION,
    N_('View and edit the XML tree of the document'),
  ],
  ['app.preferences', N_('Open Preferences'), SECTION, N_('Edit global Inkscape preferences')],
  [`${DIALOG_OPEN}('Spellcheck')`, N_('Open Spellcheck'), SECTION, N_('Check spelling of text in document')],
  [`${DIALOG_OPEN}('Prototype')`, N_('Open Prototype'), SECTION, N_('Prototype Dialog')],
  [DIALOG_TOGGLE, N_('Toggle all dialogs'), SECTION, N_('Show or hide all dialogs')],
];

/** Open the dialog with the key (win.dialog-open); the dialogs are shown by the DialogContainer. */
export function dialog_open(dialog: string): void {
  const container = get_dialog_container();
  if (!container) {
    show_output('dialog_open: no dialog container!');
    return;
  }
  if (!container.has_dialog(dialog)) {
    show_output(`dialog_open: invalid dialog name: ${dialog}`);
    return;
  }
  container.new_dialog(dialog);
}

/** Show all dialogs if they are hidden, else hide them (win.dialog-toggle). */
export function dialog_toggle(): void {
  const container = get_dialog_container();
  if (!container) {
    show_output('dialog_toggle: no dialog container!');
    return;
  }
  container.toggle_dialogs();
}

/**
 * Register win.dialog-open, win.dialog-toggle and app.preferences. Dialogs that are not ported
 * (the container does not know the key) are disabled: their menu items and keys do nothing.
 */
export function add_actions_dialogs(app: InkscapeApplication): void {
  app.actions.win.add_action_with_parameter(
    'dialog-open',
    's',
    dialog_open,
    (key) => get_dialog_container()?.has_dialog(key) ?? false,
  );
  app.actions.win.add_action('dialog-toggle', dialog_toggle);
  // macOS automatically uses app.preferences in the application menu.
  app.actions.app.add_action('preferences', () => dialog_open('Preferences'));
  app.get_action_extra_data().add_data(raw_data_dialogs);
}
