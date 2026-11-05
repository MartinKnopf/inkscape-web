// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: share/attributes/, share/examples/, share/extensions/, share/filters/, share/icons/, share/keys/, share/markers/, share/paint/, share/palettes/, share/symbols/, share/templates/, share/tutorials/, share/ui/, share/CMakeLists.txt, po, COPYING, AUTHORS, LICENSES/
// Copy runtime data from the upstream checkout into dist/ and convert the
// translations to JSON. The web app serves dist/ as static files, with the
// same paths as upstream (dist/share/icons/... = share/icons/...).
//
// Usage: node build.ts   (upstream checkout: $INKSCAPE_SRC or ../inkscape)
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';
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

// The web has no directory listing: index.json names the palette, symbol, paint and template files (relative to their folder).
const listFiles = (dir: string, ext: string): string[] =>
  (readdirSync(dir, { recursive: true, encoding: 'utf8' }) as string[]).filter((f) => f.endsWith(ext)).sort();
for (const [dir, ext] of [
  ['palettes', '.gpl'],
  ['symbols', '.svg'],
  ['paint', '.svg'],
  ['templates', '.svg'],
] as const) {
  const folder = join(dist, 'share', dir);
  writeFileSync(join(folder, 'index.json'), JSON.stringify(listFiles(folder, ext)));
}

// Python extensions: the files that upstream installs (share/CMakeLists.txt), without the tests
// and docs. index.json names the .inx files; extensions.zip has the files the scripts use, for
// the Pyodide file system (one download instead of hundreds).
const extensionsSkip =
  /(^|\/)(\.git[^/]*|\.gitlab[^/]*|\.pylintrc|\.darglint|\.coveragerc|\.pre-commit-config\.yaml|tests|docs|MANIFEST\.in|pyproject\.toml|Makefile|__pycache__|tox\.ini|setup\.cfg|requirements\.txt|poetry\.lock|[^/]*\.dox|[^/]*\.pyc|[^/]*\.sh|[^/]*\.bat|[^/]*\.md|print_win32_vector\.[^/]*|other\/inkman)$/;
const extensionsSrc = join(upstreamRoot, 'share', 'extensions');
const extensionsDist = join(dist, 'share', 'extensions');
cpSync(extensionsSrc, extensionsDist, {
  recursive: true,
  filter: (src) => !extensionsSkip.test(relative(extensionsSrc, src).split(sep).join('/')),
});
const extensionFiles = (readdirSync(extensionsDist, { recursive: true, encoding: 'utf8' }) as string[])
  .map((f) => f.split(sep).join('/'))
  .filter((f) => statSync(join(extensionsDist, f)).isFile())
  .sort();
writeFileSync(
  join(extensionsDist, 'index.json'),
  JSON.stringify(extensionFiles.filter((f) => f.endsWith('.inx'))),
);
writeFileSync(
  join(extensionsDist, 'extensions.zip'),
  zip(
    extensionFiles
      .filter((f) => !f.startsWith('icons/') && !f.endsWith('.inx'))
      .map((f) => [f, readFileSync(join(extensionsDist, f))]),
  ),
);

/** A zip archive (deflate) of the files [name, data]. */
function zip(files: [string, Buffer][]): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const deflated = deflateRawSync(data);
    const crc = crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4); // version needed
    head.writeUInt16LE(0x0800, 6); // UTF-8 names
    head.writeUInt16LE(8, 8); // deflate
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(deflated.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(nameBuf.length, 26);
    local.push(head, nameBuf, deflated);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(deflated.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBuf.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBuf);
    offset += head.length + nameBuf.length + deflated.length;
  }
  const centralSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
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
console.log(`assets: ${SHARE_DIRS.length + 1} share folders, ${languages.length} languages → ${dist}`);
