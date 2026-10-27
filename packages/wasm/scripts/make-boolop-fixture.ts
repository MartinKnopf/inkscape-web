// SPDX-License-Identifier: GPL-2.0-or-later
// Generate src/fixtures/boolop.json: boolean-op results from the Inkscape CLI,
// used by boolop.test.ts. Run again after an upstream change to path ops:
//   INKSCAPE_BIN=/path/to/inkscape node scripts/make-boolop-fixture.ts
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const inkscape = process.env.INKSCAPE_BIN ?? '/Applications/Inkscape.app/Contents/MacOS/inkscape';

const circle = (cx: number, cy: number, r: number) => {
  const k = 0.5523 * r;
  return `M ${cx + r},${cy} C ${cx + r},${cy + k} ${cx + k},${cy + r} ${cx},${cy + r} C ${cx - k},${cy + r} ${cx - r},${cy + k} ${cx - r},${cy} C ${cx - r},${cy - k} ${cx - k},${cy - r} ${cx},${cy - r} C ${cx + k},${cy - r} ${cx + r},${cy - k} ${cx + r},${cy} Z`;
};
const star = (cx: number, cy: number, R: number, r: number, n: number) =>
  `M ${Array.from({ length: 2 * n }, (_, i) => {
    const a = (Math.PI * i) / n;
    const rr = i % 2 ? r : R;
    return `${(cx + rr * Math.cos(a)).toFixed(3)},${(cy + rr * Math.sin(a)).toFixed(3)}`;
  }).join(' L ')} Z`;

const shapes: [string, string, string][] = [
  ['circles', circle(50, 50, 40), circle(80, 60, 35)],
  ['star-circle', star(60, 60, 50, 20, 7), circle(70, 50, 30)],
  ['self-intersecting', 'M 10,10 L 90,90 L 90,10 L 10,90 Z', circle(50, 50, 25)],
];
const actions = ['path-union', 'path-intersection', 'path-difference', 'path-exclusion'];

const dir = mkdtempSync(join(tmpdir(), 'boolop-'));
const cases = [];
for (const [name, bottom, top] of shapes) {
  for (const action of actions) {
    writeFileSync(
      join(dir, 'in.svg'),
      `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><path d="${bottom}"/><path d="${top}"/></svg>`,
    );
    const out = join(dir, 'out.svg');
    execFileSync(inkscape, [
      join(dir, 'in.svg'),
      `--actions=select-all;${action};export-filename:${out};export-plain-svg;export-do`,
    ]);
    const result = / d="([^"]+)"/.exec(readFileSync(out, 'utf8'))?.[1];
    cases.push({ name, action, bottom, top, result });
  }
}
const version = execFileSync(inkscape, ['--version'], { encoding: 'utf8' }).trim();
const target = join(dirname(fileURLToPath(import.meta.url)), '../src/fixtures/boolop.json');
writeFileSync(target, `${JSON.stringify({ generatedBy: version, cases }, null, 2)}\n`);
console.log(`${cases.length} cases → ${target}`);
