// SPDX-License-Identifier: GPL-2.0-or-later
import { Affine, Path, Point, Rect, Scale, Translate } from '@inkscape-web/geom';
import { loadCairo } from '@inkscape-web/wasm/cairo';
import { beforeAll, describe, expect, it } from 'vitest';
import { SPDocument } from '../../document.ts';
import type { SPItem } from '../../object/sp-item.ts';
import { CairoPsLevel, setCairoBackend } from './cairo-backend.ts';
import { CairoPaintOrder, type CairoRenderContext } from './cairo-render-context.ts';
import { CairoRenderer, compute_final_page_dimensions } from './cairo-renderer.ts';
import { pdfMediaBoxes, pdfText } from './pdf-test-utils.ts';

beforeAll(async () => {
  setCairoBackend(await loadCairo());
});

function pdfContext(level = 1): CairoRenderContext {
  const ctx = new CairoRenderer().createContext();
  ctx.setPDFLevel(level);
  ctx.setPdfTarget();
  expect(ctx.setupSurface(100, 50)).toBe(true);
  return ctx;
}

function finish(ctx: CairoRenderContext): Uint8Array {
  expect(ctx.finish()).toBe(true);
  const out = ctx.getOutput();
  if (!out) throw new Error('no output');
  return out;
}

function item(svg: string, id: string): SPItem {
  const doc = SPDocument.createNewDocFromMem(`<svg xmlns="http://www.w3.org/2000/svg">${svg}</svg>`);
  if (!doc) throw new Error('parse failed');
  doc.ensureUpToDate();
  return doc.getObjectById(id) as SPItem;
}

describe('CairoRenderContext', () => {
  it('writes the PDF version and the page size in pt', () => {
    const v15 = finish(pdfContext(1));
    expect(new TextDecoder().decode(v15.subarray(0, 8))).toBe('%PDF-1.5');
    expect(pdfMediaBoxes(v15)).toEqual([[0, 0, 100, 50]]);
    const v14 = finish(pdfContext(0));
    expect(new TextDecoder().decode(v14.subarray(0, 8))).toBe('%PDF-1.4');
  });

  it('writes PostScript with the level, and EPS with a bounding box', async () => {
    const ctx = new CairoRenderer().createContext();
    ctx.setPSLevel(CairoPsLevel.LEVEL_2);
    ctx.setEPS(true);
    ctx.setPsTarget();
    ctx.setupSurface(72, 36);
    await ctx.renderPathVector(
      [Path.fromRect(new Rect(0, 0, 96, 48))],
      item('<rect id="r" width="1" height="1" style="fill:#000"/>', 'r').style,
      null,
    );
    const ps = new TextDecoder().decode(finish(ctx));
    expect(ps.startsWith('%!PS-Adobe-3.0 EPSF-3.0')).toBe(true);
    expect(ps).toContain('%%LanguageLevel: 2');
    expect(ps).toContain('%%BoundingBox: 0 0 72 36');
  });

  it('scales px to pt on vector targets and ignores singular transforms', () => {
    const ctx = pdfContext();
    const pt = 72 / 96;
    expect(ctx.getTransform().isNear(Scale(pt, pt))).toBe(true);
    ctx.pushState();
    ctx.transform(Translate(10, 0));
    ctx.transform(new Affine(0, 0, 0, 0, 0, 0)); // not invertible: ignored
    expect(ctx.getCurrentState().transform.isNear(Translate(10, 0).multiply(Scale(pt, pt)))).toBe(true);
    ctx.popState();
    expect(ctx.getTransform().isNear(Scale(pt, pt))).toBe(true);
    finish(ctx);
  });

  it('merges the opacity into the paint only for a fill without stroke', () => {
    const ctx = pdfContext();
    ctx.pushState();
    ctx.setStateForStyle(item('<rect id="r" style="opacity:0.5;fill:red"/>', 'r').style);
    expect(ctx.getCurrentState().merge_opacity).toBe(true);
    expect(ctx._mergedOpacity(0.8)).toBeCloseTo(0.4);
    ctx.popState();
    ctx.pushState();
    ctx.setStateForStyle(item('<rect id="r" style="opacity:0.5;fill:red;stroke:blue"/>', 'r').style);
    expect(ctx.getCurrentState().merge_opacity).toBe(false);
    ctx.popState();
    finish(ctx);
  });

  it('fills and strokes a path with the style', async () => {
    const ctx = pdfContext();
    const style = item(
      '<rect id="r" style="fill:#ff0000;stroke:#0000ff;stroke-width:4;stroke-dasharray:2,1;stroke-linejoin:round"/>',
      'r',
    ).style;
    const path = Path.fromRect(new Rect(10, 10, 50, 30));
    await ctx.renderPathVector([path], style, null, CairoPaintOrder.STROKE_OVER_FILL);
    const content = pdfText(finish(ctx));
    expect(content).toContain('1 0 0 rg'); // red fill
    expect(content).toContain('0 0 1 RG'); // blue stroke
    expect(content).toContain('3 w'); // 4 px in pt
    expect(content).toContain('[ 1.5 0.75] 0 d'); // dashes in pt
    expect(content).toMatch(/\b1 j\b/); // round join
    expect(content).toContain('7.5 7.5 30 15 re B'); // fill and stroke
  });

  it('renders a linear gradient as a PDF shading', async () => {
    const it = item(
      `<defs><linearGradient id="g"><stop offset="0" style="stop-color:#ff0000"/><stop offset="1" style="stop-color:#0000ff"/></linearGradient></defs>
       <rect id="r" width="10" height="10" style="fill:url(#g)"/>`,
      'r',
    );
    const ctx = pdfContext();
    await ctx.renderPathVector([Path.fromRect(new Rect(0, 0, 10, 10))], it.style, it.geometricBounds());
    const content = pdfText(finish(ctx));
    expect(content).toMatch(/\/ShadingType 2/);
  });

  it('renders a pattern as a tiling pattern', async () => {
    const it = item(
      `<defs><pattern id="p" width="10" height="10" patternUnits="userSpaceOnUse"><circle cx="5" cy="5" r="3" style="fill:#aa00aa"/></pattern></defs>
       <rect id="r" width="40" height="40" style="fill:url(#p)"/>`,
      'r',
    );
    const ctx = pdfContext();
    await ctx.renderPathVector([Path.fromRect(new Rect(0, 0, 40, 40))], it.style, it.geometricBounds());
    const content = pdfText(finish(ctx));
    expect(content).toMatch(/\/PatternType 1/);
    expect(content).toContain('0.666667 0 0.666667 rg'); // the circle of the tile
  });

  it('renders a hatch as a tiling pattern of its stroked paths', async () => {
    const it = item(
      '<defs><hatch id="h" hatchUnits="userSpaceOnUse" pitch="10" rotate="45" style="stroke:#ff0000;stroke-width:2"><hatchpath/></hatch></defs>' +
        '<rect id="r" width="40" height="40" style="fill:url(#h)"/>',
      'r',
    );
    const ctx = pdfContext();
    await ctx.renderPathVector([Path.fromRect(new Rect(0, 0, 40, 40))], it.style, it.geometricBounds());
    const content = pdfText(finish(ctx));
    expect(content).toMatch(/\/PatternType 1/);
    expect(content).toContain('1 0 0 RG'); // the red stroke of the hatch path
  });

  it('renders a mesh gradient as a PDF patch mesh shading', async () => {
    const it = item(
      '<defs><meshgradient id="m" x="0" y="0" gradientUnits="userSpaceOnUse"><meshrow><meshpatch>' +
        '<stop path="l 40,0" style="stop-color:#ff0000"/><stop path="l 0,40" style="stop-color:#00ff00"/>' +
        '<stop path="l -40,0" style="stop-color:#0000ff"/><stop path="l 0,-40" style="stop-color:#ffffff"/>' +
        '</meshpatch></meshrow></meshgradient></defs><rect id="r" width="40" height="40" style="fill:url(#m)"/>',
      'r',
    );
    const ctx = pdfContext();
    await ctx.renderPathVector([Path.fromRect(new Rect(0, 0, 40, 40))], it.style, it.geometricBounds());
    expect(pdfText(finish(ctx))).toMatch(/\/ShadingType 7/);
  });
});

describe('compute_final_page_dimensions', () => {
  it('rounds up, except for values just above an integer', () => {
    expect(compute_final_page_dimensions(new Rect(0, 0, 595.2756, 841.0000001))).toEqual(new Point(596, 841));
  });
});
