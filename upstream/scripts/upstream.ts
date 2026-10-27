// SPDX-License-Identifier: GPL-2.0-or-later
// Shared helpers for scripts that read the upstream Inkscape checkout.
// The checkout is at $INKSCAPE_SRC, or ../inkscape next to this repository.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export interface SyncInfo {
  repository: string;
  branch: string;
  /** Last upstream commit that we have reviewed and synced. */
  commit: string;
}

export const sync: SyncInfo = JSON.parse(readFileSync(join(repoRoot, 'upstream/sync.json'), 'utf8'));

export const upstreamRoot = resolve(process.env.INKSCAPE_SRC ?? join(repoRoot, '../inkscape'));

/** Run git in the upstream checkout and return stdout. */
export function git(...args: string[]): string {
  return execFileSync('git', ['-C', upstreamRoot, ...args], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
}

/** Fail with a clear message if the checkout is missing; warn if HEAD differs from sync.json. */
export function checkUpstream(): void {
  if (!existsSync(join(upstreamRoot, 'src/document.cpp'))) {
    throw new Error(`Upstream Inkscape checkout not found at ${upstreamRoot}. Set INKSCAPE_SRC.`);
  }
  const head = git('rev-parse', 'HEAD').trim();
  if (head !== sync.commit) {
    console.warn(
      `warning: upstream HEAD ${head.slice(0, 10)} differs from sync.json ${sync.commit.slice(0, 10)}`,
    );
  }
}

/** All files below `dir` (absolute paths), skipping node_modules and generated folders. */
export function walk(dir: string, filter: (path: string) => boolean = () => true): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'build' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, filter));
    else if (filter(p)) out.push(p);
  }
  return out;
}

/** Our source files (packages/*, apps/*). */
export function ourSources(): string[] {
  return ['packages', 'apps'].flatMap((d) => walk(join(repoRoot, d), (p) => /\.(ts|tsx|cpp|h|sh)$/.test(p)));
}

/**
 * Map of upstream path → our files that name it in an "Upstream:" header.
 * Header format (first comment block of a file):
 *   // Upstream: src/object/sp-rect.cpp, src/object/sp-rect.h
 * A path that ends with "/" stands for everything below it.
 */
export function upstreamReferences(): Map<string, string[]> {
  const refs = new Map<string, string[]>();
  for (const file of ourSources()) {
    const head = readFileSync(file, 'utf8').split('\n').slice(0, 20).join('\n');
    for (const m of head.matchAll(/Upstream:\s*([^\n]+)/g)) {
      // Each comma-separated part starts with a path; the rest is a note ("src/a.h enum Foo").
      for (const path of m[1]!
        .split(',')
        .map((s) => s.trim().split(/\s+/)[0]!)
        .filter(Boolean)) {
        const list = refs.get(path) ?? [];
        list.push(relative(repoRoot, file));
        refs.set(path, list);
      }
    }
  }
  return refs;
}
