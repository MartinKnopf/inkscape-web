// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/filter-enums.cpp, src/filter-enums.h
/*
 * Conversion data for filter and filter primitive enumerations
 *
 * Authors:
 *   Nicholas Bishop
 *
 * Copyright (C) 2007 authors
 */
import {
  FilterColorMatrixType,
  FilterComponentTransferType,
  FilterConvolveMatrixEdgeMode,
  FilterMorphologyOperator,
  FilterPrimitiveType,
  FilterTurbulenceType,
} from './display/nr-filter-types.ts';
import { N_, NC_ } from './i18n.ts';
import { FeCompositeOperator } from './object/filters/composite.ts';
import { FilterDisplacementMapChannelSelector } from './object/filters/displacementmap.ts';
import { type EnumData, EnumDataConverter } from './util/enums.ts';

// Filter primitives
export const FPData: readonly EnumData<FilterPrimitiveType>[] = [
  { id: FilterPrimitiveType.NR_FILTER_BLEND, label: N_('Blend'), key: 'svg:feBlend' },
  { id: FilterPrimitiveType.NR_FILTER_COLORMATRIX, label: N_('Color Matrix'), key: 'svg:feColorMatrix' },
  {
    id: FilterPrimitiveType.NR_FILTER_COMPONENTTRANSFER,
    label: N_('Component Transfer'),
    key: 'svg:feComponentTransfer',
  },
  { id: FilterPrimitiveType.NR_FILTER_COMPOSITE, label: N_('Composite'), key: 'svg:feComposite' },
  {
    id: FilterPrimitiveType.NR_FILTER_CONVOLVEMATRIX,
    label: N_('Convolve Matrix'),
    key: 'svg:feConvolveMatrix',
  },
  {
    id: FilterPrimitiveType.NR_FILTER_DIFFUSELIGHTING,
    label: N_('Diffuse Lighting'),
    key: 'svg:feDiffuseLighting',
  },
  {
    id: FilterPrimitiveType.NR_FILTER_DISPLACEMENTMAP,
    label: N_('Displacement Map'),
    key: 'svg:feDisplacementMap',
  },
  { id: FilterPrimitiveType.NR_FILTER_DROPSHADOW, label: N_('Drop Shadow'), key: 'svg:feDropShadow' },
  { id: FilterPrimitiveType.NR_FILTER_FLOOD, label: N_('Flood'), key: 'svg:feFlood' },
  { id: FilterPrimitiveType.NR_FILTER_GAUSSIANBLUR, label: N_('Gaussian Blur'), key: 'svg:feGaussianBlur' },
  { id: FilterPrimitiveType.NR_FILTER_IMAGE, label: N_('Image'), key: 'svg:feImage' },
  { id: FilterPrimitiveType.NR_FILTER_MERGE, label: N_('Merge'), key: 'svg:feMerge' },
  { id: FilterPrimitiveType.NR_FILTER_MORPHOLOGY, label: N_('Morphology'), key: 'svg:feMorphology' },
  { id: FilterPrimitiveType.NR_FILTER_OFFSET, label: N_('Offset'), key: 'svg:feOffset' },
  {
    id: FilterPrimitiveType.NR_FILTER_SPECULARLIGHTING,
    label: N_('Specular Lighting'),
    key: 'svg:feSpecularLighting',
  },
  { id: FilterPrimitiveType.NR_FILTER_TILE, label: N_('Tile'), key: 'svg:feTile' },
  { id: FilterPrimitiveType.NR_FILTER_TURBULENCE, label: N_('Turbulence'), key: 'svg:feTurbulence' },
];
export const FPConverter = new EnumDataConverter(FPData);

export enum FilterPrimitiveInput {
  FPINPUT_SOURCEGRAPHIC,
  FPINPUT_SOURCEALPHA,
  FPINPUT_BACKGROUNDIMAGE,
  FPINPUT_BACKGROUNDALPHA,
  FPINPUT_FILLPAINT,
  FPINPUT_STROKEPAINT,
  FPINPUT_END,
}

export const FPInputData: readonly EnumData<FilterPrimitiveInput>[] = [
  { id: FilterPrimitiveInput.FPINPUT_SOURCEGRAPHIC, label: N_('Source Graphic'), key: 'SourceGraphic' },
  { id: FilterPrimitiveInput.FPINPUT_SOURCEALPHA, label: N_('Source Alpha'), key: 'SourceAlpha' },
  { id: FilterPrimitiveInput.FPINPUT_BACKGROUNDIMAGE, label: N_('Background Image'), key: 'BackgroundImage' },
  { id: FilterPrimitiveInput.FPINPUT_BACKGROUNDALPHA, label: N_('Background Alpha'), key: 'BackgroundAlpha' },
  { id: FilterPrimitiveInput.FPINPUT_FILLPAINT, label: N_('Fill Paint'), key: 'FillPaint' },
  { id: FilterPrimitiveInput.FPINPUT_STROKEPAINT, label: N_('Stroke Paint'), key: 'StrokePaint' },
];
export const FPInputConverter = new EnumDataConverter(FPInputData);

// ColorMatrix type
export const ColorMatrixTypeData: readonly EnumData<FilterColorMatrixType>[] = [
  { id: FilterColorMatrixType.COLORMATRIX_MATRIX, label: N_('Matrix'), key: 'matrix' },
  { id: FilterColorMatrixType.COLORMATRIX_SATURATE, label: N_('Saturate'), key: 'saturate' },
  { id: FilterColorMatrixType.COLORMATRIX_HUEROTATE, label: N_('Hue Rotate'), key: 'hueRotate' },
  {
    id: FilterColorMatrixType.COLORMATRIX_LUMINANCETOALPHA,
    label: N_('Luminance to Alpha'),
    key: 'luminanceToAlpha',
  },
];
export const ColorMatrixTypeConverter = new EnumDataConverter(ColorMatrixTypeData);

// feComposite
export const CompositeOperatorData: readonly EnumData<FeCompositeOperator>[] = [
  { id: FeCompositeOperator.COMPOSITE_DEFAULT, label: N_('Default'), key: '' },
  { id: FeCompositeOperator.COMPOSITE_OVER, label: N_('Over'), key: 'over' },
  { id: FeCompositeOperator.COMPOSITE_IN, label: N_('In'), key: 'in' },
  { id: FeCompositeOperator.COMPOSITE_OUT, label: N_('Out'), key: 'out' },
  { id: FeCompositeOperator.COMPOSITE_ATOP, label: N_('Atop'), key: 'atop' },
  { id: FeCompositeOperator.COMPOSITE_XOR, label: N_('XOR'), key: 'xor' },
  { id: FeCompositeOperator.COMPOSITE_LIGHTER, label: N_('Lighter'), key: 'lighter' },
  { id: FeCompositeOperator.COMPOSITE_ARITHMETIC, label: N_('Arithmetic'), key: 'arithmetic' },
];
export const CompositeOperatorConverter = new EnumDataConverter(CompositeOperatorData);

// feComponentTransfer
export const ComponentTransferTypeData: readonly EnumData<FilterComponentTransferType>[] = [
  { id: FilterComponentTransferType.COMPONENTTRANSFER_TYPE_IDENTITY, label: N_('Identity'), key: 'identity' },
  { id: FilterComponentTransferType.COMPONENTTRANSFER_TYPE_TABLE, label: N_('Table Lookup'), key: 'table' },
  {
    id: FilterComponentTransferType.COMPONENTTRANSFER_TYPE_DISCRETE,
    label: N_('Discrete Values'),
    key: 'discrete',
  },
  { id: FilterComponentTransferType.COMPONENTTRANSFER_TYPE_LINEAR, label: N_('Linear'), key: 'linear' },
  { id: FilterComponentTransferType.COMPONENTTRANSFER_TYPE_GAMMA, label: N_('Gamma'), key: 'gamma' },
];
export const ComponentTransferTypeConverter = new EnumDataConverter(ComponentTransferTypeData);

// feConvolveMatrix
export const ConvolveMatrixEdgeModeData: readonly EnumData<FilterConvolveMatrixEdgeMode>[] = [
  {
    id: FilterConvolveMatrixEdgeMode.CONVOLVEMATRIX_EDGEMODE_DUPLICATE,
    label: N_('Duplicate'),
    key: 'duplicate',
  },
  { id: FilterConvolveMatrixEdgeMode.CONVOLVEMATRIX_EDGEMODE_WRAP, label: N_('Wrap'), key: 'wrap' },
  // TODO: the label has the context "Convolve matrix, edge mode"; EnumData has no context.
  {
    id: FilterConvolveMatrixEdgeMode.CONVOLVEMATRIX_EDGEMODE_NONE,
    label: NC_('Convolve matrix, edge mode', 'None'),
    key: 'none',
  },
];
export const ConvolveMatrixEdgeModeConverter = new EnumDataConverter(ConvolveMatrixEdgeModeData);

// feDisplacementMap
export const DisplacementMapChannelData: readonly EnumData<FilterDisplacementMapChannelSelector>[] = [
  { id: FilterDisplacementMapChannelSelector.DISPLACEMENTMAP_CHANNEL_RED, label: N_('Red'), key: 'R' },
  { id: FilterDisplacementMapChannelSelector.DISPLACEMENTMAP_CHANNEL_GREEN, label: N_('Green'), key: 'G' },
  { id: FilterDisplacementMapChannelSelector.DISPLACEMENTMAP_CHANNEL_BLUE, label: N_('Blue'), key: 'B' },
  { id: FilterDisplacementMapChannelSelector.DISPLACEMENTMAP_CHANNEL_ALPHA, label: N_('Alpha'), key: 'A' },
];
export const DisplacementMapChannelConverter = new EnumDataConverter(DisplacementMapChannelData);

// feMorphology
export const MorphologyOperatorData: readonly EnumData<FilterMorphologyOperator>[] = [
  { id: FilterMorphologyOperator.MORPHOLOGY_OPERATOR_ERODE, label: N_('Erode'), key: 'erode' },
  { id: FilterMorphologyOperator.MORPHOLOGY_OPERATOR_DILATE, label: N_('Dilate'), key: 'dilate' },
];
export const MorphologyOperatorConverter = new EnumDataConverter(MorphologyOperatorData);

// feTurbulence
export const TurbulenceTypeData: readonly EnumData<FilterTurbulenceType>[] = [
  { id: FilterTurbulenceType.TURBULENCE_FRACTALNOISE, label: N_('Fractal Noise'), key: 'fractalNoise' },
  { id: FilterTurbulenceType.TURBULENCE_TURBULENCE, label: N_('Turbulence'), key: 'turbulence' },
];
export const TurbulenceTypeConverter = new EnumDataConverter(TurbulenceTypeData);

// Lighting
export enum LightSource {
  LIGHT_DISTANT,
  LIGHT_POINT,
  LIGHT_SPOT,
  LIGHT_ENDSOURCE,
}

export const LightSourceData: readonly EnumData<LightSource>[] = [
  { id: LightSource.LIGHT_DISTANT, label: N_('Distant Light'), key: 'svg:feDistantLight' },
  { id: LightSource.LIGHT_POINT, label: N_('Point Light'), key: 'svg:fePointLight' },
  { id: LightSource.LIGHT_SPOT, label: N_('Spot Light'), key: 'svg:feSpotLight' },
];
export const LightSourceConverter = new EnumDataConverter(LightSourceData);
