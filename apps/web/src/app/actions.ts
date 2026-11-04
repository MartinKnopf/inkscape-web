// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-file-gui.cpp, src/actions/actions-file-window.cpp, src/actions/actions-dialogs.cpp, src/actions/actions-file.cpp, src/actions/actions-window.cpp, src/actions/actions-tutorial.cpp, src/actions/actions-view-window.cpp
// The actions that need the web app: files and dialogs. The other actions are
// registered by InkscapeApplication in @inkscape-web/editor.
import { _, C_, DocumentUndo, N_, NC_, ngettext, SPDocument } from '@inkscape-web/core';
import { INKSCAPE_VERSION, InkscapeApplication, type SPDesktop, show_output } from '@inkscape-web/editor';
import { hasDialog, openDialog } from '../ui/dialog/dialog-manager.ts';
import { showMessageDialog } from '../ui/dialog/message-dialog.tsx';
import {
  app_quit,
  document_close_active,
  document_close_unchecked,
  document_close_unchecked_of,
  document_new,
  document_tab_step,
  openDocumentWindow,
} from './documents.ts';
import {
  sp_file_import,
  sp_file_open_dialog,
  sp_file_open_recent,
  sp_file_reload,
  sp_file_save,
  sp_file_save_a_copy,
  sp_file_save_as,
  sp_print_document,
} from './file.ts';

const SECTION_FILE = NC_('Action Section', 'File');
const SECTION_DIALOG = NC_('Action Section', 'Dialog');
const SECTION_WINDOW_FILE = NC_('Action Section', 'Window-File');
const SECTION_FILE_APP = NC_('Action Section', 'File');
const SECTION_WINDOW = NC_('Action Section', 'Window');
const SECTION_TUTORIAL = NC_('Action Section', 'Tutorial');
const SECTION_VIEW = NC_('Action Section', 'View');

/** Action id, label, section and tooltip (untranslated) of the file, window and tutorial actions. */
const raw_data_app: readonly (readonly [string, string, string, string])[] = [
  [
    'win.document-revert',
    N_('Revert'),
    SECTION_WINDOW_FILE,
    N_('Revert to the last saved version of document (changes will be lost)'),
  ],
  ['win.document-print', N_('Print'), SECTION_WINDOW_FILE, N_('Print document')],
  [
    'win.document-cleanup',
    N_('Clean Up Document'),
    SECTION_WINDOW_FILE,
    N_('Remove unused definitions (such as gradients or clipping paths) from the document'),
  ],
  ['app.file-open', N_('File Open'), SECTION_FILE_APP, N_('Open file')],
  ['app.file-new', N_('File New'), SECTION_FILE_APP, N_('Open new document using template')],
  ['app.file-close', N_('File Close'), SECTION_FILE_APP, N_('Close active document')],
  ['app.file-open-window', N_('File Open Window'), SECTION_FILE_APP, N_('Open file window')],
  [
    'app.window-open',
    N_('Window Open'),
    SECTION_WINDOW,
    N_('Open a window for the active document; GUI only'),
  ],
  [
    'app.window-close',
    N_('Window Close'),
    SECTION_WINDOW,
    N_('Close the active window, does not check for data loss'),
  ],
  [
    'app.window-query-geometry',
    N_('Window Query Geometry'),
    SECTION_WINDOW,
    N_("Query the active window's location and size"),
  ],
  ['win.window-new', N_('New Window'), SECTION_VIEW, N_('Open a new window')],
  ['win.window-next', N_('Next Window'), SECTION_VIEW, N_('Switch to the next document window')],
  ['win.window-previous', N_('Previous Window'), SECTION_VIEW, N_('Switch to the previous document window')],
  ['win.tab-next', N_('Next Tab'), SECTION_VIEW, N_('Switch to the next document tab')],
  ['win.tab-previous', N_('Previous Tab'), SECTION_VIEW, N_('Switch to the previous document tab')],
  ['app.tutorial-basic', N_('Inkscape: Basic'), SECTION_TUTORIAL, N_('Getting started with Inkscape')],
  [
    'app.tutorial-shapes',
    N_('Inkscape: Shapes'),
    SECTION_TUTORIAL,
    N_('Using shape tools to create and edit shapes'),
  ],
  ['app.tutorial-advanced', N_('Inkscape: Advanced'), SECTION_TUTORIAL, N_('Advanced Inkscape topics')],
  ['app.tutorial-tracing', N_('Inkscape: Tracing'), SECTION_TUTORIAL, N_('Using bitmap tracing')],
  [
    'app.tutorial-tracing-pixelart',
    N_('Inkscape: Tracing Pixel Art'),
    SECTION_TUTORIAL,
    N_('Using Trace Pixel Art dialog'),
  ],
  [
    'app.tutorial-calligraphy',
    N_('Inkscape: Calligraphy'),
    SECTION_TUTORIAL,
    N_('Using the Calligraphy pen tool'),
  ],
  [
    'app.tutorial-interpolate',
    N_('Inkscape: Interpolate'),
    SECTION_TUTORIAL,
    N_('Using the interpolate extension'),
  ],
  [
    'app.tutorial-design',
    N_('Elements of Design'),
    SECTION_TUTORIAL,
    N_('Principles of design in the tutorial form'),
  ],
  ['app.tutorial-tips', N_('Tips and Tricks'), SECTION_TUTORIAL, N_('Miscellaneous tips and tricks')],
  ['app.about', N_('About Inkscape'), SECTION_TUTORIAL, N_('Inkscape version, authors, license')],
];

/** Open the SVG file at a URL (of share/ or another origin) in a new tab; null if it cannot be read. */
async function open_url_in_window(url: string): Promise<SPDocument | null> {
  const response = await fetch(url);
  const doc = response.ok ? SPDocument.createNewDocFromMem(await response.text(), url) : null;
  if (!doc) return null;
  doc.documentName = url.slice(url.lastIndexOf('/') + 1);
  openDocumentWindow(doc);
  return doc;
}

/** The tutorial files of share/tutorials by action name (upstream help_open_tutorial); the design one is "elements". */
const TUTORIALS: Record<string, string> = {
  'tutorial-basic': 'tutorial-basic',
  'tutorial-shapes': 'tutorial-shapes',
  'tutorial-advanced': 'tutorial-advanced',
  'tutorial-tracing': 'tutorial-tracing',
  'tutorial-tracing-pixelart': 'tutorial-tracing-pixelart',
  'tutorial-calligraphy': 'tutorial-calligraphy',
  'tutorial-interpolate': 'tutorial-interpolate',
  'tutorial-design': 'tutorial-elements',
  'tutorial-tips': 'tutorial-tips',
};

const raw_data_file: readonly (readonly [string, string, string, string])[] = [
  ['app.document-new', N_('New'), SECTION_FILE, N_('Create new document from the default template')],
  ['app.document-open', N_('Open File Dialog'), SECTION_FILE, N_('Open an existing document')],
  ['win.document-close', N_('Close'), SECTION_FILE, N_('Close document (unless last document)')],
  ['app.quit', N_('Quit'), SECTION_FILE, N_('Quit Inkscape, check for data loss')],
  ['win.document-save', N_('Save'), SECTION_FILE, N_('Save document')],
  ['win.document-save-as', N_('Save As'), SECTION_FILE, N_('Save document under a new name')],
  [
    'win.document-save-copy',
    N_('Save a Copy'),
    SECTION_FILE,
    N_('Save a copy of the document under a new name'),
  ],
  ['win.document-import', N_('Import'), SECTION_FILE, N_('Import a bitmap or SVG image into this document')],
  [
    "win.dialog-open('FillStroke')",
    N_('Open Fill and Stroke'),
    SECTION_DIALOG,
    N_("Edit objects' colors, gradients, arrowheads, and other fill and stroke properties..."),
  ],
  [
    "win.dialog-open('Preferences')",
    N_('Open Preferences'),
    SECTION_DIALOG,
    N_('Edit global Inkscape preferences'),
  ],
  ['app.preferences', N_('Open Preferences'), SECTION_DIALOG, N_('Edit global Inkscape preferences')],
  [
    "win.dialog-open('Export')",
    N_('Open Export'),
    SECTION_DIALOG,
    N_('Export this document or a selection as a PNG image'),
  ],
  ["win.dialog-open('Objects')", N_('Open Objects'), SECTION_DIALOG, N_('View Objects')],
  [
    "win.dialog-open('Text')",
    N_('Open Text'),
    SECTION_DIALOG,
    N_('View and select font family, font size and other text properties'),
  ],
  [
    "win.dialog-open('AlignDistribute')",
    N_('Open Align and Distribute'),
    SECTION_DIALOG,
    N_('Align and distribute objects'),
  ],
  [
    "win.dialog-open('DocumentProperties')",
    N_('Open Document Properties'),
    SECTION_DIALOG,
    N_('Edit properties of this document (to be saved with the document)'),
  ],
  [
    "win.dialog-open('Transform')",
    N_('Open Transform'),
    SECTION_DIALOG,
    N_("Precisely control objects' transformations"),
  ],
  [
    "win.dialog-open('ObjectProperties')",
    N_('Open Object Properties'),
    SECTION_DIALOG,
    N_('Edit the object attributes (context dependent)...'),
  ],
  ["win.dialog-open('UndoHistory')", N_('Open Undo History'), SECTION_DIALOG, N_('Undo History')],
  [
    "win.dialog-open('Swatches')",
    N_('Open Swatches'),
    SECTION_DIALOG,
    N_('Select colors from a swatches palette'),
  ],
  [
    "win.dialog-open('Symbols')",
    N_('Open Symbols'),
    SECTION_DIALOG,
    N_('Select symbol from a symbols palette'),
  ],
  [
    "win.dialog-open('CloneTiler')",
    N_('Open Clone Tiler'),
    SECTION_DIALOG,
    N_('Create multiple clones of selected object, arranging them into a pattern or scattering'),
  ],
  [
    "win.dialog-open('FontCollections')",
    N_('Open Font Collections'),
    SECTION_DIALOG,
    N_('Manage Font Collections'),
  ],
  ["win.dialog-open('SVGFonts')", N_('Open SVG Fonts'), SECTION_DIALOG, N_('Edit SVG fonts')],
  [
    "win.dialog-open('XMLEditor')",
    N_('Open XML Editor'),
    SECTION_DIALOG,
    N_('View and edit the XML tree of the document'),
  ],
];

/** Register the file and dialog actions of the web app. Call once at startup. */
export function add_actions_web(app = InkscapeApplication.instance()): void {
  const withDesktop = (run: (dt: SPDesktop) => unknown) => () => {
    const dt = app.get_active_desktop();
    if (dt) void run(dt);
  };

  // Each document opens in a new tab (upstream: a new window).
  app.actions.app.add_action('document-new', () => void document_new());
  app.actions.app.add_action('document-open', async () => {
    const doc = await sp_file_open_dialog();
    if (doc) openDocumentWindow(doc);
  });
  app.actions.app.add_action_with_parameter('open-recent', 's', async (id) => {
    const doc = await sp_file_open_recent(id);
    if (doc) openDocumentWindow(doc);
  });
  app.actions.win.add_action('document-close', () => void document_close_active());
  app.actions.app.add_action('quit', () => void app_quit());
  app.actions.app.add_action('preferences', () => openDialog('Preferences'));
  app.actions.win.add_action(
    'document-save',
    withDesktop((dt) => sp_file_save(dt.doc)),
  );
  app.actions.win.add_action(
    'document-save-as',
    withDesktop((dt) => sp_file_save_as(dt.doc)),
  );
  app.actions.win.add_action(
    'document-save-copy',
    withDesktop((dt) => sp_file_save_a_copy(dt.doc)),
  );
  app.actions.win.add_action(
    'document-import',
    withDesktop((dt) => sp_file_import(dt)),
  );
  const win = app.actions.win;
  const apps = app.actions.app;

  // actions-file.cpp: the files are URLs (of share/ or other origins), not paths.
  apps.add_action_with_parameter('file-open', 's', (url) => void open_url_in_window(url));
  apps.add_action_with_parameter('file-open-window', 's', (url) => void open_url_in_window(url));
  apps.add_action_with_parameter('file-new', 's', (template) => {
    const url = !template
      ? '/share/templates/default.svg'
      : template.includes('/')
        ? template
        : `/share/templates/${template}`;
    void open_url_in_window(url);
  });
  apps.add_action('file-close', () => void document_close_unchecked());

  // actions-window.cpp
  apps.add_action('window-open', () => {
    const doc = app.get_active_document();
    if (doc) openDocumentWindow(doc);
    else show_output('window_open(): failed to find document!');
  });
  apps.add_action('window-close', () => void document_close_unchecked());
  apps.add_action('window-query-geometry', () => {
    show_output(`w:${window.innerWidth}`, false);
    show_output(`h:${window.innerHeight}`, false);
  });
  apps.add_action('quit-immediate', () => window.close());

  // actions-tutorial.cpp
  const ok = [{ id: 'ok', label: _('_OK') }];
  for (const [action, file] of Object.entries(TUTORIALS)) {
    apps.add_action(action, () => {
      void open_url_in_window(`/share/tutorials/${file}.svg`).then((doc) => {
        if (doc) return;
        void showMessageDialog({
          title: _('Tutorial'),
          message: _(
            "The tutorial files are not installed.\nFor Linux, you may need to install 'inkscape-tutorials'; for Windows, please re-run the setup and select 'Tutorials'.\nThe tutorials can also be found online at https://inkscape.org/en/learn/tutorials/",
          ),
          buttons: ok,
          cancel: 'ok',
          default: 'ok',
        });
      });
    });
  }
  apps.add_action('about', () => {
    void showMessageDialog({
      title: _('About Inkscape'),
      message: `Inkscape ${INKSCAPE_VERSION}\n\n${_('Inkscape is a free and open source vector graphics editor.')}\n${_('Released under the GNU General Public License, version 2 or later.')}\nhttps://inkscape.org`,
      buttons: ok,
      cancel: 'ok',
      default: 'ok',
    });
  });

  // actions-file-gui.cpp, actions-view-window.cpp
  win.add_action(
    'document-print',
    withDesktop((dt) => sp_print_document(dt.doc)),
  );
  win.add_action(
    'document-revert',
    withDesktop(async (dt) => {
      const doc = dt.doc;
      const answer = doc.modifiedSinceSave
        ? await showMessageDialog({
            title: _('Revert'),
            message: _('Changes will be lost! Are you sure you want to reload document %1?').replace(
              '%1',
              doc.documentName ?? '',
            ),
            buttons: [
              { id: 'cancel', label: _('_Cancel') },
              { id: 'revert', label: _('_Revert') },
            ],
            cancel: 'cancel',
            default: 'cancel',
          })
        : 'revert';
      if (answer !== 'revert') return;
      const fresh = await sp_file_reload(doc);
      if (!fresh) {
        show_output(_('Document not saved yet.  Cannot revert.'));
        return;
      }
      openDocumentWindow(fresh);
      doc.setModifiedSinceSave(false);
      await document_close_unchecked_of(doc);
    }),
  );
  win.add_action(
    'document-cleanup',
    withDesktop((dt) => {
      const doc = dt.doc;
      const diff = doc.vacuumDocument();
      DocumentUndo.done(doc, C_('Undo', 'Clean up document'), 'document-cleanup');
      show_output(
        diff > 0
          ? ngettext(
              'Removed <b>%i</b> unused definition in &lt;defs&gt;.',
              'Removed <b>%i</b> unused definitions in &lt;defs&gt;.',
              diff,
            ).replace('%i', String(diff))
          : _('No unused definitions in &lt;defs&gt;.'),
        false,
      );
    }),
  );
  win.add_action('window-new', () => void document_new());
  win.add_action('window-next', () => document_tab_step(1));
  win.add_action('window-previous', () => document_tab_step(-1));
  win.add_action('tab-next', () => document_tab_step(1));
  win.add_action('tab-previous', () => document_tab_step(-1));
  app.get_action_extra_data().add_data(raw_data_app);

  // Dialogs that are not ported yet are disabled.
  app.actions.win.add_action_with_parameter('dialog-open', 's', openDialog, hasDialog);
  app.get_action_extra_data().add_data(raw_data_file);
}

/** Run an action by detailed name, e.g. "win.tool-switch('Rect')". */
export function runAction(id: string): void {
  InkscapeApplication.instance().activate_action(id);
}
