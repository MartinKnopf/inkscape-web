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
import { SPBox3D } from './box3d.ts';
import { Box3DSide } from './box3d-side.ts';
import { SPFeBlend } from './filters/blend.ts';
import { SPFeColorMatrix } from './filters/colormatrix.ts';
import { SPFeComponentTransfer } from './filters/componenttransfer.ts';
import { SPFeFuncNode } from './filters/componenttransfer-funcnode.ts';
import { SPFeComposite } from './filters/composite.ts';
import { SPFeConvolveMatrix } from './filters/convolvematrix.ts';
import { SPFeDiffuseLighting } from './filters/diffuselighting.ts';
import { SPFeDisplacementMap } from './filters/displacementmap.ts';
import { SPFeDistantLight } from './filters/distantlight.ts';
import { SPFeDropShadow } from './filters/dropshadow.ts';
import { SPFeFlood } from './filters/flood.ts';
import { SPGaussianBlur } from './filters/gaussian-blur.ts';
import { SPFeImage } from './filters/image.ts';
import { SPFeMerge } from './filters/merge.ts';
import { SPFeMergeNode } from './filters/mergenode.ts';
import { SPFeMorphology } from './filters/morphology.ts';
import { SPFeOffset } from './filters/offset.ts';
import { SPFePointLight } from './filters/pointlight.ts';
import { SPFeSpecularLighting } from './filters/specularlighting.ts';
import { SPFeSpotLight } from './filters/spotlight.ts';
import { SPFeTile } from './filters/tile.ts';
import { SPFeTurbulence } from './filters/turbulence.ts';
import { Persp3D } from './persp3d.ts';
import { SPClipPath } from './sp-clippath.ts';
import { SPDefs } from './sp-defs.ts';
import { GenericEllipseType, SPGenericEllipse } from './sp-ellipse.ts';
import { SPFilter } from './sp-filter.ts';
import { SPFlowdiv, SPFlowline, SPFlowpara, SPFlowregionbreak, SPFlowtspan } from './sp-flowdiv.ts';
import { SPFlowregion, SPFlowregionExclude } from './sp-flowregion.ts';
import { SPFlowtext } from './sp-flowtext.ts';
import { SPGrid } from './sp-grid.ts';
import { SPGuide } from './sp-guide.ts';
import { SPHatch } from './sp-hatch.ts';
import { SPHatchPath } from './sp-hatch-path.ts';
import { SPImage } from './sp-image.ts';
import { SPGroup } from './sp-item-group.ts';
import { SPLine } from './sp-line.ts';
import { SPLinearGradient } from './sp-linear-gradient.ts';
import { SPMarker } from './sp-marker.ts';
import { SPMask } from './sp-mask.ts';
import { SPMeshGradient } from './sp-mesh-gradient.ts';
import { SPMeshpatch } from './sp-mesh-patch.ts';
import { SPMeshrow } from './sp-mesh-row.ts';
import { SPNamedView } from './sp-namedview.ts';
import { type SPObject, setObjectFactory } from './sp-object.ts';
import { SPPage } from './sp-page.ts';
import { SPPath } from './sp-path.ts';
import { SPPattern } from './sp-pattern.ts';
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
import { SPTextPath, SPTSpan } from './sp-tspan.ts';
import { SPUse } from './sp-use.ts';

function genericEllipse(type: GenericEllipseType): SPGenericEllipse {
  const e = new SPGenericEllipse();
  e.type = type;
  return e;
}

/** Constructors by type string (element name or sodipodi:type). null: known, but no object. */
const map = new Map<string, (() => SPObject) | null>([
  ['inkscape:box3d', () => new SPBox3D()],
  ['inkscape:box3dside', () => new Box3DSide()],
  ['inkscape:persp3d', () => new Persp3D()],
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
  ['svg:meshgradient', () => new SPMeshGradient()],
  ['svg:meshrow', () => new SPMeshrow()],
  ['svg:meshpatch', () => new SPMeshpatch()],
  ['svg:marker', () => new SPMarker()],
  ['svg:mask', () => new SPMask()],
  ['svg:hatch', () => new SPHatch()],
  ['svg:hatchpath', () => new SPHatchPath()],
  ['svg:hatchPath', () => new SPHatchPath()],
  ['svg:path', () => new SPPath()],
  ['svg:pattern', () => new SPPattern()],
  ['svg:polygon', () => new SPPolygon()],
  ['svg:polyline', () => new SPPolyLine()],
  ['svg:radialGradient', () => new SPRadialGradient()],
  ['svg:rect', () => new SPRect()],
  ['rect', () => new SPRect()], // LPE rect
  ['spiral', () => new SPSpiral()],
  ['star', () => new SPStar()],
  ['svg:use', () => new SPUse()],
  ['svg:view', () => new SPPage()],
  ['svg:stop', () => new SPStop()],
  ['svg:symbol', () => new SPSymbol()],
  ['svg:text', () => new SPText()],
  ['svg:tspan', () => new SPTSpan()],
  ['svg:textPath', () => new SPTextPath()],
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

  // Filter primitives
  ['svg:feBlend', () => new SPFeBlend()],
  ['svg:feColorMatrix', () => new SPFeColorMatrix()],
  ['svg:feComponentTransfer', () => new SPFeComponentTransfer()],
  ['svg:feFuncR', () => new SPFeFuncNode(SPFeFuncNode.R)],
  ['svg:feFuncG', () => new SPFeFuncNode(SPFeFuncNode.G)],
  ['svg:feFuncB', () => new SPFeFuncNode(SPFeFuncNode.B)],
  ['svg:feFuncA', () => new SPFeFuncNode(SPFeFuncNode.A)],
  ['svg:feComposite', () => new SPFeComposite()],
  ['svg:feConvolveMatrix', () => new SPFeConvolveMatrix()],
  ['svg:feDiffuseLighting', () => new SPFeDiffuseLighting()],
  ['svg:feDisplacementMap', () => new SPFeDisplacementMap()],
  ['svg:feDistantLight', () => new SPFeDistantLight()],
  ['svg:feDropShadow', () => new SPFeDropShadow()],
  ['svg:feFlood', () => new SPFeFlood()],
  ['svg:feGaussianBlur', () => new SPGaussianBlur()],
  ['svg:feImage', () => new SPFeImage()],
  ['svg:feMerge', () => new SPFeMerge()],
  ['svg:feMergeNode', () => new SPFeMergeNode()],
  ['svg:feMorphology', () => new SPFeMorphology()],
  ['svg:feOffset', () => new SPFeOffset()],
  ['svg:fePointLight', () => new SPFePointLight()],
  ['svg:feSpecularLighting', () => new SPFeSpecularLighting()],
  ['svg:feSpotLight', () => new SPFeSpotLight()],
  ['svg:feTile', () => new SPFeTile()],
  ['svg:feTurbulence', () => new SPFeTurbulence()],

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
