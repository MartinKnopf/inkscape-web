// Spike: render SVG files in Chromium (live SVG DOM, as the app would do) and
// compare them with reference PNGs rendered by Inkscape.
//
// Usage: tsx render.ts <cases.json> <outDir>
// cases.json: [{ name, svg, ref, dpi }]
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import * as fontkit from 'fontkit';

type Case = { name: string; svg: string; ref: string; dpi: number };

const [casesFile, outDir] = process.argv.slice(2);
const cases: Case[] = JSON.parse(readFileSync(casesFile, 'utf8'));
mkdirSync(outDir, { recursive: true });

// @font-face rules for the upstream rendering-test fonts (Inkscape uses an
// isolated fontconfig with this folder).
function fontFaces(dir: string): string {
  const rules: string[] = [];
  for (const f of readdirSync(dir)) {
    if (!/\.(ttf|otf)$/i.test(f)) continue;
    try {
      const font = fontkit.openSync(join(dir, f)) as fontkit.Font;
      const os2 = (font as any)['OS/2'];
      const weight = os2?.usWeightClass ?? 400;
      const italic = /italic/i.test(font.subfamilyName) ? 'italic' : 'normal';
      rules.push(
        `@font-face{font-family:"${font.familyName}";src:url("${pathToFileURL(join(dir, f))}");font-weight:${weight};font-style:${italic}}`,
      );
    } catch {}
  }
  return rules.join('\n');
}

const fontsDir = resolve(process.env.HOME!, 'dev/inkscape/testfiles/rendering_tests/fonts');
const faces = fontFaces(fontsDir);

function readSvg(path: string): string {
  const buf = readFileSync(path);
  return (buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf).toString('utf8');
}

// Flatten RGBA onto white so transparent backgrounds compare equal.
function onWhite(png: PNG): PNG {
  const d = png.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255;
    d[i] = d[i] * a + 255 * (1 - a);
    d[i + 1] = d[i + 1] * a + 255 * (1 - a);
    d[i + 2] = d[i + 2] * a + 255 * (1 - a);
    d[i + 3] = 255;
  }
  return png;
}

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
const results: any[] = [];

for (const c of cases) {
  const ref = onWhite(PNG.sync.read(readFileSync(c.ref)));
  const { width, height } = ref;
  await page.setViewportSize({ width: Math.max(width, 10), height: Math.max(height, 10) });
  const base = pathToFileURL(dirname(c.svg) + '/').href;
  // Load from a file:// URL so relative @import / external refs can resolve.
  const tmp = resolve(outDir, '_page.html');
  writeFileSync(tmp, `<!doctype html><html><head><base href="${base}"><style>${faces}\nhtml,body{margin:0;background:white}</style></head><body></body></html>`);
  await page.goto(pathToFileURL(tmp).href);
  const errors: string[] = [];
  page.removeAllListeners('pageerror');
  page.on('pageerror', (e) => errors.push(String(e)));
  // Parse as XML (like the app's own parser would) and import into the HTML DOM.
  const ok = await page.evaluate(
    ({ text, width, height }) => {
      const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
      if (doc.querySelector('parsererror')) return 'parsererror';
      if (doc.documentElement.namespaceURI !== 'http://www.w3.org/2000/svg') return 'not-svg-ns';
      const svg = document.importNode(doc.documentElement, true) as unknown as SVGSVGElement;
      if (!svg.getAttribute('viewBox')) {
        // Without viewBox, user units are px at 96 dpi.
        document.body.appendChild(svg);
        const w = svg.width.baseVal.value, h = svg.height.baseVal.value;
        svg.remove();
        svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      }
      svg.setAttribute('width', String(width));
      svg.setAttribute('height', String(height));
      svg.style.display = 'block';
      document.body.appendChild(svg);
      return 'ok';
    },
    { text: readSvg(c.svg), width, height },
  );
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  const t0 = performance.now();
  let raw: Buffer;
  try {
    raw = await page.screenshot({ clip: { x: 0, y: 0, width, height }, timeout: 180000 });
  } catch (e) {
    console.log(`  ERROR  ${c.name}: ${String(e).split('\n')[0]}`);
    results.push({ name: c.name, error: String(e).split('\n')[0] });
    continue;
  }
  const ms = Math.round(performance.now() - t0);
  const shot = onWhite(PNG.sync.read(raw));
  const diff = new PNG({ width, height });
  const bad = pixelmatch(ref.data, shot.data, diff.data, width, height, { threshold: 0.15 });
  const pct = (100 * bad) / (width * height);
  writeFileSync(join(outDir, `${c.name}.web.png`), PNG.sync.write(shot));
  writeFileSync(join(outDir, `${c.name}.diff.png`), PNG.sync.write(diff));
  results.push({ name: c.name, size: `${width}x${height}`, diffPct: +pct.toFixed(2), ms, status: ok, errors });
  console.log(`${pct.toFixed(2).padStart(7)}%  ${String(ms).padStart(6)}ms  ${c.name}${ok !== 'ok' ? '  ' + ok : ''}`);
}

writeFileSync(join(outDir, 'results.json'), JSON.stringify(results, null, 2));
await browser.close();
