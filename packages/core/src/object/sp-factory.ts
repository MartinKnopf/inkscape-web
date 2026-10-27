// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-factory.cpp, src/object/sp-factory.h
/*
 * Authors:
 *   Markus Engel
 *
 * Copyright (C) 2013 Authors
 */
import { SPDefs } from './sp-defs.ts';
import { SPGroup } from './sp-item-group.ts';
import { type SPObject, setObjectFactory } from './sp-object.ts';
import { SPPath } from './sp-path.ts';
import { SPRoot } from './sp-root.ts';

/** Constructors by type string (element name or sodipodi:type). null: known, but no object. */
const map = new Map<string, (() => SPObject) | null>([
  ['svg:defs', () => new SPDefs()],
  ['svg:g', () => new SPGroup()],
  ['svg:path', () => new SPPath()],
  ['svg:svg', () => new SPRoot()],

  // ignore
  ['rdf:RDF', null], // no SP node yet
  ['inkscape:clipboard', null], // SP node not necessary
  ['inkscape:templateinfo', null], // metadata for templates
  ['inkscape:_templateinfo', null], // metadata for templates
  ['', null], // comments
]);

const warned = new Set<string>();

/** Create the object for a type string, or null for unknown or ignored types. */
export function createObject(id: string): SPObject | null {
  const make = map.get(id);
  if (make === undefined) {
    if (!warned.has(id)) console.warn(`WARNING: unknown type: ${id}`);
    warned.add(id);
    return null;
  }
  return make?.() ?? null;
}

export function supportsType(id: string): boolean {
  return map.has(id);
}

setObjectFactory(createObject);
