// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/manipulation/copy-resource.cpp, src/manipulation/copy-resource.h
/*
 * Copy a resource (pattern, gradient, ...) from one document to the defs of another.
 */
import type { SPDocument } from '../document.ts';
import type { SPObject } from '../object/sp-object.ts';
import { extractUri } from '../style-internal.ts';
import { getHrefAttribute } from '../xml/href-attribute-helper.ts';

/** The object of an "url(#id)" or "#id" reference in doc. */
function objectByHref(doc: SPDocument, href: string | null): SPObject | null {
  if (!href) return null;
  const uri = href.startsWith('url(') ? extractUri(href).uri : href;
  return uri.startsWith('#') ? doc.getObjectById(uri.slice(1)) : null;
}

/** Copy the resources that the fill, stroke and clip-path of source and its descendants use. */
function copy_style_links(source: SPObject, src_document: SPDocument, dest_document: SPDocument): void {
  const style = source.getAttribute('style') ?? '';
  for (const property of ['fill', 'stroke']) {
    const value =
      new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`).exec(style)?.[1] ?? source.getAttribute(property);
    if (value?.includes('url(')) sp_copy_resource(objectByHref(src_document, value), dest_document);
  }
  const clip = source.getAttribute('clip-path');
  if (clip) sp_copy_resource(objectByHref(src_document, clip), dest_document);
  for (const child of source.children) copy_style_links(child, src_document, dest_document);
}

/**
 * Copy source (an object of another document) into the defs of dest_document, with the objects
 * that it references (href, fill, stroke, clip-path). Returns the copy.
 */
export function sp_copy_resource(source: SPObject | null, dest_document: SPDocument): SPObject | null {
  const dest_defs = dest_document.getDefs();
  if (!source?.document || !dest_defs) return null;
  // make a copy of the 'source' object
  const src_doc = source.document;
  const repr = source.getRepr().duplicate(dest_document.getReprDoc());
  dest_defs.getRepr().appendChild(repr);
  const object = dest_document.getObjectByRepr(repr);
  if (!object) return null;
  // if 'source' references another object, copy it too
  const [, href] = getHrefAttribute(repr);
  if (href && !objectByHref(dest_document, href))
    sp_copy_resource(objectByHref(src_doc, href), dest_document);
  // check fill and stroke for references to other objects, like gradients, and copy them too
  copy_style_links(source, src_doc, dest_document);
  return object;
}
