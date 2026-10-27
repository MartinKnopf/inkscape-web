// SPDX-License-Identifier: GPL-2.0-or-later
// List upstream commits since the last sync that touch code we have ported.
//
//   pnpm upstream:diff                 commits from sync.json..HEAD of the upstream checkout
//   pnpm upstream:diff --from <rev>    start at another commit instead of sync.json
//   pnpm upstream:diff --mark-synced   after review: write upstream HEAD into sync.json
//
// Our files name their sources in a header ("Upstream: src/a.cpp, src/b/").
// A path that ends with "/" matches everything below it. Submodule updates
// (for example src/3rdparty/2geom) show up as a change of the submodule path.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkUpstream, git, repoRoot, sync, upstreamReferences } from './upstream.ts';

checkUpstream();
const head = git('rev-parse', 'HEAD').trim();

if (process.argv.includes('--mark-synced')) {
  writeFileSync(
    join(repoRoot, 'upstream/sync.json'),
    `${JSON.stringify({ ...sync, commit: head }, null, 2)}\n`,
  );
  console.log(`sync.json → ${head}`);
  process.exit(0);
}

const fromArg = process.argv.indexOf('--from');
const from = fromArg > 0 ? process.argv[fromArg + 1]! : sync.commit;
const refs = upstreamReferences();
const ourFilesFor = (path: string): string[] =>
  [...refs].flatMap(([ref, files]) =>
    ref === path || (ref.endsWith('/') && path.startsWith(ref)) || path.startsWith(`${ref}/`) ? files : [],
  );

// One record per commit: "<hash> <subject>" followed by the changed paths.
const log = git('log', '--reverse', '--format=%x00%h %s', '--name-only', `${from}..${head}`);
const commits = log
  .split('\0')
  .filter(Boolean)
  .map((block) => {
    const [title = '', ...paths] = block.trim().split('\n');
    return { title, paths: paths.filter(Boolean) };
  });

const byFile = new Map<string, string[]>();
let unrelated = 0;
for (const c of commits) {
  const files = new Set(c.paths.flatMap(ourFilesFor));
  if (!files.size) unrelated++;
  for (const f of files) byFile.set(f, [...(byFile.get(f) ?? []), c.title]);
}

console.log(`Upstream ${from.slice(0, 10)}..${head.slice(0, 10)}: ${commits.length} commits`);
console.log(`${commits.length - unrelated} touch ported code, ${unrelated} touch only unported code.\n`);
for (const [file, titles] of [...byFile].sort()) {
  console.log(file);
  for (const t of titles) console.log(`  ${t}`);
}
