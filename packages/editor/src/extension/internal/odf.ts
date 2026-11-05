// SPDX-License-Identifier: LGPL-2.1-or-later
// Upstream: src/extension/internal/odf.cpp, src/extension/internal/odf.h
/*
 * OpenDocument (drawing) output
 *
 * Authors:
 *   Bob Jamison
 *   Abhishek Sharma
 *   Kris De Gussem
 *
 * Copyright (C) 2018 Authors
 * Released under GNU LGPL v2.1+, read the file 'COPYING' for more information.
 */
/*
 * This is an an entry in the extensions mechanism to begin to enable the outputting of
 * OpenDocument Format (ODF) files from within Inkscape.  Although the initial implementations
 * will be very lossy due to the differences in the models of SVG and ODF, they will hopefully
 * improve greatly with time.  People should consider this to be a framework that can be
 * continuously upgraded for ever improving fidelity.  Potential developers should especially
 * look in preprocess() and writeTree() to see how the SVG tree is scanned, read, translated, and
 * then written to ODF.
 */
import {
  formatFixed,
  is_straight_curve,
  N_,
  type Node,
  pathv_to_linear_and_cubic_beziers,
  type SPDocument,
  SPFlowtext,
  SPGradient,
  SPImage,
  SPItem,
  SPLinearGradient,
  SPRadialGradient,
  SPShape,
  SPText,
  te_get_layout,
  ZipFile,
} from '@inkscape-web/core';
import {
  type Affine,
  CubicBezier,
  type OptRect,
  type PathVector,
  Point,
  Scale,
  Translate,
} from '@inkscape-web/geom';
import { INKSCAPE_VERSION } from '../../actions/actions-base.ts';
import { Implementation } from '../implementation/implementation.ts';
import type { Output } from '../output.ts';
import { INKSCAPE_EXTENSION_URI } from '../prefdialog/widget.ts';
import { build_from_mem } from '../system.ts';

/** The ratio of ODF cm to SVG px that upstream uses. */
const pxToCm = 0.03;

/** printf("%.{n}f"). */
const f = (d: number, digits = 3): string => formatFixed(d, digits);

/** The time as ctime() prints it, with a new line: "Thu Nov  5 08:00:00 2026". */
function ctime(date: Date): string {
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][
    date.getMonth()
  ];
  const p2 = (n: number) => String(n).padStart(2, '0');
  const time = `${p2(date.getHours())}:${p2(date.getMinutes())}:${p2(date.getSeconds())}`;
  return `${day} ${month} ${String(date.getDate()).padStart(2, ' ')} ${time} ${date.getFullYear()}\n`;
}

/** The style of an ODF object, for finding identical ones (upstream StyleInfo). */
export class StyleInfo {
  name = 'none';
  stroke = 'none';
  strokeColor = 'none';
  strokeWidth = 'none';
  strokeOpacity = 'none';
  fill = 'none';
  fillColor = 'none';
  fillOpacity = 'none';

  /** Used for eliminating duplicates in the styleTable. */
  equals(other: StyleInfo): boolean {
    return (
      this.stroke === other.stroke &&
      this.strokeColor === other.strokeColor &&
      this.strokeWidth === other.strokeWidth &&
      this.strokeOpacity === other.strokeOpacity &&
      this.fill === other.fill &&
      this.fillColor === other.fillColor &&
      this.fillOpacity === other.fillOpacity
    );
  }
}

export class GradientStop {
  constructor(
    public rgb = 0,
    public opacity = 0,
  ) {}
}

export class GradientInfo {
  name = 'none';
  style = 'none';
  cx = 0.0;
  cy = 0.0;
  fx = 0.0;
  fy = 0.0;
  r = 0.0;
  x1 = 0.0;
  y1 = 0.0;
  x2 = 0.0;
  y2 = 0.0;
  stops: GradientStop[] = [];

  /** Used for eliminating duplicates in the gradientTable. */
  equals(other: GradientInfo): boolean {
    if (
      this.name !== other.name ||
      this.style !== other.style ||
      this.cx !== other.cx ||
      this.cy !== other.cy ||
      this.fx !== other.fx ||
      this.fy !== other.fy ||
      this.r !== other.r ||
      this.x1 !== other.x1 ||
      this.y1 !== other.y1 ||
      this.x2 !== other.x2 ||
      this.y2 !== other.y2
    )
      return false;
    if (this.stops.length !== other.stops.length) return false;
    return this.stops.every(
      (g1, i) => g1.rgb === other.stops[i]!.rgb && g1.opacity === other.stops[i]!.opacity,
    );
  }
}

/**
 * Get some fun facts from the transform: the singular values and the rotation.
 *
 * Upstream calls a singular value decomposition (JAMA) on the 2x2 matrix [[a, b], [c, d]] and
 * takes xscale and yscale as the singular values and "rotate" as element (0, 0) of U * V^T,
 * the orthogonal factor of the polar decomposition. For 2x2 matrices both have closed forms:
 * with p = |(a + d, b - c)| / 2 and q = |(a - d, b + c)| / 2 the singular values are p + q and
 * |p - q|, and the orthogonal factor is a rotation if the determinant is positive (then its
 * element (0, 0) is (a + d) / 2p) and a reflection if it is negative (then (a - d) / 2q).
 */
export function analyzeTransform(tf: Affine): { rotate: number; xscale: number; yscale: number } {
  const { c0: a, c1: b, c2: c, c3: d } = tf;
  const p = Math.hypot(a + d, b - c) / 2;
  const q = Math.hypot(a - d, b + c) / 2;
  const det = a * d - b * c;
  let rotate: number;
  if (det >= 0 && p > 0) rotate = (a + d) / (2 * p);
  else if (q > 0) rotate = (a - d) / (2 * q);
  else rotate = 1;
  return { rotate, xscale: p + q, yscale: Math.abs(p - q) };
}

/** The attribute of node, or the empty string. */
function getAttribute(node: Node, attrName: string): string {
  return node.attribute(attrName) ?? '';
}

function formatTransform(tf: Affine): string {
  if (tf.isIdentity()) return '';
  return `matrix(${f(tf.c0)} ${f(tf.c1)} ${f(tf.c2)} ${f(tf.c3)} ${f(tf.c4)} ${f(tf.c5)})`;
}

/** Get the general transform from SVG pixels to ODF cm. */
function getODFTransform(item: SPItem): Affine {
  return item.i2docAffine().multiply(Scale(pxToCm));
}

/** Get the bounding box of an item, as mapped onto an ODF document, in cm. */
function getODFBoundingBox(item: SPItem): OptRect {
  // TODO: geometric or visual?
  const bbox = item.documentVisualBounds();
  return bbox ? bbox.transformed(Scale(pxToCm)) : null;
}

/** Get the transform for an item, including parents, but without root viewBox transformation. */
function getODFItemTransform(item: SPItem): Affine {
  return item.i2docAffine().multiply(item.document.getRoot().c2p.inverse());
}

function gatherText(node: Node): string {
  let buf = '';
  if (node.type() === 'text') buf += node.content() ?? '';
  for (let child = node.firstChild(); child; child = child.next()) buf += gatherText(child);
  return buf;
}

/** The mime type and bytes of a data: URI; null for other URIs (a web page cannot read files). */
function readDataUri(uri: string): { mime: string; bytes: Uint8Array } | null {
  const m = /^data:([^,;]*)((?:;[^,;]*)*),([\s\S]*)$/i.exec(uri);
  if (!m) return null;
  const base64 = /;base64/i.test(m[2]!);
  const data = m[3]!;
  let bytes: Uint8Array;
  if (base64) {
    const bin = atob(decodeURIComponent(data).replace(/\s/g, ''));
    bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } else {
    bytes = new TextEncoder().encode(decodeURIComponent(data));
  }
  return { mime: m[1]!.toLowerCase() || 'text/plain', bytes };
}

/** Writes an SVG path as an ODF <draw:path> and returns the number of points written (upstream writePath). */
function writePath(
  pathv: PathVector,
  tf: Affine,
  xoff: number,
  yoff: number,
): { text: string; nrPoints: number } {
  let text = '';
  let nrPoints = 0;

  // convert the path to only lineto's and cubic curveto's:
  const m = tf.multiply(Translate(xoff, yoff)).multiply(Scale(1000));
  const pv = pathv_to_linear_and_cubic_beziers(pathv.map((p) => p.transformed(m)));
  // Why is this needed? Shouldn't we just round all numbers then?
  const near0 = (v: number) => (Math.abs(v) < 1.0 ? 0.0 : v);

  for (const pit of pv) {
    text += `M ${f(near0(pit.initialPoint().x))} ${f(near0(pit.initialPoint().y))} `;
    nrPoints++;

    for (const cit of pit.curves()) {
      if (is_straight_curve(cit)) {
        text += `L ${f(near0(cit.finalPoint().x))} ${f(near0(cit.finalPoint().y))} `;
      } else if (cit instanceof CubicBezier) {
        const points = cit.controlPoints();
        const [p1, p2, p3] = [points[1]!, points[2]!, points[3]!];
        text += `C ${f(near0(p1.x))} ${f(near0(p1.y))} ${f(near0(p2.x))} ${f(near0(p2.y))} ${f(near0(p3.x))} ${f(near0(p3.y))} `;
      } else {
        throw new Error('logical error, because pathv_to_linear_and_cubic_beziers was used');
      }
      nrPoints++;
    }

    if (pit.closed()) text += 'Z';
  }
  return { text, nrPoints };
}

const NAMESPACES_STYLES = [
  ['office', 'urn:oasis:names:tc:opendocument:xmlns:office:1.0'],
  ['style', 'urn:oasis:names:tc:opendocument:xmlns:style:1.0'],
  ['text', 'urn:oasis:names:tc:opendocument:xmlns:text:1.0'],
  ['table', 'urn:oasis:names:tc:opendocument:xmlns:table:1.0'],
  ['draw', 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0'],
  ['fo', 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0'],
  ['xlink', 'http://www.w3.org/1999/xlink'],
  ['dc', 'http://purl.org/dc/elements/1.1/'],
  ['meta', 'urn:oasis:names:tc:opendocument:xmlns:meta:1.0'],
  ['number', 'urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0'],
  ['presentation', 'urn:oasis:names:tc:opendocument:xmlns:presentation:1.0'],
  ['svg', 'urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0'],
  ['chart', 'urn:oasis:names:tc:opendocument:xmlns:chart:1.0'],
  ['dr3d', 'urn:oasis:names:tc:opendocument:xmlns:dr3d:1.0'],
  ['math', 'http://www.w3.org/1998/Math/MathML'],
  ['form', 'urn:oasis:names:tc:opendocument:xmlns:form:1.0'],
  ['script', 'urn:oasis:names:tc:opendocument:xmlns:script:1.0'],
  ['ooo', 'http://openoffice.org/2004/office'],
  ['ooow', 'http://openoffice.org/2004/writer'],
  ['oooc', 'http://openoffice.org/2004/calc'],
  ['dom', 'http://www.w3.org/2001/xml-events'],
  ['xforms', 'http://www.w3.org/2002/xforms'],
  ['xsd', 'http://www.w3.org/2001/XMLSchema'],
  ['xsi', 'http://www.w3.org/2001/XMLSchema-instance'],
  ['smil', 'urn:oasis:names:tc:opendocument:xmlns:smil-compatible:1.0'],
  ['anim', 'urn:oasis:names:tc:opendocument:xmlns:animation:1.0'],
] as const;

/** The banner comment that every file starts with. */
function fileBanner(file: string): string {
  return (
    '<!--\n' +
    '*************************************************************************\n' +
    `  file:  ${file}\n` +
    `  Generated by Inkscape: ${ctime(new Date())}` + // ctime has its own <cr>
    '  http://www.inkscape.org\n' +
    '*************************************************************************\n' +
    '-->\n'
  );
}

/** OpenDocument drawing output (upstream OdfOutput). */
export class OdfOutput extends Implementation {
  // cc or dc metadata name/value pairs
  #metadata = new Map<string, string>();

  /*
   * Style table. Uses a two-stage lookup to avoid style duplication. Use like:
   * StyleInfo si = styleTable[styleLookupTable[id]];
   * but check for errors, of course
   */
  // element id -> style entry name
  #styleLookupTable = new Map<string, string>();
  // style entry name -> style info
  #styleTable: StyleInfo[] = [];
  // element id -> gradient entry name
  #gradientLookupTable = new Map<string, string>();
  // gradient entry name -> gradient info
  #gradientTable: GradientInfo[] = [];
  // for renaming image file names
  #imageTable = new Map<string, string>();

  /**
   * FIRST PASS.
   * Method descends into the repr tree, converting image, style, and gradient info into forms
   * compatible in ODF.
   */
  #preprocess(zf: ZipFile, doc: SPDocument, node: Node): void {
    const nodeName = node.name();

    // First, check for metadata
    if (nodeName === 'metadata' || nodeName === 'svg:metadata') {
      const mchild = node.firstChild();
      if (mchild?.name() !== 'rdf:RDF') return;
      const rchild = mchild.firstChild();
      if (rchild?.name() !== 'cc:Work') return;
      for (let cchild = rchild.firstChild(); cchild; cchild = cchild.next()) {
        this.#metadata.set(cchild.name(), gatherText(cchild));
      }
      return;
    }

    // Now consider items.
    const reprobj = doc.getObjectByRepr(node);
    if (!(reprobj instanceof SPItem)) return;

    if (nodeName === 'image' || nodeName === 'svg:image') {
      const href = getAttribute(node, 'xlink:href');
      if (href.length > 0 && !this.#imageTable.has(href)) {
        // A web page cannot read files: only embedded images are packed.
        const image = readDataUri(href);
        if (!image?.mime.startsWith('image/')) return;
        const ext = image.mime.slice(6);
        const newName = `Pictures/image${this.#imageTable.size}.${ext}`;
        this.#imageTable.set(href, newName);
        zf.newEntry(newName, '').setUncompressedData(image.bytes);
      }
    }

    for (let child = node.firstChild(); child; child = child.next()) this.#preprocess(zf, doc, child);
  }

  /**
   * Writes the manifest. Currently it only changes according to the file names of images packed
   * into the zip file.
   */
  #writeManifest(zf: ZipFile): boolean {
    let outs = '';
    outs += '<?xml version="1.0" encoding="UTF-8"?>\n';
    outs += '<!DOCTYPE manifest:manifest PUBLIC "-//OpenOffice.org//DTD Manifest 1.0//EN" "Manifest.dtd">\n';
    outs += '\n\n';
    outs += fileBanner('manifest.xml');
    outs += '\n\n';
    outs += '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0">\n';
    outs +=
      '    <manifest:file-entry manifest:media-type="application/vnd.oasis.opendocument.graphics" manifest:full-path="/"/>\n';
    outs += '    <manifest:file-entry manifest:media-type="text/xml" manifest:full-path="content.xml"/>\n';
    outs += '    <manifest:file-entry manifest:media-type="text/xml" manifest:full-path="styles.xml"/>\n';
    outs += '    <manifest:file-entry manifest:media-type="text/xml" manifest:full-path="meta.xml"/>\n';
    outs += '    <!--List our images here-->\n';
    for (const newName of [...this.#imageTable.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, v]) => v)) {
      // note: mime subtype was added as file extension in OdfOutput::preprocess
      const mimesubtype = newName.slice(newName.lastIndexOf('.') + 1);
      outs += `    <manifest:file-entry manifest:media-type="image/${mimesubtype}" manifest:full-path="${newName}"/>\n`;
    }
    outs += '</manifest:manifest>\n';

    zf.newEntry('META-INF/manifest.xml', 'ODF file manifest').setUncompressedData(outs);
    return true;
  }

  /** This writes the document meta information to meta.xml. */
  #writeMeta(zf: ZipFile): boolean {
    const InkscapeVersion = `Inkscape.org - ${INKSCAPE_VERSION}`;
    const creator = this.#metadata.get('dc:creator') ?? InkscapeVersion;

    const now = new Date();
    const p2 = (n: number) => String(n).padStart(2, '0');
    const moddate = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())} ${p2(now.getHours())}:${p2(now.getMinutes())}:${p2(now.getSeconds())}`;
    const date = this.#metadata.get('dc:date') ?? moddate;

    let outs = '<?xml version="1.0" encoding="UTF-8"?>\n\n';
    outs += fileBanner('meta.xml');
    outs += '\n';
    outs += '<office:document-meta\n';
    outs += 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"\n';
    outs += 'xmlns:xlink="http://www.w3.org/1999/xlink"\n';
    outs += 'xmlns:dc="http://purl.org/dc/elements/1.1/"\n';
    outs += 'xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0"\n';
    outs += 'xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0"\n';
    outs += 'xmlns:ooo="http://openoffice.org/2004/office"\n';
    outs += 'xmlns:smil="urn:oasis:names:tc:opendocument:xmlns:smil-compatible:1.0"\n';
    outs += 'xmlns:anim="urn:oasis:names:tc:opendocument:xmlns:animation:1.0"\n';
    outs += 'office:version="1.0">\n';
    outs += '<office:meta>\n';
    outs += `    <meta:generator>${InkscapeVersion}</meta:generator>\n`;
    outs += `    <meta:initial-creator>${creator}</meta:initial-creator>\n`;
    outs += `    <meta:creation-date>${date}</meta:creation-date>\n`;
    outs += `    <dc:date>${moddate}</dc:date>\n`;
    for (const [name, value] of [...this.#metadata.entries()].sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    )) {
      if (name && value) outs += `    <${name}>${value}</${name}>\n`;
    }
    outs += '</office:meta>\n';
    outs += '</office:document-meta>\n';

    zf.newEntry('meta.xml', 'ODF info file').setUncompressedData(outs);
    return true;
  }

  /**
   * Writes the style of the item to the style file unless an identical style exists; the text
   * of the new style, or the empty string (upstream processStyle).
   */
  #processStyle(item: SPItem, id: string, gradientNameFill: string, gradientNameStroke: string): string {
    const style = item.style;
    const si = new StyleInfo();
    const hex2 = (n: number) => n.toString(16).padStart(2, '0');

    // FILL
    if (style.fill.isColor()) {
      const fillCol = style.fill.getColor().toRGBA();
      si.fillColor = `#${hex2((fillCol >>> 24) & 0xff)}${hex2((fillCol >>> 16) & 0xff)}${hex2((fillCol >>> 8) & 0xff)}`;
      si.fill = 'solid';
      si.fillOpacity = `${f(100.0 * style.fill_opacity.as_double())}%`;
    } else if (style.fill.isPaintserver()) {
      if (style.getFillPaintServer() instanceof SPGradient) si.fill = 'gradient';
    }

    // STROKE
    if (style.stroke.isColor()) {
      const strokeCol = style.stroke.getColor().toRGBA();
      si.strokeColor = `#${hex2((strokeCol >>> 24) & 0xff)}${hex2((strokeCol >>> 16) & 0xff)}${hex2((strokeCol >>> 8) & 0xff)}`;
      si.strokeWidth = `${f(style.stroke_width.value)}pt`;
      si.stroke = 'solid';
      si.strokeOpacity = `${f(100.0 * style.stroke_opacity.as_double())}%`;
    } else if (style.stroke.isPaintserver()) {
      if (style.getStrokePaintServer() instanceof SPGradient) si.stroke = 'gradient';
    }

    // Look for existing identical style;
    const match = this.#styleTable.find((s) => si.equals(s));
    if (match) {
      // map to existing styleTable entry
      this.#styleLookupTable.set(id, match.name);
      return '';
    }

    si.name = `style${this.#styleTable.length}`;
    this.#styleTable.push(si);
    this.#styleLookupTable.set(id, si.name);

    let output = `<style:style style:name="${si.name}" style:family="graphic" style:parent-style-name="standard">\n`;
    output += '<style:graphic-properties';
    if (si.fill === 'gradient') {
      output += ` draw:fill="gradient" draw:fill-gradient-name="${gradientNameFill}"`;
    } else {
      output += ` draw:fill="${si.fill}"`;
      if (si.fill !== 'none') output += ` draw:fill-color="${si.fillColor}"`;
    }
    if (si.stroke === 'gradient') {
      // does not seem to be supported by Open Office.org
      output += ` draw:stroke="gradient" draw:stroke-gradient-name="${gradientNameStroke}"`;
    } else {
      output += ` draw:stroke="${si.stroke}"`;
      if (si.stroke !== 'none')
        output += ` svg:stroke-width="${si.strokeWidth}" svg:stroke-color="${si.strokeColor}" `;
    }
    output += '/>\n</style:style>\n';
    return output;
  }

  /**
   * Writes the gradient of the fill or stroke of the item unless an identical one exists;
   * returns the name of the gradient (empty if the item has none) and the text of the new
   * gradient (upstream processGradient).
   */
  #processGradient(item: SPItem, id: string, checkFillGradient: boolean): { name: string; output: string } {
    const none = { name: '', output: '' };
    const style = item.style;

    if (checkFillGradient ? !style.fill.isPaintserver() : !style.stroke.isPaintserver()) return none;

    // Gradient
    const gradient = checkFillGradient ? style.getFillPaintServer() : style.getStrokePaintServer();
    if (!(gradient instanceof SPGradient)) return none;

    const gi = new GradientInfo();
    const grvec = gradient.getVector(false);
    for (let stop = grvec.getFirstStop(); stop; stop = stop.getNextStop()) {
      // TODO: Replace these with a color object to support more than RGB.
      // (Upstream passes false as the opacity here, which makes the color end in "00"; the
      // 24 bit RGB value is what the style needs.)
      const color = stop.getColor();
      gi.stops.push(new GradientStop(color.toRGBA() >>> 8, color.getOpacity()));
    }

    let gradientName2: string;
    if (gradient instanceof SPLinearGradient) {
      gi.style = 'linear';
      gi.x1 = gradient.x1.value;
      gi.y1 = gradient.y1.value;
      gi.x2 = gradient.x2.value;
      gi.y2 = gradient.y2.value;
      gradientName2 = `ImportedLinearGradient${this.#gradientTable.length}`;
    } else if (gradient instanceof SPRadialGradient) {
      gi.style = 'radial';
      const bbox = item.documentVisualBounds();
      if (!bbox) return none;
      gi.cx = (gradient.cx.value - bbox.left()) / bbox.width();
      gi.cy = (gradient.cy.value - bbox.top()) / bbox.height();
      gradientName2 = `ImportedRadialGradient${this.#gradientTable.length}`;
    } else {
      console.warn('not a supported gradient type');
      return none;
    }

    // Look for existing identical style;
    const match = this.#gradientTable.find((g) => gi.equals(g));
    if (match) {
      // map to existing gradientTable entry
      this.#gradientLookupTable.set(id, match.name);
      return { name: match.name, output: '' };
    }

    // No match, let us write a new entry
    gi.name = gradientName2;
    this.#gradientTable.push(gi);
    this.#gradientLookupTable.set(id, gi.name);

    const hex6 = (n: number) => n.toString(16).padStart(6, '0');
    let output = '';
    if (gi.style === 'linear') {
      /*
       * LINEAR gradient.  We need something that looks like this:
       * <draw:gradient draw:name="Gradient_20_7"
       *     draw:display-name="Gradient 7"
       *     draw:style="linear"
       *     draw:start-color="#008080" draw:end-color="#993366"
       *     draw:start-intensity="100%" draw:end-intensity="100%"
       *     draw:angle="150" draw:border="0%"/>
       */
      if (gi.stops.length < 2) {
        console.warn('Need at least 2 stops for a linear gradient');
        return { name: gi.name, output: '' };
      }
      output += `<draw:gradient draw:name="${gi.name}"`;
      output += ` draw:display-name="${gi.name}"`;
      output += ' draw:style="linear"';
      output += ` draw:start-color="#${hex6(gi.stops[0]!.rgb)}" draw:end-color="#${hex6(gi.stops[1]!.rgb)}"`;
      // TODO: apply maths, to define begin of gradient, taking gradient begin and end, as well as object boundary into account
      let angle = gi.y2 - gi.y1;
      angle = angle !== 0 ? (Math.atan((gi.x2 - gi.x1) / (gi.y2 - gi.y1)) * 180) / Math.PI : 90;
      angle = angle < 0 ? 180 + angle : angle;
      angle = angle * 10; // why do we need this: precision?????????????
      output += ` draw:start-intensity="${gi.stops[0]!.opacity * 100.0}" draw:end-intensity="${gi.stops[1]!.opacity * 100.0}" draw:angle="${angle}"/>\n`;
    } else {
      /*
       * RADIAL gradient.  We need something that looks like this:
       * <!-- radial gradient, light gray to white, centered, 0% border -->
       * <draw:gradient draw:name="radial_20_borderless"
       *     draw:display-name="radial borderless"
       *     draw:style="radial"
       *     draw:cx="50%" draw:cy="50%"
       *     draw:start-color="#999999" draw:end-color="#ffffff"
       *     draw:border="0%"/>
       */
      if (gi.stops.length < 2) {
        console.warn('Need at least 2 stops for a radial gradient');
        return { name: gi.name, output: '' };
      }
      const pad5 = (d: number) => f(d).padStart(5, '0');
      output += `<draw:gradient draw:name="${gi.name}" draw:display-name="${gi.name}" `;
      output += `draw:style="radial" draw:cx="${pad5(gi.cx * 100)}" draw:cy="${pad5(gi.cy * 100)}" `;
      output += `draw:start-color="#${hex6(gi.stops[0]!.rgb)}" draw:end-color="#${hex6(gi.stops[1]!.rgb)}" `;
      output += `draw:start-intensity="${f(gi.stops[0]!.opacity * 100.0, 6)}%" draw:end-intensity="${f(gi.stops[1]!.opacity * 100.0, 6)}%" `;
      output += '/>\n';
    }
    return { name: gi.name, output };
  }

  /**
   * SECOND PASS.
   * This is the main SPObject tree output to ODF. couts gets the content, souts the styles.
   */
  #writeTree(couts: { s: string }, souts: { s: string }, doc: SPDocument, node: Node): boolean {
    // Get the SPItem, if applicable
    const item = doc.getObjectByRepr(node);
    if (!(item instanceof SPItem)) return true;

    const nodeName = node.name();
    const id = getAttribute(node, 'id');
    const tf = getODFTransform(item); // Get SVG-to-ODF transform
    const bbox = getODFBoundingBox(item); // Get ODF bounding box params for item
    if (!bbox) return true;

    const bbox_x = bbox.min().x;
    const bbox_y = bbox.min().y;
    const bbox_width = bbox.width();
    const bbox_height = bbox.height();

    const { xscale, yscale } = analyzeTransform(tf);

    // Do our stuff
    if (nodeName === 'svg' || nodeName === 'svg:svg') {
      // Iterate through the children
      for (let child = node.firstChild(); child; child = child.next()) {
        if (!this.#writeTree(couts, souts, doc, child)) return false;
      }
      return true;
    }
    if (nodeName === 'g' || nodeName === 'svg:g') {
      couts.s += id ? `<draw:g id="${id}">\n` : '<draw:g>\n';
      // Iterate through the children
      for (let child = node.firstChild(); child; child = child.next()) {
        if (!this.#writeTree(couts, souts, doc, child)) return false;
      }
      couts.s += id ? `</draw:g> <!-- id="${id}" -->\n` : '</draw:g>\n';
      return true;
    }

    // GRADIENT
    const fillGradient = this.#processGradient(item, id, true);
    const strokeGradient = this.#processGradient(item, id, false);
    souts.s += fillGradient.output;
    souts.s += strokeGradient.output;

    // STYLE
    souts.s += this.#processStyle(item, id, fillGradient.name, strokeGradient.name);

    // ITEM DATA
    if (nodeName === 'image' || nodeName === 'svg:image') {
      if (!(item instanceof SPImage)) {
        console.warn('<image> is not an SPImage.');
        return false;
      }

      let ix = item.x.value;
      let iy = item.y.value;
      let iwidth = item.width.value;
      let iheight = item.height.value;

      const ibbox_min = new Point(ix, iy).transformed(tf);
      ix = ibbox_min.x;
      iy = ibbox_min.y;
      iwidth = xscale * iwidth;
      iheight = yscale * iheight;

      const itemTransformString = formatTransform(getODFItemTransform(item));

      const href = getAttribute(node, 'xlink:href');
      const newName = this.#imageTable.get(href);
      if (newName === undefined) {
        console.warn(`image '${href}' not in table`);
        return false;
      }

      couts.s += '<draw:frame ';
      if (id) couts.s += `id="${id}" `;
      couts.s += 'draw:style-name="gr1" draw:text-style-name="P1" draw:layer="layout" ';
      // no x or y.  make them the translate transform, last one
      couts.s += `svg:width="${f(iwidth)}cm" svg:height="${f(iheight)}cm" `;
      if (itemTransformString) {
        couts.s += `draw:transform="${itemTransformString} translate(${f(ix)}cm, ${f(iy)}cm)" `;
      } else {
        couts.s += `draw:transform="translate(${f(ix)}cm, ${f(iy)}cm)" `;
      }

      couts.s += '>\n';
      couts.s += `    <draw:image xlink:href="${newName}" xlink:type="simple"\n`;
      couts.s += '        xlink:show="embed" xlink:actuate="onLoad">\n';
      couts.s += '        <text:p/>\n';
      couts.s += '    </draw:image>\n';
      couts.s += '</draw:frame>\n';
      return true;
    }

    const process_curve = (curve: PathVector) => {
      // Default <path> output
      couts.s += '<draw:path ';
      if (id) couts.s += `id="${id}" `;

      const styleName = this.#styleLookupTable.get(id);
      if (styleName !== undefined) couts.s += `draw:style-name="${styleName}" `;

      couts.s += `draw:layer="layout" svg:x="${f(bbox_x)}cm" svg:y="${f(bbox_y)}cm" `;
      couts.s += `svg:width="${f(bbox_width)}cm" svg:height="${f(bbox_height)}cm" `;
      couts.s += `svg:viewBox="0.0 0.0 ${f(bbox_width * 1000.0)} ${f(bbox_height * 1000.0)}"`;

      const { text, nrPoints } = writePath(curve, tf, bbox_x, bbox_y);
      couts.s += ` svg:d="${text}"`;

      couts.s += '>\n';
      couts.s += `    <!-- ${nrPoints} nodes -->\n`;
      couts.s += '</draw:path>\n\n';
    };

    if (item instanceof SPShape) {
      const curve = item.curve();
      if (curve) process_curve(curve);
    } else if (item instanceof SPText || item instanceof SPFlowtext) {
      const layout = te_get_layout(item);
      if (layout) process_curve(layout.convertToCurves());
    }

    return true;
  }

  /** The start of the style file (upstream writeStyleHeader). */
  #writeStyleHeader(): string {
    let outs = '<?xml version="1.0" encoding="UTF-8"?>\n\n';
    outs += fileBanner('styles.xml');
    outs += '\n';
    outs += '<office:document-styles\n';
    for (const [prefix, uri] of NAMESPACES_STYLES) outs += `    xmlns:${prefix}="${uri}"\n`;
    outs += '    office:version="1.0">\n';
    outs += '\n';
    outs += '<!--\n';
    outs += '*************************************************************************\n';
    outs += '  S T Y L E S\n';
    outs += '  Style entries have been pulled from the svg style and\n';
    outs += '  representation attributes in the SVG tree.  The tree elements\n';
    outs += '  then refer to them by name, in the ODF manner\n';
    outs += '*************************************************************************\n';
    outs += '-->\n';
    outs += '\n';
    outs += '<office:styles>\n';
    outs += '\n';
    return outs;
  }

  /** The end of the style file (upstream writeStyleFooter). */
  #writeStyleFooter(): string {
    return (
      '\n' +
      '</office:styles>\n' +
      '\n' +
      '<office:automatic-styles>\n' +
      "<!-- ####### 'Standard' styles ####### -->\n" +
      '<style:style style:name="dp1" style:family="drawing-page"/>\n' +
      '<style:style style:name="standard" style:family="graphic">\n' +
      // TODO: add default document style here
      '</style:style>\n' +
      '<style:style style:name="gr1" style:family="graphic" style:parent-style-name="standard">\n' +
      '  <style:graphic-properties draw:stroke="none" draw:fill="none"\n' +
      '       draw:textarea-horizontal-align="center"\n' +
      '       draw:textarea-vertical-align="middle" draw:color-mode="standard"\n' +
      '       draw:luminance="0%" draw:contrast="0%" draw:gamma="100%" draw:red="0%"\n' +
      '       draw:green="0%" draw:blue="0%" fo:clip="rect(0cm 0cm 0cm 0cm)"\n' +
      '       draw:image-opacity="100%" style:mirror="none"/>\n' +
      '</style:style>\n' +
      '<style:style style:name="P1" style:family="paragraph">\n' +
      '  <style:paragraph-properties fo:text-align="center"/>\n' +
      '</style:style>\n' +
      '</office:automatic-styles>\n' +
      '\n' +
      '<office:master-styles>\n' +
      '<draw:layer-set>\n' +
      '    <draw:layer draw:name="layout"/>\n' +
      '    <draw:layer draw:name="background"/>\n' +
      '    <draw:layer draw:name="backgroundobjects"/>\n' +
      '    <draw:layer draw:name="controls"/>\n' +
      '    <draw:layer draw:name="measurelines"/>\n' +
      '</draw:layer-set>\n' +
      '\n' +
      '<style:master-page style:name="Default"\n' +
      '    style:page-master-name="PM1" draw:style-name="dp1"/>\n' +
      '</office:master-styles>\n' +
      '\n' +
      '</office:document-styles>\n'
    );
  }

  /** The start of the content file (upstream writeContentHeader). */
  #writeContentHeader(): string {
    let outs = '<?xml version="1.0" encoding="UTF-8"?>\n\n';
    outs += fileBanner('content.xml');
    outs += '\n';
    outs += '<office:document-content\n';
    for (const [prefix, uri] of NAMESPACES_STYLES) outs += `    xmlns:${prefix}="${uri}"\n`;
    outs += '    office:version="1.0">\n';
    outs += '<office:scripts/>\n';
    outs += '\n';
    outs += '<!--\n';
    outs += '*************************************************************************\n';
    outs += '  D R A W I N G\n';
    outs += '  This section is the heart of SVG-ODF conversion.  We are\n';
    outs += '  starting with simple conversions, and will slowly evolve\n';
    outs += "  into a 'smarter' translation as time progresses.  Any help\n";
    outs += '  in improving .odg export is welcome.\n';
    outs += '*************************************************************************\n';
    outs += '-->\n';
    outs += '\n';
    outs += '<office:body>\n';
    outs += '<office:drawing>\n';
    outs += '<draw:page draw:name="page1" draw:style-name="dp1"\n';
    outs += '        draw:master-page-name="Default">\n';
    outs += '\n';
    return outs;
  }

  /** The end of the content file (upstream writeContentFooter). */
  #writeContentFooter(): string {
    return (
      '\n' +
      '</draw:page>\n' +
      '</office:drawing>\n' +
      '\n' +
      '<!-- ######### CONVERSION FROM SVG ENDS ######## -->\n' +
      '\n' +
      '</office:body>\n' +
      '</office:document-content>\n'
    );
  }

  /** Write the content.xml and styles.xml files (upstream writeContent). */
  #writeContent(zf: ZipFile, doc: SPDocument): boolean {
    const couts = { s: this.#writeContentHeader() };
    const souts = { s: this.#writeStyleHeader() };

    // Descend into the tree, doing all of our conversions to both files at the same time
    if (!this.#writeTree(couts, souts, doc, doc.getReprRoot())) {
      console.warn('Failed to convert SVG tree');
      return false;
    }

    // Finish content file
    couts.s += this.#writeContentFooter();
    zf.newEntry('content.xml', 'ODF master content file').setUncompressedData(couts.s);

    // Finish style file
    souts.s += this.#writeStyleFooter();
    zf.newEntry('styles.xml', 'ODF style file').setUncompressedData(souts.s);
    return true;
  }

  /** Resets class to its pristine condition, ready to use again. */
  #reset(): void {
    this.#metadata.clear();
    this.#styleTable = [];
    this.#styleLookupTable.clear();
    this.#gradientTable = [];
    this.#gradientLookupTable.clear();
    this.#imageTable.clear();
  }

  /** Descends into the SVG tree, mapping things to ODF when appropriate. */
  override async save(_mod: Output, doc: SPDocument, _filename: string): Promise<Uint8Array | null> {
    this.#reset();
    doc.ensureUpToDate();

    const zf = new ZipFile();
    this.#preprocess(zf, doc, doc.getReprRoot());

    if (!this.#writeManifest(zf)) {
      console.warn('Failed to write manifest');
      return null;
    }
    if (!this.#writeContent(zf, doc)) {
      console.warn('Failed to write content');
      return null;
    }
    if (!this.#writeMeta(zf)) {
      console.warn('Failed to write metafile');
      return null;
    }
    return zf.writeBuffer();
  }

  /** The definition of OpenDocument Drawing output (upstream OdfOutput::init). */
  static init(): void {
    build_from_mem(
      `<inkscape-extension xmlns="${INKSCAPE_EXTENSION_URI}">\n` +
        `<name>${N_('OpenDocument Drawing Output')}</name>\n` +
        '<id>org.inkscape.output.odf</id>\n' +
        '<output>\n' +
        '<extension>.odg</extension>\n' +
        '<mimetype>application/vnd.oasis.opendocument.graphics</mimetype>\n' +
        `<filetypename>${N_('OpenDocument drawing (*.odg)')}</filetypename>\n` +
        `<filetypetooltip>${N_('OpenDocument drawing file')}</filetypetooltip>\n` +
        '</output>\n' +
        '</inkscape-extension>',
      new OdfOutput(),
    );
  }
}
