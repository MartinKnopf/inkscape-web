// Compare WASM boolops with Inkscape CLI results and measure speed.
import createModule from './dist/geom.mjs';
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const M = await createModule();
const INK = '/Applications/Inkscape.app/Contents/MacOS/inkscape';
const circle = (cx, cy, r) => { const k = 0.5523 * r;
  return `M ${cx + r},${cy} C ${cx + r},${cy + k} ${cx + k},${cy + r} ${cx},${cy + r} C ${cx - k},${cy + r} ${cx - r},${cy + k} ${cx - r},${cy} C ${cx - r},${cy - k} ${cx - k},${cy - r} ${cx},${cy - r} C ${cx + k},${cy - r} ${cx + r},${cy - k} ${cx + r},${cy} Z`; };
const star = (cx, cy, R, r, n) => 'M ' + Array.from({ length: 2 * n }, (_, i) => {
  const a = Math.PI * i / n, rr = i % 2 ? r : R; return `${(cx + rr * Math.cos(a)).toFixed(3)},${(cy + rr * Math.sin(a)).toFixed(3)}`; }).join(' L ') + ' Z';
const cases = [
  ['circles', circle(50, 50, 40), circle(80, 60, 35)],
  ['star-circle', star(60, 60, 50, 20, 7), circle(70, 50, 30)],
  ['self-x', 'M 10,10 L 90,90 L 90,10 L 10,90 Z', circle(50, 50, 25)],
];
const ops = [['union', 0, 'path-union'], ['inters', 1, 'path-intersection'], ['diff', 2, 'path-difference'], ['xor', 3, 'path-exclusion']];
const dir = mkdtempSync(join(tmpdir(), 'boolop-'));
// Compare as point sets: round numbers to 2 decimals.
const norm = (d) => M.normalize(d).split(/(?=M)/).map((s) => s.trim()).sort().join('|');
for (const [name, a, b] of cases) for (const [opn, op, action] of ops) {
  const wasm = op === 2 ? M.boolop(b, a, op, 1, 1) : M.boolop(a, b, op, 1, 1); // upstream passes (top, bottom) for difference
  // Inkscape: bottom object is A (path-difference = bottom minus top).
  writeFileSync(join(dir, 'in.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><path id="a" d="${a}"/><path id="b" d="${b}"/></svg>`);
  execFileSync(INK, [join(dir, 'in.svg'), `--actions=select-all;${action};export-filename:${join(dir, 'out.svg')};export-plain-svg;export-do`], { stdio: 'ignore' });
  const ink = readFileSync(join(dir, 'out.svg'), 'utf8').match(/ d="([^"]+)"/)[1];
  const same = norm(wasm) === norm(ink);
  console.log(`${same ? 'SAME' : 'DIFF'}  ${name}/${opn}  wasm=${wasm.length}ch ink=${ink.length}ch`);
  if (!same) console.log('   wasm:', wasm.slice(0, 160), '\n   ink: ', ink.slice(0, 160));
}
// Speed
const big = star(500, 500, 400, 150, 200), big2 = circle(520, 480, 300);
let t = performance.now(); for (let i = 0; i < 50; i++) M.boolop(big, big2, 0, 1, 1);
console.log(`boolop 400-node star ∪ circle: ${((performance.now() - t) / 50).toFixed(2)} ms/op`);
const small = circle(50, 50, 40);
t = performance.now(); for (let i = 0; i < 100000; i++) M.nearest(i % 100, 30, small);
console.log(`tiny call (parse + nearestTime): ${((performance.now() - t) * 1000 / 100000).toFixed(2)} µs/call`);
