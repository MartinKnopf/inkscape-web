// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/xml/repr-util.cpp, src/xml/repr.h
/*
 * Authors:
 *   Lauris Kaplinski <lauris@ximian.com>
 *   Juliusz Chroboczek <jch@pps.jussieu.fr>
 *   Abhishek Sharma
 *
 * Copyright (C) 1999-2000 Lauris Kaplinski
 * Copyright (C) 2000-2001 Ximian, Inc.
 * g++ port Copyright (C) 2003 Nathan Hurst
 */
import type { Node } from './node.ts';

export const SODIPODI_NS_URI = 'http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd';
export const BROKEN_SODIPODI_NS_URI = 'http://inkscape.sourceforge.net/DTD/sodipodi-0.dtd';
export const INKSCAPE_NS_URI = 'http://www.inkscape.org/namespaces/inkscape';
export const XLINK_NS_URI = 'http://www.w3.org/1999/xlink';
export const SVG_NS_URI = 'http://www.w3.org/2000/svg';
export const RDF_NS_URI = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
export const CC_NS_URI = 'http://creativecommons.org/ns#';
export const OLD_CC_NS_URI = 'http://web.resource.org/cc/';
export const DC_NS_URI = 'http://purl.org/dc/elements/1.1/';

/**
 * Known namespaces as [uri, prefix]. URI → prefix lookups use the first match,
 * prefix → URI lookups too, so the old URIs at the end only map to the prefix.
 * New namespaces from files are added at the front, as upstream does.
 */
const namespaces: [uri: string, prefix: string][] = [
  [SODIPODI_NS_URI, 'sodipodi'],
  [XLINK_NS_URI, 'xlink'],
  [SVG_NS_URI, 'svg'],
  [INKSCAPE_NS_URI, 'inkscape'],
  [RDF_NS_URI, 'rdf'],
  [CC_NS_URI, 'cc'],
  [DC_NS_URI, 'dc'],
  // Inkscape before 0.44 wrote this URI for the sodipodi namespace.
  [BROKEN_SODIPODI_NS_URI, 'sodipodi'],
  // "Duck prion": widespread because of a bug in versions <= 0.43.
  ['http://inkscape.sourceforge.net/DTD/s odipodi-0.dtd', 'sodipodi'],
  // Phased out by Creative Commons.
  [OLD_CC_NS_URI, 'cc'],
];

/** Normalized prefix for a namespace URI. Registers a new prefix for unknown URIs. */
export function nsUriPrefix(uri: string, suggested: string | null): string {
  const known = namespaces.find(([u]) => u === uri);
  if (known) return known[1];
  const prefix = suggested && !nsPrefixUri(suggested) ? suggested : autoPrefix(uri);
  namespaces.unshift([uri, prefix]);
  return prefix;
}

/** Namespace URI of a normalized prefix, or null. */
export function nsPrefixUri(prefix: string): string | null {
  return namespaces.find(([, p]) => p === prefix)?.[0] ?? null;
}

/** Prefix from the last lowercase word of the URI ("http://x.org/foo/bar1" → "bar"), made unique. */
function autoPrefix(uri: string): string {
  const last = uri.split(/[:/]/).pop() ?? '';
  const base = /^[a-z]+/.exec(last)?.[0] ?? 'ns';
  if (!nsPrefixUri(base)) return base;
  for (let i = 0; ; i++) if (!nsPrefixUri(`${base}${i}`)) return `${base}${i}`;
}

/** Prefix of a qualified name ("svg:rect" → "svg"), or null. */
export function qnamePrefix(qname: string): string | null {
  const i = qname.indexOf(':');
  return i < 0 ? null : qname.slice(0, i);
}

/** Local part of a qualified name ("svg:rect" → "rect"). */
export function qnameLocalName(qname: string): string {
  return qname.slice(qname.indexOf(':') + 1);
}

/** Whether node is a child of svg:defs. */
export function sp_repr_is_def(node: Node): boolean {
  return node.parent()?.name() === 'svg:defs';
}

/** Whether node is svg:title, svg:desc or svg:metadata. */
export function sp_repr_is_meta_element(node: Node | null): boolean {
  if (node?.type() !== 'element') return false;
  const name = node.name();
  return name === 'svg:title' || name === 'svg:desc' || name === 'svg:metadata';
}

/** Whether node is a layer (inkscape:groupmode="layer"). */
export function sp_repr_is_layer(node: Node): boolean {
  return node.attribute('inkscape:groupmode') === 'layer';
}

/** The first node named name in repr and its descendants, depth first, down to maxdepth levels (-1: all). */
export function sp_repr_lookup_name(repr: Node, name: string, maxdepth = -1): Node | null {
  if (repr.name() === name) return repr;
  if (maxdepth === 0) return null;
  // maxdepth == -1 means unlimited
  const depth = maxdepth === -1 ? 0 : maxdepth;
  for (let child = repr.firstChild(); child; child = child.next()) {
    const found = sp_repr_lookup_name(child, name, depth - 1);
    if (found) return found;
  }
  return null;
}

/** All nodes named name in repr and its descendants, down to maxdepth levels (-1: all). */
export function sp_repr_lookup_name_many(repr: Node, name: string, maxdepth = -1): Node[] {
  const nodes: Node[] = repr.name() === name ? [repr] : [];
  if (maxdepth === 0) return nodes;
  const depth = maxdepth === -1 ? 0 : maxdepth;
  for (let child = repr.firstChild(); child; child = child.next()) {
    nodes.push(...sp_repr_lookup_name_many(child, name, depth - 1));
  }
  return nodes;
}

/** The first descendant (or repr itself) whose attribute key has value. */
export function sp_repr_lookup_descendant(repr: Node, key: string, value: string | null): Node | null {
  if (repr.attribute(key) === value) return repr;
  for (let child = repr.firstChild(); child; child = child.next()) {
    const found = sp_repr_lookup_descendant(child, key, value);
    if (found) return found;
  }
  return null;
}

/** Call visitor for repr and its descendants; it returns false to skip the descendants of a node. */
export function sp_repr_visit_descendants(repr: Node, visitor: (node: Node) => boolean): void {
  if (!visitor(repr)) return;
  for (let child = repr.firstChild(); child; child = child.next()) sp_repr_visit_descendants(child, visitor);
}
