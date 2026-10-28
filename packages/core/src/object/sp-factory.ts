// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-factory.cpp, src/object/sp-factory.h
/*
 * Authors:
 *   Markus Engel
 *
 * Copyright (C) 2013 Authors
 */
import { SPDefs } from './sp-defs.ts';
import { GenericEllipseType, SPGenericEllipse } from './sp-ellipse.ts';
import { SPGroup } from './sp-item-group.ts';
import { SPLine } from './sp-line.ts';
import { SPNamedView } from './sp-namedview.ts';
import { type SPObject, setObjectFactory } from './sp-object.ts';
import { SPPath } from './sp-path.ts';
import { SPPolygon } from './sp-polygon.ts';
import { SPPolyLine } from './sp-polyline.ts';
import { SPRect } from './sp-rect.ts';
import { SPRoot } from './sp-root.ts';
import { SPSpiral } from './sp-spiral.ts';
import { SPStar } from './sp-star.ts';

function genericEllipse(type: GenericEllipseType): SPGenericEllipse {
  const e = new SPGenericEllipse();
  e.type = type;
  return e;
}

/** Constructors by type string (element name or sodipodi:type). null: known, but no object. */
const map = new Map<string, (() => SPObject) | null>([
  ['svg:defs', () => new SPDefs()],
  ['svg:ellipse', () => genericEllipse(GenericEllipseType.SP_GENERIC_ELLIPSE_ELLIPSE)],
  ['svg:circle', () => genericEllipse(GenericEllipseType.SP_GENERIC_ELLIPSE_CIRCLE)],
  ['arc', () => genericEllipse(GenericEllipseType.SP_GENERIC_ELLIPSE_ARC)],
  ['svg:g', () => new SPGroup()],
  ['svg:line', () => new SPLine()],
  ['svg:path', () => new SPPath()],
  ['svg:polygon', () => new SPPolygon()],
  ['svg:polyline', () => new SPPolyLine()],
  ['svg:rect', () => new SPRect()],
  ['rect', () => new SPRect()], // LPE rect
  ['spiral', () => new SPSpiral()],
  ['star', () => new SPStar()],
  ['svg:svg', () => new SPRoot()],
  ['sodipodi:namedview', () => new SPNamedView()],

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
