// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/display/nr-filter-types.h, src/display/nr-filter-colormatrix.h, src/display/nr-filter-component-transfer.h, src/display/nr-filter-convolve-matrix.h, src/display/nr-filter-morphology.h, src/display/nr-filter-turbulence.h, src/display/nr-light-types.h
/*
 * Author:
 *   Niko Kiirala <niko@kiirala.com>
 *
 * Copyright (C) 2006 Niko Kiirala
 */
// The enums of the filter renderers that the filter primitive objects use. The browser renders
// the filters (see DrawingFilters of the editor), so only the enums are ported.

export enum FilterPrimitiveType {
  NR_FILTER_BLEND,
  NR_FILTER_COLORMATRIX,
  NR_FILTER_COMPONENTTRANSFER,
  NR_FILTER_COMPOSITE,
  NR_FILTER_CONVOLVEMATRIX,
  NR_FILTER_DIFFUSELIGHTING,
  NR_FILTER_DISPLACEMENTMAP,
  NR_FILTER_DROPSHADOW,
  NR_FILTER_FLOOD,
  NR_FILTER_GAUSSIANBLUR,
  NR_FILTER_IMAGE,
  NR_FILTER_MERGE,
  NR_FILTER_MORPHOLOGY,
  NR_FILTER_OFFSET,
  NR_FILTER_SPECULARLIGHTING,
  NR_FILTER_TILE,
  NR_FILTER_TURBULENCE,
  NR_FILTER_ENDPRIMITIVETYPE, // This must be last
}

export enum FilterSlotType {
  NR_FILTER_SLOT_NOT_SET = -1,
  NR_FILTER_SOURCEGRAPHIC = -2,
  NR_FILTER_SOURCEALPHA = -3,
  NR_FILTER_BACKGROUNDIMAGE = -4,
  NR_FILTER_BACKGROUNDALPHA = -5,
  NR_FILTER_FILLPAINT = -6,
  NR_FILTER_STROKEPAINT = -7,
  NR_FILTER_UNNAMED_SLOT = -8,
}

export enum FilterColorMatrixType {
  COLORMATRIX_MATRIX,
  COLORMATRIX_SATURATE,
  COLORMATRIX_HUEROTATE,
  COLORMATRIX_LUMINANCETOALPHA,
  COLORMATRIX_ENDTYPE,
}

export enum FilterComponentTransferType {
  COMPONENTTRANSFER_TYPE_IDENTITY,
  COMPONENTTRANSFER_TYPE_TABLE,
  COMPONENTTRANSFER_TYPE_DISCRETE,
  COMPONENTTRANSFER_TYPE_LINEAR,
  COMPONENTTRANSFER_TYPE_GAMMA,
  COMPONENTTRANSFER_TYPE_ERROR,
}

export enum FilterConvolveMatrixEdgeMode {
  CONVOLVEMATRIX_EDGEMODE_DUPLICATE,
  CONVOLVEMATRIX_EDGEMODE_WRAP,
  CONVOLVEMATRIX_EDGEMODE_NONE,
  CONVOLVEMATRIX_EDGEMODE_ENDTYPE,
}

export enum FilterMorphologyOperator {
  MORPHOLOGY_OPERATOR_ERODE,
  MORPHOLOGY_OPERATOR_DILATE,
  MORPHOLOGY_OPERATOR_END,
}

export enum FilterTurbulenceType {
  TURBULENCE_FRACTALNOISE,
  TURBULENCE_TURBULENCE,
  TURBULENCE_ENDTYPE,
}

export enum LightType {
  NO_LIGHT,
  DISTANT_LIGHT,
  POINT_LIGHT,
  SPOT_LIGHT,
}
