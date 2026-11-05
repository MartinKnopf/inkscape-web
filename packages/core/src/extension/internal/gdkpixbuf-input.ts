// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/internal/gdkpixbuf-input.cpp, src/extension/internal/gdkpixbuf-input.h
/*
 * Authors: see git history
 *
 * Copyright (C) 2018 Authors
 */
import { Pixbuf } from '../../display/cairo-utils.ts';
import { SPDocument } from '../../document.ts';
import { DocumentUndo } from '../../document-undo.ts';
import { sp_embed_image } from '../../object/sp-image.ts';
import { Preferences } from '../../preferences.ts';
import { spReprCssAttrNew, spReprCssSet, spReprCssSetProperty } from '../../xml/repr-css.ts';
import { ImageResolution } from './image-resolution.ts';

/** An empty document for the imported image (upstream SPDocument::createNewDoc(nullptr)). */
const EMPTY_DOC =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" ' +
  'xmlns:xlink="http://www.w3.org/1999/xlink"/>';

/**
 * Open the bytes of a bitmap file (PNG, JPEG, GIF, WebP) as a document with
 * one svg:image in a layer (upstream GdkpixbufInput::open). Returns null if
 * the bytes are no image that the browser can show.
 *
 * The size follows the resolution that the file states (ImageResolution) unless the
 * preferences force the default resolution.
 *
 * The image is always embedded as a data: URI: upstream may link the file
 * instead (/dialogs/import/link), but a web page cannot link a local file.
 * TODO: the import dialog (ask, link, dpi, scale), fit_canvas_to_drawing.
 */
export function gdkpixbuf_input_open(bytes: Uint8Array): SPDocument | null {
  const prefs = Preferences.get();
  const forcexdpi = prefs.getBool('/dialogs/import/forcexdpi');
  const scale = prefs.getString('/dialogs/import/scale', 'auto');

  const pb = Pixbuf.create_from_buffer(bytes);
  if (!pb || pb.mime_type === 'image/svg+xml') return null;

  const doc = SPDocument.createNewDocFromMem(EMPTY_DOC);
  if (!doc) return null;
  DocumentUndo.scopedInsensitive(doc, () => {
    let width = pb.width();
    let height = pb.height();
    let xscale = 1;
    let yscale = 1;
    if (!forcexdpi) {
      const ir = new ImageResolution(bytes);
      if (ir.ok()) {
        xscale = 960.0 / Math.round(10.0 * ir.x()); // round-off to 0.1 dpi
        yscale = 960.0 / Math.round(10.0 * ir.y());
        // No division by zero
        if (ir.x() <= 0.05) xscale = 960.0;
        if (ir.y() <= 0.05) yscale = 960.0;
      }
    } else {
      const defaultxdpi = prefs.getDouble('/dialogs/import/defaultxdpi/value', 96);
      xscale = 96.0 / defaultxdpi;
      yscale = 96.0 / defaultxdpi;
    }
    width *= xscale;
    height *= yscale;

    // Create image node
    const xml_doc = doc.getReprDoc();
    const image_node = xml_doc.createElement('svg:image');
    image_node.setAttributeSvgDouble('width', width);
    image_node.setAttributeSvgDouble('height', height);
    // Set default value as we honor "preserveAspectRatio".
    image_node.setAttribute('preserveAspectRatio', 'none');
    // This is actually 'image-rendering'.
    if (scale !== 'auto') {
      const css = spReprCssAttrNew();
      spReprCssSetProperty(css, 'image-rendering', scale);
      spReprCssSet(image_node, css, 'style');
    }
    sp_embed_image(image_node, pb);

    // Add it to the current layer
    const layer_node = xml_doc.createElement('svg:g');
    layer_node.setAttribute('inkscape:groupmode', 'layer');
    layer_node.setAttribute('inkscape:label', 'Image');
    doc.getRoot().appendChildRepr(layer_node);
    layer_node.appendChild(image_node);
  });
  return doc;
}
