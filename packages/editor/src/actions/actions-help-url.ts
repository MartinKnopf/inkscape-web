// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-help-url.cpp, src/actions/actions-help-url.h
/*
 * Actions for opening the help pages of inkscape.org.
 *
 * Authors:
 *   Sushant A A <sushant.co19@gmail.com>
 *
 * Copyright (C) 2021 Authors
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { _, N_, NC_ } from '@inkscape-web/core';
import type { InkscapeApplication } from '../inkscape-application.ts';
import { INKSCAPE_VERSION } from './actions-base.ts';

const SECTION = NC_('Action Section', 'Help Url');

/** Action id, label, section and tooltip (untranslated). */
export const raw_data_help_url: readonly (readonly [string, string, string, string])[] = [
  ['win.help-url-ask-question', N_('Ask Us a Question'), SECTION, N_('Ask Us a Question')],
  ['win.help-url-man', N_('Command Line Options'), SECTION, N_('Command Line Options')],
  ['win.help-url-faq', N_('FAQ'), SECTION, N_('FAQ')],
  ['win.help-url-keys', N_('Keys and Mouse Reference'), SECTION, N_('Keys and Mouse Reference')],
  ['win.help-url-release-notes', N_('New in This Version'), SECTION, N_('New in This Version')],
  ['win.help-url-report-bug', N_('Report a Bug'), SECTION, N_('Report a Bug')],
  ['win.help-url-manual', N_('Inkscape Manual'), SECTION, N_('Inkscape Manual')],
  ['win.help-url-beginners-guide', N_("Beginners' Guide"), SECTION, N_("Beginners' Guide")],
  ['win.help-url-inkex', N_('Extension Development Guide'), SECTION, N_('Extension Development Guide')],
  ['win.help-url-donate', N_('Donate'), SECTION, N_('Donate to Inkscape')],
  ['win.help-url-svg11-spec', N_('SVG 1.1 Specification'), SECTION, N_('SVG 1.1 Specification')],
  ['win.help-url-svg2-spec', N_('SVG 2 Specification'), SECTION, N_('SVG 2 Specification')],
];

/** Open an URL in a new tab. */
function help_open_url(url: string): void {
  if (!window.open(url, '_blank', 'noopener')) console.warn(`Unable to show '${url}'`);
}

export function add_actions_help_url(app: InkscapeApplication): void {
  const lang = _('en'); // TODO: strip /en/ for English version?
  const version = INKSCAPE_VERSION;
  const development_version = version.endsWith('-dev'); // this detection is not perfect but should be close enough
  const [major, minor] = version.split('.');
  const branch = development_version ? 'master' : `${major}.${minor}.x`;

  const urls: Record<string, string> = {
    'help-url-ask-question': `https://inkscape.org/${lang}/community/`,
    'help-url-man': `https://inkscape.org/${lang}/doc/inkscape-man-${branch}.html`,
    'help-url-faq': `https://inkscape.org/${lang}/learn/faq/`,
    'help-url-keys': `https://inkscape.org/${lang}/doc/keys-${branch}.html`,
    'help-url-release-notes': `https://inkscape.org/${lang}/release/inkscape-${development_version ? 'master' : version}`,
    'help-url-report-bug': `https://inkscape.org/${lang}/contribute/report-bugs/`,
    'help-url-manual': 'https://inkscape.org/manual',
    'help-url-beginners-guide': 'https://inkscape.org/manual/beginners_guide',
    'help-url-inkex': 'https://inkscape.org/manual/inkex',
    'help-url-donate': `https://inkscape.org/${lang}/donate#lang=${lang}&version=${version}`,
    'help-url-svg11-spec': 'http://www.w3.org/TR/SVG11/',
    'help-url-svg2-spec': 'http://www.w3.org/TR/SVG2/',
  };
  for (const [name, url] of Object.entries(urls)) app.actions.win.add_action(name, () => help_open_url(url));
  app.get_action_extra_data().add_data(raw_data_help_url);
}
