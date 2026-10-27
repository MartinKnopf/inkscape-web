// Drive the spike: draw, undo/redo, open examples, measure pan/zoom frame times.
import { chromium } from 'playwright';
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto('http://localhost:5179/');
await page.waitForSelector('button[title=rect]');
const xmlRects = () => page.locator('text=<rect').count();
const box = await page.locator('.dv-groupview').first().boundingBox();
await page.click('button[title=rect]');
for (const [x, y] of [[150, 150], [400, 300]]) {
  await page.mouse.move(box.x + x, box.y + y); await page.mouse.down();
  await page.mouse.move(box.x + x + 120, box.y + y + 80, { steps: 8 }); await page.mouse.up();
}
console.log('after 2 rects, XML editor <rect> rows:', await xmlRects());
await page.keyboard.press('Meta+z');
console.log('after undo:', await xmlRects());
await page.keyboard.press('Meta+Shift+z');
console.log('after redo:', await xmlRects());
await page.click('button[title=select]');
await page.mouse.move(box.x + 200, box.y + 180); await page.mouse.down();
await page.mouse.move(box.x + 300, box.y + 250, { steps: 8 }); await page.mouse.up();
console.log('history:', await page.locator('ol li').allTextContents());
await page.screenshot({ path: 'shot-draw.png' });

for (const name of ['tiger.svgz', 'car.svgz', 'gallardo.svgz']) {
  await page.click(`text=${name}`);
  await page.waitForFunction((n) => window.__lastOpen?.name === n, name);
  const perf = await page.evaluate(() => window.__lastOpen);
  // Pan + zoom for 120 frames, measure frame times.
  const frames = await page.evaluate(async () => {
    const d = window.desktop, times = [];
    let last = performance.now();
    for (let i = 0; i < 120; i++) {
      d.zoom *= i < 60 ? 1.02 : 1 / 1.02; d.pan.x += 2; d.applyView();
      await new Promise(requestAnimationFrame);
      const now = performance.now(); times.push(now - last); last = now;
    }
    times.sort((a, b) => a - b);
    return { median: times[60].toFixed(1), p95: times[114].toFixed(1) };
  });
  // Edit one attribute deep in the tree and commit: measure the full update (incl. React panels).
  const edit = await page.evaluate(async () => {
    const d = window.desktop, t0 = performance.now();
    const walk = (n) => n.children.length ? walk(n.children.at(-1)) : n;
    let target = walk(d.doc.root); while (target.type !== 'element') target = target.parent;
    target.setAttribute('opacity', '0.5'); d.doc.done('edit');
    await new Promise(requestAnimationFrame);
    return (performance.now() - t0).toFixed(1);
  });
  console.log(name, JSON.stringify({ ...perf, fetchMs: +perf.fetchMs.toFixed(1), parseMs: +perf.parseMs.toFixed(1), displayMs: +perf.displayMs.toFixed(1) }), 'pan/zoom frame ms', frames, 'edit+commit ms', edit);
}
await page.screenshot({ path: 'shot-car.png' });
console.log('errors:', errors);
await b.close();
