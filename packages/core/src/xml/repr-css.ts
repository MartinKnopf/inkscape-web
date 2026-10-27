// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/xml/repr-css.cpp, src/xml/sp-css-attr.h, src/xml/repr.h
/*
 * Functions to manipulate SPCSSAttr, which is a repr node whose attributes are the properties of
 * a style attribute. For example, style="fill:blue;stroke:none" is stored as the attributes
 * "fill" and "stroke". An element's properties are changed by setting or removing an attribute.
 * Use spReprCssWriteString to go from the attributes to a style string.
 *
 * Authors:
 *   bulia byak <buliabyak@users.sf.net>
 *   Tavmjong Bah <tavmjong@free.fr>  (Documentation)
 *
 * Copyright (C) 2018 Authors
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */

import { parseDeclarationList } from '../3rdparty/libcroco/cr-declaration.ts';
import { cssNumber } from '../svg/css-ostringstream.ts';
import { readNumberPrefix } from '../svg/svg-length.ts';
import { XmlDocument } from './document.ts';
import type { Node } from './node.ts';

/** A node whose attributes are CSS properties (upstream SPCSSAttr, derived from Inkscape::XML::Node). */
export type SPCSSAttr = Node;

const UNSET = 'inkscape:unset';

let attrDoc: XmlDocument | null = null;

/** Creates an empty SPCSSAttr (a node for manipulating CSS style properties). */
export function spReprCssAttrNew(): SPCSSAttr {
  attrDoc ??= new XmlDocument();
  return attrDoc.createElement('css');
}

/**
 * Creates a new SPCSSAttr with the properties of the attribute `attr` (for example "style") of
 * `repr`, parsed from its string.
 */
export function spReprCssAttr(repr: Node, attr: string): SPCSSAttr {
  const css = spReprCssAttrNew();
  spReprCssAddComponents(css, repr, attr);
  return css;
}

/** Adds the properties from the attribute of repr and of all its ancestors, a child overrides its parent. */
function spReprCssAttrInheritedRecursive(css: SPCSSAttr, repr: Node, attr: string): void {
  const parent = repr.parent();
  if (parent) spReprCssAttrInheritedRecursive(css, parent, attr);
  spReprCssAddComponents(css, repr, attr);
}

/** Creates a new SPCSSAttr with the properties of the attribute, determined by cascading. */
export function spReprCssAttrInherited(repr: Node, attr: string): SPCSSAttr {
  const css = spReprCssAttrNew();
  spReprCssAttrInheritedRecursive(css, repr, attr);
  return css;
}

/** Adds the properties of the attribute of repr (nominally a style attribute) to css. */
function spReprCssAddComponents(css: SPCSSAttr, repr: Node, attr: string): void {
  spReprCssAttrAddFromString(css, repr.attribute(attr));
}

/** The value of a style property, or defval if the property is not set. */
export function spReprCssProperty(css: SPCSSAttr, name: string): string | null;
export function spReprCssProperty(css: SPCSSAttr, name: string, defval: string): string;
export function spReprCssProperty(css: SPCSSAttr, name: string, defval: string | null): string | null;
export function spReprCssProperty(css: SPCSSAttr, name: string, defval: string | null = null): string | null {
  return css.attribute(name) ?? defval;
}

/** True if a style property is present and its value is unset. */
export function spReprCssPropertyIsUnset(css: SPCSSAttr, name: string): boolean {
  return css.attribute(name) === UNSET;
}

/** Set a style property to a new value (for example fill to #ffff00), or remove it if value is null. */
export function spReprCssSetProperty(css: SPCSSAttr, name: string, value: string | null): void {
  css.setAttribute(name, value);
}

/** Set a style property to "inkscape:unset". */
export function spReprCssUnsetProperty(css: SPCSSAttr, name: string): void {
  css.setAttribute(name, UNSET);
}

/** The value of a style property as a number (like g_ascii_strtod), or defval if it is not set. */
export function spReprCssDoubleProperty(css: SPCSSAttr, name: string, defval: number): number {
  const v = css.attribute(name);
  if (v === null) return defval;
  return readNumberPrefix(v)?.value ?? 0;
}

/** Set a style property to a new number (for example opacity to 0.5). */
export function spReprCssSetPropertyDouble(css: SPCSSAttr, name: string, value: number): void {
  css.setAttribute(name, cssNumber(value));
}

/** Set a style property to a string. */
export function spReprCssSetPropertyString(css: SPCSSAttr, name: string, value: string): void {
  css.setAttribute(name, value);
}

/** Write a style attribute string from the properties of an SPCSSAttr. Unset properties are skipped. */
export function spReprCssWriteString(css: SPCSSAttr): string {
  const parts: string[] = [];
  for (const [key, value] of css.attributeList()) {
    if (value === UNSET) continue;
    // Any necessary quoting is done by the caller.
    parts.push(`${key}:${value}`);
  }
  return parts.join(';');
}

/** Set the attribute (for example style) of repr to a string created from the properties of css. */
export function spReprCssSet(repr: Node, css: SPCSSAttr, attr: string): void {
  const value = spReprCssWriteString(css);
  repr.setAttribute(attr, value || null);
}

/** The properties of css, one "key:\tvalue" line each. */
export function spReprCssPrint(css: SPCSSAttr): string {
  return css
    .attributeList()
    .map(([key, value]) => `${key}:\t${value}\n`)
    .join('');
}

/** Merges two SPCSSAttr's. Properties in src overwrite properties in dst if present in both. */
export function spReprCssMerge(dst: SPCSSAttr, src: SPCSSAttr): void {
  if (dst === src) throw new Error('spReprCssMerge: dst and src are the same node');
  for (const [key, value] of src.attributeList()) dst.setAttribute(key, value);
}

/**
 * Parse a string for CSS properties and merge them into an existing SPCSSAttr. A later
 * declaration overrides an earlier one. Values are normalized as libcroco does.
 */
export function spReprCssAttrAddFromString(css: SPCSSAttr, p: string | null): void {
  if (p === null) return;
  for (const decl of parseDeclarationList(p)) css.setAttribute(decl.property, decl.value);
}

/**
 * Creates a new SPCSSAttr with the values filled from the attribute of a repr, merges in the
 * properties from the given SPCSSAttr, and then writes the result to the attribute. This is
 * called, for example, for each object in turn when a selection's style is updated.
 */
export function spReprCssChange(repr: Node, css: SPCSSAttr, attr: string): void {
  const current = spReprCssAttr(repr, attr);
  spReprCssMerge(current, css);
  spReprCssSet(repr, current, attr);
}

export function spReprCssChangeRecursive(repr: Node, css: SPCSSAttr, attr: string): void {
  spReprCssChange(repr, css, attr);
  for (let child = repr.firstChild(); child; child = child.next()) {
    spReprCssChangeRecursive(child, css, attr);
  }
}

/** Return a new SPCSSAttr with all the properties found in the input SPCSSAttr unset. */
export function spReprCssAttrUnsetAll(css: SPCSSAttr): SPCSSAttr {
  const cssUnset = spReprCssAttrNew();
  for (const [key] of css.attributeList()) spReprCssSetProperty(cssUnset, key, UNSET);
  return cssUnset;
}
