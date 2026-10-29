// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-factory.cpp, src/object/sp-factory.h
/*
 * Authors:
 *   Markus Engel
 *
 * Copyright (C) 2013 Authors
 */
import '../live_effects/effect-new.ts';
import { LivePathEffectObject } from '../live_effects/lpeobject.ts';
import { SPGaussianBlur } from './filters/gaussian-blur.ts';
import { SPFilterPrimitive } from './filters/sp-filter-primitive.ts';
import { SPClipPath } from './sp-clippath.ts';
import { SPDefs } from './sp-defs.ts';
import { GenericEllipseType, SPGenericEllipse } from './sp-ellipse.ts';
import { SPFilter } from './sp-filter.ts';
import { SPFlowdiv, SPFlowline, SPFlowpara, SPFlowregionbreak, SPFlowtspan } from './sp-flowdiv.ts';
import { SPFlowregion, SPFlowregionExclude } from './sp-flowregion.ts';
import { SPFlowtext } from './sp-flowtext.ts';
import { SPGrid } from './sp-grid.ts';
import { SPGuide } from './sp-guide.ts';
import { SPImage } from './sp-image.ts';
import { SPGroup } from './sp-item-group.ts';
import { SPLine } from './sp-line.ts';
import { SPLinearGradient } from './sp-linear-gradient.ts';
import { SPMarker } from './sp-marker.ts';
import { SPMask } from './sp-mask.ts';
import { SPNamedView } from './sp-namedview.ts';
import { type SPObject, setObjectFactory } from './sp-object.ts';
import { SPPath } from './sp-path.ts';
import { SPPolygon } from './sp-polygon.ts';
import { SPPolyLine } from './sp-polyline.ts';
import { SPRadialGradient } from './sp-radial-gradient.ts';
import { SPRect } from './sp-rect.ts';
import { SPRoot } from './sp-root.ts';
import { SPSpiral } from './sp-spiral.ts';
import { SPStar } from './sp-star.ts';
import { SPStop } from './sp-stop.ts';
import { SPString } from './sp-string.ts';
import { SPSymbol } from './sp-symbol.ts';
import { SPText } from './sp-text.ts';
import { SPTSpan } from './sp-tspan.ts';
import { SPUse } from './sp-use.ts';

function genericEllipse(type: GenericEllipseType): SPGenericEllipse {
  const e = new SPGenericEllipse();
  e.type = type;
  return e;
}

/** Constructors by type string (element name or sodipodi:type). null: known, but no object. */
const map = new Map<string, (() => SPObject) | null>([
  ['svg:clipPath', () => new SPClipPath()],
  ['svg:defs', () => new SPDefs()],
  ['svg:ellipse', () => genericEllipse(GenericEllipseType.SP_GENERIC_ELLIPSE_ELLIPSE)],
  ['svg:circle', () => genericEllipse(GenericEllipseType.SP_GENERIC_ELLIPSE_CIRCLE)],
  ['arc', () => genericEllipse(GenericEllipseType.SP_GENERIC_ELLIPSE_ARC)],
  ['svg:g', () => new SPGroup()],
  ['svg:image', () => new SPImage()],
  ['svg:line', () => new SPLine()],
  ['svg:filter', () => new SPFilter()],
  ['svg:linearGradient', () => new SPLinearGradient()],
  ['svg:marker', () => new SPMarker()],
  ['svg:mask', () => new SPMask()],
  ['svg:path', () => new SPPath()],
  ['svg:polygon', () => new SPPolygon()],
  ['svg:polyline', () => new SPPolyLine()],
  ['svg:radialGradient', () => new SPRadialGradient()],
  ['svg:rect', () => new SPRect()],
  ['rect', () => new SPRect()], // LPE rect
  ['spiral', () => new SPSpiral()],
  ['star', () => new SPStar()],
  ['svg:use', () => new SPUse()],
  ['svg:stop', () => new SPStop()],
  ['svg:symbol', () => new SPSymbol()],
  ['svg:text', () => new SPText()],
  ['svg:tspan', () => new SPTSpan()],
  ['svg:flowDiv', () => new SPFlowdiv()],
  ['svg:flowSpan', () => new SPFlowtspan()],
  ['svg:flowPara', () => new SPFlowpara()],
  ['svg:flowLine', () => new SPFlowline()],
  ['svg:flowRegionBreak', () => new SPFlowregionbreak()],
  ['svg:flowRegion', () => new SPFlowregion()],
  ['svg:flowRegionExclude', () => new SPFlowregionExclude()],
  ['svg:flowRoot', () => new SPFlowtext()],
  ['string', () => new SPString()],
  ['svg:svg', () => new SPRoot()],
  ['sodipodi:namedview', () => new SPNamedView()],
  ['sodipodi:guide', () => new SPGuide()],
  ['inkscape:grid', () => new SPGrid()],
  ['inkscape:path-effect', () => new LivePathEffectObject()],

  // Filter primitives. TODO: the subclasses of SPFilterPrimitive (SPFeBlend, ...) and the
  // objects inside primitives (feFuncR, feMergeNode, lights); the drawing copies them as they are.
  ['svg:feGaussianBlur', () => new SPGaussianBlur()],
  ...[
    'feBlend',
    'feColorMatrix',
    'feComponentTransfer',
    'feComposite',
    'feConvolveMatrix',
    'feDiffuseLighting',
    'feDisplacementMap',
    'feDropShadow',
    'feFlood',
    'feImage',
    'feMerge',
    'feMorphology',
    'feOffset',
    'feSpecularLighting',
    'feTile',
    'feTurbulence',
  ].map((name): [string, () => SPObject] => [`svg:${name}`, () => new SPFilterPrimitive()]),
  ...[
    'feFuncR',
    'feFuncG',
    'feFuncB',
    'feFuncA',
    'feMergeNode',
    'feDistantLight',
    'fePointLight',
    'feSpotLight',
  ].map((name): [string, null] => [`svg:${name}`, null]),

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
