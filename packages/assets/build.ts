// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: share/attributes/, share/examples/, share/filters/, share/icons/, share/keys/, share/markers/, share/paint/, share/palettes/, share/symbols/, share/templates/, share/tutorials/, share/ui/, po, COPYING, AUTHORS, LICENSES/
// Copy runtime data from the upstream checkout into dist/ and convert the
// translations to JSON. The web app serves dist/ as static files, with the
// same paths as upstream (dist/share/icons/... = share/icons/...).
//
// Usage: node build.ts   (upstream checkout: $INKSCAPE_SRC or ../inkscape)
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { po } from 'gettext-parser';
import { checkUpstream, git, upstreamRoot } from '../../upstream/scripts/upstream.ts';
import type { Catalog } from '../core/src/i18n.ts';

const dist = join(dirname(fileURLToPath(import.meta.url)), 'dist');

/** Folders of upstream share/ that the app uses at runtime. */
const SHARE_DIRS = [
  'attributes',
  'examples',
  'filters',
  'icons',
  'keys',
  'markers',
  'paint',
  'palettes',
  'symbols',
  'templates',
  'tutorials',
  'ui',
];

/** Build files and helper scripts that are not runtime data. */
const skip = (path: string) => /(CMakeLists\.txt|\.py|\.pl|\.h|\.in|README|TRANSLATING)$/.test(path);

checkUpstream();
rmSync(dist, { recursive: true, force: true });

for (const dir of SHARE_DIRS) {
  cpSync(join(upstreamRoot, 'share', dir), join(dist, 'share', dir), {
    recursive: true,
    filter: (src) => !skip(src),
  });
}

// The web has no directory listing: index.json names the palette and symbol files (relative to their folder).
const listFiles = (dir: string, ext: string): string[] =>
  (readdirSync(dir, { recursive: true, encoding: 'utf8' }) as string[]).filter((f) => f.endsWith(ext)).sort();
for (const [dir, ext] of [
  ['palettes', '.gpl'],
  ['symbols', '.svg'],
] as const) {
  const folder = join(dist, 'share', dir);
  writeFileSync(join(folder, 'index.json'), JSON.stringify(listFiles(folder, ext)));
}

// Translations: po/<lang>.po → po/<lang>.json
mkdirSync(join(dist, 'po'));
const languages: string[] = [];
for (const file of readdirSync(join(upstreamRoot, 'po')).filter((f) => f.endsWith('.po'))) {
  const lang = basename(file, '.po');
  const parsed = po.parse(readFileSync(join(upstreamRoot, 'po', file)));
  const catalog: Catalog = { pluralForms: parsed.headers['Plural-Forms'] ?? '', messages: {} };
  for (const [context, entries] of Object.entries(parsed.translations)) {
    for (const [msgid, entry] of Object.entries(entries)) {
      if (!msgid || entry.comments?.flag?.includes('fuzzy')) continue;
      const strings = entry.msgstr.filter(Boolean);
      if (!strings.length) continue;
      const key = context ? `${context}\u0004${msgid}` : msgid;
      catalog.messages[key] = entry.msgid_plural ? entry.msgstr : (entry.msgstr[0] ?? '');
    }
  }
  writeFileSync(join(dist, 'po', `${lang}.json`), JSON.stringify(catalog));
  languages.push(lang);
}

// Upstream license and author information for the copied data.
cpSync(join(upstreamRoot, 'LICENSES'), join(dist, 'LICENSES'), { recursive: true });
for (const f of ['COPYING', 'AUTHORS']) cpSync(join(upstreamRoot, f), join(dist, f));

const manifest = { upstreamCommit: git('rev-parse', 'HEAD').trim(), languages: languages.sort() };
writeFileSync(join(dist, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`assets: ${SHARE_DIRS.length} share folders, ${languages.length} languages → ${dist}`);
