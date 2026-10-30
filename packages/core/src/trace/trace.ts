// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/trace/trace.cpp, src/trace/trace.h
/*
 * A generic interface for plugging different
 *  autotracers into Inkscape.
 *
 * Authors:
 *   Bob Jamison <rjamison@earthlink.net>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *   PBS <pbs3141@gmail.com>
 *
 * Copyright (C) 2004-2022 Authors
 */
import { type Affine, are_near, type PathVector, Scale, Translate } from '@inkscape-web/geom';
import { DocumentUndo } from '../document-undo.ts';
import { _, C_ } from '../i18n.ts';
import type { ObjectSet } from '../object/object-set.ts';
import { SPImage } from '../object/sp-image.ts';
import { sp_svg_write_path } from '../svg/svg-path.ts';
import type { RgbaImage } from './imagemap-gdk.ts';

export interface TraceResultItem {
  style: string;
  path: PathVector;
}

export type TraceResult = TraceResultItem[];

/** A tracing engine (upstream TracingEngine): trace an image, or a quick preview of its filtering. */
export interface TracingEngine {
  /**
   * This is the working method of this interface, and all implementing classes. Take an
   * image, trace it, and return a style attribute and the path data for each result path.
   */
  trace(pixbuf: RgbaImage): TraceResult;
  /** Generate a quick preview without any actual tracing. */
  preview(pixbuf: RgbaImage): RgbaImage | null;
  /** Return true if the user should be checked with before tracing because the image is too big. */
  check_image_size(size: { x: number; y: number }): boolean;
}

/**
 * Decodes the pixels of an image (upstream: SPImage::pixbuf has them). The editor sets it: the
 * browser decodes images asynchronously.
 */
let imagePixelsLoader: ((image: SPImage) => Promise<RgbaImage | null>) | null = null;

export function setImagePixelsLoader(loader: ((image: SPImage) => Promise<RgbaImage | null>) | null): void {
  imagePixelsLoader = loader;
}

/** The result of trace(): an error message, or the node count and the number of paths. */
export type TraceOutcome = { error: string } | { nodes: number; paths: number };

/**
 * Grab the image from the current selection, performing some validation (upstream
 * getImageAndItems without SIOX). Returns the image or an error message.
 */
export function getImage(sel: ObjectSet): SPImage | string {
  // SIOX not enabled. We want exactly one image selected.
  const item = sel.singleItem();
  if (!(item instanceof SPImage)) return _('Select an <b>image</b> to trace');
  return item;
}

/** Given an SPImage, get the transform from pixbuf coordinates to the document. */
export function getImageTransform(img: SPImage): Affine {
  const x = img.x.computed;
  const y = img.y.computed;
  const w = img.width.computed;
  const h = img.height.computed;

  const iw = img.pixbuf?.width() ?? 1;
  const ih = img.pixbuf?.height() ?? 1;

  const wscale = w / iw;
  const hscale = h / ih;

  return Scale(wscale, hscale).multiply(Translate(x, y)).multiply(img.transform);
}

/** Number of nodes of the paths (upstream count_pathvector_nodes of helper/geom.cpp). */
function count_pathvector_nodes(pathv: PathVector): number {
  let tot = 0;
  for (const path of pathv) {
    // count_path_curves: an almost degenerate closing segment is not counted.
    let curves = path.empty() ? 0 : path.size();
    const closing = path.closingSegment();
    if (path.closed() && !closing.isDegenerate() && are_near(closing.initialPoint(), closing.finalPoint())) {
      curves -= 1;
    }
    // count_path_nodes: an open path has one node more than curves.
    tot += curves + (path.closed() ? 0 : 1);
  }
  return tot;
}

async function loadImage(image: SPImage): Promise<RgbaImage | string> {
  if (!image.pixbuf || !imagePixelsLoader) return _('Trace: Image has no bitmap data');
  const pixels = await imagePixelsLoader(image);
  return pixels ?? _('Trace: Image has no bitmap data');
}

/**
 * Trace the selected image with engine and put the result above it: a path, or a group of paths
 * if there are several; it is selected (upstream TraceTask: launch, do_async_work and
 * do_final_work). The image is decoded asynchronously; the tracing runs synchronously.
 * TODO: SIOX, progress and cancelling, a worker thread.
 */
export async function trace(engine: TracingEngine, selection: ObjectSet): Promise<TraceOutcome> {
  const image = getImage(selection);
  if (typeof image === 'string') return { error: image };
  const doc = image.document;
  doc.ensureUpToDate();

  const pixbuf = await loadImage(image);
  if (typeof pixbuf === 'string') return { error: pixbuf };

  // Actually perform the tracing.
  const traceresult = engine.trace(pixbuf);

  // The image may have been deleted while it was decoded.
  const imgRepr = image.getRepr();
  const par = imgRepr.parent();
  if (!par || traceresult.length === 0) return { nodes: 0, paths: 0 };

  // Update the image transform - it may have changed from its initial value.
  const image_transform = getImageTransform(image);

  // OK. Now let's start making new nodes.
  const xml_doc = doc.getReprDoc();
  let groupRepr = null;

  // If more than one path, make a <g>roup of <path>s.
  const nrPaths = traceresult.length;
  if (nrPaths > 1) {
    groupRepr = xml_doc.createElement('svg:g');
    par.addChild(groupRepr, imgRepr);
  }

  let totalNodeCount = 0;
  for (const result of traceresult) {
    totalNodeCount += count_pathvector_nodes(result.path);

    const pathRepr = xml_doc.createElement('svg:path');
    pathRepr.setAttributeOrRemoveIfEmpty('style', result.style);
    pathRepr.setAttributeOrRemoveIfEmpty(
      'd',
      sp_svg_write_path(result.path.map((p) => p.transformed(image_transform))),
    );

    if (groupRepr) groupRepr.addChild(pathRepr, null);
    else par.addChild(pathRepr, imgRepr);

    if (nrPaths === 1) {
      const obj = doc.getObjectByRepr(pathRepr);
      selection.clear();
      if (obj) selection.add(obj);
    }
  }

  // If we have a group, then focus on it.
  if (groupRepr) {
    const obj = doc.getObjectByRepr(groupRepr);
    selection.clear();
    if (obj) selection.add(obj);
  }

  // Inform the document, so we can undo.
  DocumentUndo.done(doc, C_('Undo', 'Trace bitmap'), 'bitmap-trace');
  return { nodes: totalNodeCount, paths: nrPaths };
}

/** The preview of the filtering of the selected image (upstream preview()); null if there is none. */
export async function preview(engine: TracingEngine, selection: ObjectSet): Promise<RgbaImage | null> {
  const image = getImage(selection);
  if (typeof image === 'string') return null;
  const pixbuf = await loadImage(image);
  if (typeof pixbuf === 'string') return null;
  return engine.preview(pixbuf);
}
