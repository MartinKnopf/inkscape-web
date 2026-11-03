// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/filter-effects-dialog.cpp, src/ui/dialog/filter-effects-dialog.h
/*
 * Filter Effects dialog.
 *
 * Authors:
 *   Nicholas Bishop <nicholasbishop@gmail.org>
 *   Rodrigo Kumpera <kumpera@gmail.com>
 *   Felipe C. da S. Sanches <juca@members.fsf.org>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *   insaner
 *
 * Copyright (C) 2007 Authors
 */
// The model of the Filter Editor (dialog key "FilterEffects"): the filter list (FilterModifier),
// the primitive list with its input connections (PrimitiveList), and the settings widgets of
// each primitive type (init_settings_widgets) as data for the web dialog. All changes go
// through the functions here and make the same undo steps as upstream.
import {
  _,
  C_,
  ColorMatrixTypeConverter,
  Colors,
  ComponentTransferTypeConverter,
  CompositeOperatorConverter,
  ConvolveMatrixEdgeModeConverter,
  DisplacementMapChannelConverter,
  DocumentUndo,
  type EnumDataConverter,
  enum_blend_mode,
  FeCompositeOperator,
  type FilterColorMatrixType,
  FilterComponentTransferType,
  FilterPrimitiveType,
  FPConverter,
  FPInputData,
  filter_add_primitive,
  LightSource,
  LightSourceConverter,
  MorphologyOperatorConverter,
  N_,
  NumberOptNumber,
  new_filter,
  remove_filter as remove_item_filter,
  SP_OBJECT_MODIFIED_FLAG,
  SP_OBJECT_STYLE_MODIFIED_FLAG,
  type SPDocument,
  SPFeBlend,
  SPFeColorMatrix,
  type SPFeComponentTransfer,
  SPFeComposite,
  SPFeConvolveMatrix,
  SPFeDisplacementMap,
  SPFeDistantLight,
  SPFeFuncNode,
  SPFeMerge,
  SPFeMergeNode,
  SPFePointLight,
  SPFeSpotLight,
  SPFilter,
  SPFilterPrimitive,
  type SPItem,
  type SPObject,
  spStyleSetPropertyUrl,
  TurbulenceTypeConverter,
} from '@inkscape-web/core';
import type { SPDesktop } from '../../desktop.ts';
import { get_all_items } from '../../selection-chemistry.ts';
import { BLEND_MODES } from '../widget/object-composite-settings.ts';

const ICON = 'dialog-filters';

export const max_convolution_kernel_size = 10;

// ---------------------------------------------------------------------------------------------
// The settings widgets

/** A choice of a combo: the attribute value and its untranslated label. */
export interface ComboOption {
  key: string;
  label: string;
}

/**
 * A settings widget of a primitive (upstream AttrWidget and its subclasses). attr is the
 * attribute name; labels and tips are translated.
 */
export type AttrWidgetSpec =
  | { kind: 'checkbutton'; attr: string; label: string; def: boolean; on: string; off: string; tip?: string }
  | {
      kind: 'multispinbutton';
      attrs: readonly string[];
      defs: readonly number[];
      label: string;
      lo: number;
      hi: number;
      step: number;
      digits: number;
      tips: readonly string[];
    }
  | {
      kind: 'dualspinbutton';
      attr: string;
      def: string;
      label: string;
      lo: number;
      hi: number;
      step: number;
      digits: number;
      tips: readonly string[];
    }
  | { kind: 'combo'; attr: string; label: string; def: string; options: readonly ComboOption[]; tip?: string }
  | {
      kind: 'spinscale';
      attr: string;
      label: string;
      def: number;
      lo: number;
      hi: number;
      step: number;
      digits: number;
      tip?: string;
    }
  | {
      kind: 'dualspinscale';
      attr: string;
      label: string;
      lo: number;
      hi: number;
      step: number;
      digits: number;
      tip?: string;
    }
  | { kind: 'color'; attr: string; label: string; def: string; tip?: string }
  | { kind: 'matrix'; attr: string; label: string; tip: string }
  | { kind: 'colormatrixvalues'; label: string }
  | { kind: 'componenttransfer'; label: string; channel: number }
  | { kind: 'lightsource' }
  | { kind: 'fileorelement'; attr: string; label: string }
  | { kind: 'entry'; attr: string; label: string; tip?: string }
  | { kind: 'subregion' }
  | { kind: 'noparams' };

function options<E extends number>(conv: EnumDataConverter<E>): ComboOption[] {
  const list: ComboOption[] = [];
  for (let i = 0; i < conv._length; i++) {
    const d = conv.data(i);
    list.push({ key: d.key, label: d.label });
  }
  return list;
}

/** The blend modes of the Blend primitive (upstream SPBlendModeConverter). */
function blend_options(): ComboOption[] {
  const list: ComboOption[] = [];
  for (const m of BLEND_MODES) {
    const key = m && enum_blend_mode.find((e) => e.value === m.mode)?.key;
    if (m && key) list.push({ key, label: m.label });
  }
  return list;
}

/** The settings of the filter itself: the filter region (upstream _filter_general_settings). */
export function filter_general_settings(): AttrWidgetSpec[] {
  return [
    {
      kind: 'checkbutton',
      attr: 'inkscape:auto-region',
      def: true,
      label: _('Automatic Region'),
      on: 'true',
      off: 'false',
      tip: _("If unset, the coordinates and dimensions won't be updated automatically."),
    },
    {
      kind: 'multispinbutton',
      defs: [-0.1, -0.1],
      attrs: ['x', 'y'],
      label: _('Coordinates:'),
      lo: -100,
      hi: 100,
      step: 0.01,
      digits: 2,
      tips: [
        _('X coordinate of the left corners of filter effects region'),
        _('Y coordinate of the upper corners of filter effects region'),
      ],
    },
    {
      kind: 'multispinbutton',
      defs: [1.2, 1.2],
      attrs: ['width', 'height'],
      label: _('Dimensions:'),
      lo: 0,
      hi: 1000,
      step: 0.01,
      digits: 2,
      tips: [_('Width of filter effects region'), _('Height of filter effects region')],
    },
  ];
}

const K_TIP = N_(
  'If the arithmetic operation is chosen, each result pixel is computed using the formula k1*i1*i2 + k2*i1 + k3*i2 + k4 where i1 and i2 are the pixel values of the first and second inputs respectively.',
);
const PRESERVE_ALPHA_TIP = N_("If set, the alpha channel won't be altered by this filter primitive.");
const LIGHT_COLOR_TIP = N_('Defines the color of the light source');
const SURFACE_SCALE_TIP = N_(
  'This value amplifies the heights of the bump map defined by the input alpha channel',
);
const PHONG_TIP = N_('This constant affects the Phong lighting model.');

/** The settings widgets of a primitive type (upstream init_settings_widgets). */
export function primitive_settings(type: FilterPrimitiveType): AttrWidgetSpec[] {
  switch (type) {
    case FilterPrimitiveType.NR_FILTER_BLEND:
      return [{ kind: 'combo', def: 'normal', attr: 'mode', label: _('Mode:'), options: blend_options() }];
    case FilterPrimitiveType.NR_FILTER_COLORMATRIX:
      return [
        {
          kind: 'combo',
          def: 'matrix',
          attr: 'type',
          label: _('Type:'),
          options: options(ColorMatrixTypeConverter),
          tip: _(
            "Indicates the type of matrix operation. The keyword 'matrix' indicates that a full 5x4 matrix of values will be provided. The other keywords represent convenience shortcuts to allow commonly used color operations to be performed without specifying a complete matrix.",
          ),
        },
        { kind: 'colormatrixvalues', label: _('Value(s):') },
      ];
    case FilterPrimitiveType.NR_FILTER_COMPONENTTRANSFER:
      return [
        // TRANSLATORS: Abbreviation for red color channel in RGBA
        { kind: 'componenttransfer', label: C_('color', 'R:'), channel: SPFeFuncNode.R },
        // TRANSLATORS: Abbreviation for green color channel in RGBA
        { kind: 'componenttransfer', label: C_('color', 'G:'), channel: SPFeFuncNode.G },
        // TRANSLATORS: Abbreviation for blue color channel in RGBA
        { kind: 'componenttransfer', label: C_('color', 'B:'), channel: SPFeFuncNode.B },
        // TRANSLATORS: Abbreviation for alpha channel in RGBA
        { kind: 'componenttransfer', label: C_('color', 'A:'), channel: SPFeFuncNode.A },
      ];
    case FilterPrimitiveType.NR_FILTER_COMPOSITE:
      return [
        {
          kind: 'combo',
          def: 'over',
          attr: 'operator',
          label: _('Operator:'),
          options: options(CompositeOperatorConverter),
        },
        ...['k1', 'k2', 'k3', 'k4'].map(
          (k): AttrWidgetSpec => ({
            kind: 'spinscale',
            def: 0,
            attr: k,
            label: `${k.toUpperCase()}:`,
            lo: -10,
            hi: 10,
            step: 0.1,
            digits: 2,
            tip: _(K_TIP),
          }),
        ),
      ];
    case FilterPrimitiveType.NR_FILTER_CONVOLVEMATRIX:
      return [
        {
          kind: 'dualspinbutton',
          def: '3',
          attr: 'order',
          label: _('Size:'),
          lo: 1,
          hi: max_convolution_kernel_size,
          step: 1,
          digits: 0,
          tips: [_('width of the convolve matrix'), _('height of the convolve matrix')],
        },
        {
          kind: 'multispinbutton',
          defs: [0, 0],
          attrs: ['targetX', 'targetY'],
          label: _('Target:'),
          lo: 0,
          hi: max_convolution_kernel_size - 1,
          step: 1,
          digits: 0,
          tips: [
            _(
              'X coordinate of the target point in the convolve matrix. The convolution is applied to pixels around this point.',
            ),
            _(
              'Y coordinate of the target point in the convolve matrix. The convolution is applied to pixels around this point.',
            ),
          ],
        },
        //TRANSLATORS: for info on "Kernel", see http://en.wikipedia.org/wiki/Kernel_(matrix)
        {
          kind: 'matrix',
          attr: 'kernelMatrix',
          label: _('Kernel:'),
          tip: _(
            'This matrix describes the convolve operation that is applied to the input image in order to calculate the pixel colors at the output. Different arrangements of values in this matrix result in various possible visual effects. An identity matrix would lead to a motion blur effect (parallel to the matrix diagonal) while a matrix filled with a constant non-zero value would lead to a common blur effect.',
          ),
        },
        {
          kind: 'spinscale',
          def: 0,
          attr: 'divisor',
          label: _('Divisor:'),
          lo: 0,
          hi: 1000,
          step: 1,
          digits: 2,
          tip: _(
            'After applying the kernelMatrix to the input image to yield a number, that number is divided by divisor to yield the final destination color value. A divisor that is the sum of all the matrix values tends to have an evening effect on the overall color intensity of the result.',
          ),
        },
        {
          kind: 'spinscale',
          def: 0,
          attr: 'bias',
          label: _('Bias:'),
          lo: -10,
          hi: 10,
          step: 0.1,
          digits: 2,
          tip: _(
            'This value is added to each component. This is useful to define a constant value as the zero response of the filter.',
          ),
        },
        {
          kind: 'combo',
          def: 'none',
          attr: 'edgeMode',
          label: _('Edge Mode:'),
          options: options(ConvolveMatrixEdgeModeConverter),
          tip: _(
            'Determines how to extend the input image as necessary with color values so that the matrix operations can be applied when the kernel is positioned at or near the edge of the input image.',
          ),
        },
        {
          kind: 'checkbutton',
          def: false,
          attr: 'preserveAlpha',
          label: _('Preserve Alpha'),
          on: 'true',
          off: 'false',
          tip: _(PRESERVE_ALPHA_TIP),
        },
      ];
    case FilterPrimitiveType.NR_FILTER_DIFFUSELIGHTING:
      return [
        {
          kind: 'color',
          def: '#ffffff',
          attr: 'lighting-color',
          label: _('Diffuse Color:'),
          tip: _(LIGHT_COLOR_TIP),
        },
        {
          kind: 'spinscale',
          def: 1,
          attr: 'surfaceScale',
          label: _('Surface Scale:'),
          lo: -5,
          hi: 5,
          step: 0.01,
          digits: 3,
          tip: _(SURFACE_SCALE_TIP),
        },
        {
          kind: 'spinscale',
          def: 1,
          attr: 'diffuseConstant',
          label: _('Constant:'),
          lo: 0,
          hi: 5,
          step: 0.1,
          digits: 2,
          tip: _(PHONG_TIP),
        },
        { kind: 'lightsource' },
      ];
    case FilterPrimitiveType.NR_FILTER_DISPLACEMENTMAP:
      return [
        {
          kind: 'spinscale',
          def: 0,
          attr: 'scale',
          label: _('Scale:'),
          lo: 0,
          hi: 100,
          step: 1,
          digits: 1,
          tip: _('This defines the intensity of the displacement effect.'),
        },
        {
          kind: 'combo',
          def: 'A',
          attr: 'xChannelSelector',
          label: _('X displacement:'),
          options: options(DisplacementMapChannelConverter),
          tip: _('Color component that controls the displacement in the X direction'),
        },
        {
          kind: 'combo',
          def: 'A',
          attr: 'yChannelSelector',
          label: _('Y displacement:'),
          options: options(DisplacementMapChannelConverter),
          tip: _('Color component that controls the displacement in the Y direction'),
        },
      ];
    case FilterPrimitiveType.NR_FILTER_DROPSHADOW:
      // Not in upstream (it shows no settings for Drop Shadow): the attributes of feDropShadow.
      return [
        {
          kind: 'dualspinscale',
          attr: 'stdDeviation',
          label: _('Size:'),
          lo: 0,
          hi: 100,
          step: 1,
          digits: 2,
          tip: _('The standard deviation for the blur operation.'),
        },
        {
          kind: 'spinscale',
          def: 2,
          attr: 'dx',
          label: _('Delta X:'),
          lo: -100,
          hi: 100,
          step: 1,
          digits: 2,
        },
        {
          kind: 'spinscale',
          def: 2,
          attr: 'dy',
          label: _('Delta Y:'),
          lo: -100,
          hi: 100,
          step: 1,
          digits: 2,
        },
        { kind: 'color', def: '#000000', attr: 'flood-color', label: _('Color:') },
        {
          kind: 'spinscale',
          def: 1,
          attr: 'flood-opacity',
          label: _('Opacity:'),
          lo: 0,
          hi: 1,
          step: 0.1,
          digits: 2,
        },
      ];
    case FilterPrimitiveType.NR_FILTER_FLOOD:
      return [
        {
          kind: 'color',
          def: '#000000',
          attr: 'flood-color',
          label: _('Color:'),
          tip: _('The whole filter region will be filled with this color.'),
        },
        {
          kind: 'spinscale',
          def: 1,
          attr: 'flood-opacity',
          label: _('Opacity:'),
          lo: 0,
          hi: 1,
          step: 0.1,
          digits: 2,
        },
      ];
    case FilterPrimitiveType.NR_FILTER_GAUSSIANBLUR:
      return [
        {
          kind: 'dualspinscale',
          attr: 'stdDeviation',
          label: _('Size:'),
          lo: 0,
          hi: 100,
          step: 1,
          digits: 2,
          tip: _('The standard deviation for the blur operation.'),
        },
      ];
    case FilterPrimitiveType.NR_FILTER_MERGE:
      return [{ kind: 'noparams' }];
    case FilterPrimitiveType.NR_FILTER_MORPHOLOGY:
      return [
        {
          kind: 'combo',
          def: 'erode',
          attr: 'operator',
          label: _('Operator:'),
          options: options(MorphologyOperatorConverter),
          tip: _('Erode: performs "thinning" of input image.\nDilate: performs "fattening" of input image.'),
        },
        { kind: 'dualspinscale', attr: 'radius', label: _('Radius:'), lo: 0, hi: 100, step: 1, digits: 1 },
      ];
    case FilterPrimitiveType.NR_FILTER_IMAGE:
      return [
        { kind: 'fileorelement', attr: 'xlink:href', label: _('Source of Image:') },
        { kind: 'subregion' },
      ];
    case FilterPrimitiveType.NR_FILTER_OFFSET:
      return [
        {
          kind: 'checkbutton',
          def: false,
          attr: 'preserveAlpha',
          label: _('Preserve Alpha'),
          on: 'true',
          off: 'false',
          tip: _(PRESERVE_ALPHA_TIP),
        },
        {
          kind: 'spinscale',
          def: 0,
          attr: 'dx',
          label: _('Delta X:'),
          lo: -100,
          hi: 100,
          step: 1,
          digits: 2,
          tip: _('This is how far the input image gets shifted to the right'),
        },
        {
          kind: 'spinscale',
          def: 0,
          attr: 'dy',
          label: _('Delta Y:'),
          lo: -100,
          hi: 100,
          step: 1,
          digits: 2,
          tip: _('This is how far the input image gets shifted downwards'),
        },
      ];
    case FilterPrimitiveType.NR_FILTER_SPECULARLIGHTING:
      return [
        {
          kind: 'color',
          def: '#ffffff',
          attr: 'lighting-color',
          label: _('Specular Color:'),
          tip: _(LIGHT_COLOR_TIP),
        },
        {
          kind: 'spinscale',
          def: 1,
          attr: 'surfaceScale',
          label: _('Surface Scale:'),
          lo: -5,
          hi: 5,
          step: 0.1,
          digits: 2,
          tip: _(SURFACE_SCALE_TIP),
        },
        {
          kind: 'spinscale',
          def: 1,
          attr: 'specularConstant',
          label: _('Constant:'),
          lo: 0,
          hi: 5,
          step: 0.1,
          digits: 2,
          tip: _(PHONG_TIP),
        },
        {
          kind: 'spinscale',
          def: 1,
          attr: 'specularExponent',
          label: _('Exponent:'),
          lo: 1,
          hi: 50,
          step: 1,
          digits: 1,
          tip: _('Exponent for specular term, larger is more "shiny".'),
        },
        { kind: 'lightsource' },
      ];
    case FilterPrimitiveType.NR_FILTER_TILE:
      // add some filter primitive attributes: https://drafts.fxtf.org/filter-effects/#feTileElement
      return [{ kind: 'subregion' }];
    case FilterPrimitiveType.NR_FILTER_TURBULENCE:
      return [
        {
          kind: 'combo',
          def: 'turbulence',
          attr: 'type',
          label: _('Type:'),
          options: options(TurbulenceTypeConverter),
          tip: _('Indicates whether the filter primitive should perform a noise or turbulence function.'),
        },
        {
          kind: 'dualspinscale',
          attr: 'baseFrequency',
          label: _('Size:'),
          lo: 0.001,
          hi: 10,
          step: 0.001,
          digits: 3,
        },
        {
          kind: 'spinscale',
          def: 1,
          attr: 'numOctaves',
          label: _('Detail:'),
          lo: 1,
          hi: 10,
          step: 1,
          digits: 0,
        },
        {
          kind: 'spinscale',
          def: 0,
          attr: 'seed',
          label: _('Seed:'),
          lo: 0,
          hi: 1000,
          step: 1,
          digits: 0,
          tip: _('The starting number for the pseudo random number generator.'),
        },
      ];
    default:
      return [];
  }
}

/** The settings of a transfer function of a type (upstream ComponentTransferValues). */
export function component_transfer_settings(type: FilterComponentTransferType): AttrWidgetSpec[] {
  const spin = (def: number, attr: string, label: string, lo: number): AttrWidgetSpec => ({
    kind: 'spinscale',
    def,
    attr,
    label,
    lo,
    hi: 10,
    step: 0.1,
    digits: 2,
  });
  switch (type) {
    case FilterComponentTransferType.COMPONENTTRANSFER_TYPE_LINEAR:
      return [spin(1, 'slope', _('Slope'), -10), spin(0, 'intercept', _('Intercept'), -10)];
    case FilterComponentTransferType.COMPONENTTRANSFER_TYPE_GAMMA:
      return [
        spin(1, 'amplitude', _('Amplitude'), 0),
        spin(1, 'exponent', _('Exponent'), 0),
        spin(0, 'offset', _('Offset'), -10),
      ];
    case FilterComponentTransferType.COMPONENTTRANSFER_TYPE_TABLE:
      return [
        {
          kind: 'entry',
          attr: 'tableValues',
          label: _('Values'),
          tip: _('List of stops with interpolated output'),
        },
      ];
    case FilterComponentTransferType.COMPONENTTRANSFER_TYPE_DISCRETE:
      return [
        {
          kind: 'entry',
          attr: 'tableValues',
          label: _('Values'),
          tip: _('List of discrete values for a step function'),
        },
      ];
    default:
      return [];
  }
}

/** The settings of a light source (upstream LightSourceControl). */
export function light_source_settings(ls: LightSource): AttrWidgetSpec[] {
  const location: AttrWidgetSpec = {
    kind: 'multispinbutton',
    defs: [0, 0, 0],
    attrs: ['x', 'y', 'z'],
    label: _('Location:'),
    lo: -99999,
    hi: 99999,
    step: 1,
    digits: 0,
    tips: [_('X coordinate'), _('Y coordinate'), _('Z coordinate')],
  };
  // FIXME: these range values are complete crap
  switch (ls) {
    case LightSource.LIGHT_DISTANT:
      return [
        {
          kind: 'spinscale',
          def: 0,
          attr: 'azimuth',
          label: _('Azimuth:'),
          lo: 0,
          hi: 360,
          step: 1,
          digits: 0,
          tip: _('Direction angle for the light source on the XY plane, in degrees'),
        },
        {
          kind: 'spinscale',
          def: 0,
          attr: 'elevation',
          label: _('Elevation:'),
          lo: 0,
          hi: 360,
          step: 1,
          digits: 0,
          tip: _('Direction angle for the light source on the YZ plane, in degrees'),
        },
      ];
    case LightSource.LIGHT_POINT:
      return [location];
    case LightSource.LIGHT_SPOT:
      return [
        location,
        { ...location, attrs: ['pointsAtX', 'pointsAtY', 'pointsAtZ'], label: _('Points at:') },
        {
          kind: 'spinscale',
          def: 1,
          attr: 'specularExponent',
          label: _('Specular Exponent:'),
          lo: 0.1,
          hi: 100,
          step: 0.1,
          digits: 1,
          tip: _('Exponent value controlling the focus for the light source'),
        },
        //TODO: here I have used 100 degrees as default value. But spec says that if not specified, no limiting cone is applied. So, there should be a way for the user to set a "no limiting cone" option.
        {
          kind: 'spinscale',
          def: 100,
          attr: 'limitingConeAngle',
          label: _('Cone Angle:'),
          lo: 0,
          hi: 180,
          step: 1,
          digits: 0,
          tip: _(
            'This is the angle between the spot light axis (i.e. the axis between the light source and the point to which it is pointing at) and the spot light cone. No light is projected outside this cone.',
          ),
        },
      ];
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------------------------
// Reading the widget values from the attributes (the set_from_attribute of the AttrWidgets)

/** A number attribute of o, or def if it is not set (SpinButtonAttr, SpinScaleAttr). */
export function read_spin(o: SPObject, attr: string, def: number): number {
  const val = o.getAttribute(attr);
  const n = val === null ? Number.NaN : Number.parseFloat(val);
  return Number.isFinite(n) ? n : def;
}

/** The two values of a "number [number]" attribute and whether they are linked (DualSpinScaleAttr). */
export function read_dual(
  o: SPObject,
  attr: string,
  def: number,
): { v1: number; v2: number; linked: boolean } {
  const val = o.getAttribute(attr);
  if (!val) return { v1: def, v2: def, linked: true };
  const toks = val.trim().split(/[\s,]+/);
  const v1 = Number.parseFloat(toks[0] ?? '') || 0;
  const v2 = toks[1] !== undefined ? Number.parseFloat(toks[1]) || 0 : v1;
  return { v1, v2, linked: toks[1] === undefined };
}

/** The attribute value of a DualSpinScale: one number when linked. */
export function dual_as_attribute(v1: number, v2: number, linked: boolean): string {
  return linked ? `${v1}` : `${v1} ${v2}`;
}

/** The two numbers of a number-optional-number attribute (DualSpinButton). */
export function read_number_opt_number(o: SPObject, attr: string, def: string): [number, number] {
  const n = new NumberOptNumber();
  n.set(o.getAttribute(attr) ?? def);
  return [n.getNumber(), n.getOptNumber(true)];
}

/** The state of a check button: the default if the value is neither on nor off. */
export function read_check(
  o: SPObject,
  spec: { attr: string; def: boolean; on: string; off: string },
): boolean {
  const val = o.getAttribute(spec.attr);
  if (val === spec.on) return true;
  if (val === spec.off) return false;
  return spec.def;
}

/** The color of a color attribute as #rrggbb (ColorButton). */
export function read_color(o: SPObject, attr: string, def: string): string {
  const color = Colors.Color.parse(o.getAttribute(attr));
  return color ? `#${(color.toRGBA() >>> 8).toString(16).padStart(6, '0')}` : def;
}

/** The rows and columns of the matrix of a primitive (MatrixAttr). */
export function matrix_size(o: SPObject): { rows: number; cols: number } {
  if (o instanceof SPFeConvolveMatrix) {
    const order = o.get_order();
    const cols = Math.min(Math.trunc(order.getNumber()), max_convolution_kernel_size);
    const rows = order.optNumIsSet() ? Math.trunc(order.getOptNumber()) : cols;
    return { rows, cols };
  }
  return { rows: 4, cols: 5 };
}

/** The values of the matrix of a primitive, rows × cols; missing values are of the identity matrix. */
export function matrix_values(o: SPObject): number[] {
  const { rows, cols } = matrix_size(o);
  let values: readonly number[] = [];
  if (o instanceof SPFeColorMatrix) values = o.get_values();
  else if (o instanceof SPFeConvolveMatrix) values = o.get_kernel_matrix();
  const out: number[] = [];
  let ndx = 0;
  for (let r = 0; r < rows; ++r) {
    // Default to identity matrix
    for (let c = 0; c < cols; ++c, ++ndx)
      out.push(ndx < values.length ? (values[ndx] ?? 0) : r === c ? 1 : 0);
  }
  return out;
}

/** The attribute value of a matrix. */
export function matrix_as_attribute(values: readonly number[]): string {
  return values.map((v) => `${v}`).join(' ');
}

/** The type of a color matrix and the single value of saturate and hueRotate (ColorMatrixValues). */
export function color_matrix_state(o: SPFeColorMatrix): { type: FilterColorMatrixType; value: number } {
  return { type: o.get_type(), value: o.get_value() };
}

/** Whether the K1..K4 settings apply (upstream update_settings_sensitivity). */
export function use_k(prim: SPFilterPrimitive | null): boolean {
  return (
    prim instanceof SPFeComposite &&
    prim.get_composite_operator() === FeCompositeOperator.COMPOSITE_ARITHMETIC
  );
}

/** Whether the primitive defines a subregion (SubregionScale). */
export function has_subregion(o: SPObject): boolean {
  return ['x', 'y', 'width', 'height'].some((a) => o.getAttribute(a) !== null);
}

// ---------------------------------------------------------------------------------------------
// Undo steps

/**
 * Set an attribute of o (the primitive or one of its children) of filter; the changes of one
 * attribute in a row are one undo step (upstream set_attr).
 */
export function set_attr(filter: SPFilter, o: SPObject, name: string, val: string | null): void {
  o.setAttribute(name, val);
  filter.requestModified(SP_OBJECT_MODIFIED_FLAG);
  DocumentUndo.maybeDone(
    filter.document,
    `filtereffects:${name}`,
    C_('Undo', 'Set filter primitive attribute'),
    ICON,
  );
}

/**
 * Set an attribute of the filter element (upstream set_filternode_attr). Upstream makes no undo
 * step here; the web port makes one so that the change is not merged into the next step.
 */
export function set_filternode_attr(filter: SPFilter, name: string, val: string): void {
  filter.setAttributeOrRemoveIfEmpty(name, val);
  filter.requestModified(SP_OBJECT_MODIFIED_FLAG);
  DocumentUndo.maybeDone(
    filter.document,
    `filtereffects:${name}`,
    C_('Undo', 'Set filter primitive attribute'),
    ICON,
  );
}

/** Define or remove the subregion of a primitive (the check button of SubregionScale). */
export function set_subregion(filter: SPFilter, prim: SPFilterPrimitive, on: boolean): void {
  const values: Record<string, string | null> = on
    ? { x: '0', y: '0', width: '100', height: '100' }
    : { x: null, y: null, width: null, height: null };
  for (const [name, val] of Object.entries(values)) prim.setAttribute(name, val);
  filter.requestModified(SP_OBJECT_MODIFIED_FLAG);
  DocumentUndo.done(filter.document, C_('Undo', 'Set filter primitive attribute'), ICON);
}

// ---------------------------------------------------------------------------------------------
// The filter list (upstream FilterModifier)

/** The filters of the document in document order (upstream getResourceList("filter")). */
export function get_filters(document: SPDocument): SPFilter[] {
  const list: SPFilter[] = [];
  const walk = (o: SPObject) => {
    if (o instanceof SPFilter) list.push(o);
    else for (const c of o.children) walk(c);
  };
  const root = document.getRoot();
  if (root) walk(root);
  return list;
}

/** The name of a filter in the list: its label, its id or "filter". */
export function get_filter_name(filter: SPFilter | null): string {
  if (!filter) return '';
  return filter.label() ?? filter.getId() ?? _('filter');
}

/**
 * The "sel" column of the filters: the number of different filters of the selected items for each
 * filter that a selected item uses (upstream update_selection).
 */
export function filter_selection_counts(items: Iterable<SPItem>): Map<SPFilter, number> {
  const used = new Set<SPFilter>();
  for (const obj of items) {
    const style = obj.style;
    if (style.filter.set) {
      const f = style.getFilter();
      if (f) used.add(f);
    }
  }
  return new Map([...used].map((f) => [f, used.size]));
}

/** Add a new empty filter labelled "filter<count>" (upstream add_filter). */
export function add_filter(document: SPDocument, count: number): SPFilter {
  const filter = new_filter(document);
  filter.setAttribute('inkscape:label', `${_('filter')}${count}`);
  DocumentUndo.done(document, C_('Undo', 'Add filter'), ICON);
  return filter;
}

/** The items below the current root that use filter. */
function items_with_filter(desktop: SPDesktop, filter: SPFilter): SPItem[] {
  const root = desktop.layerManager().currentRoot();
  if (!root) return [];
  return get_all_items(root, desktop, false, false, true).filter(
    (item) => item.style.filter.set && item.style.getFilter() === filter,
  );
}

/** Remove the filter and all references to it (upstream remove_filter). */
export function remove_filter(desktop: SPDesktop, filter: SPFilter): void {
  const doc = filter.document;
  // Delete all references to this filter
  for (const item of items_with_filter(desktop, filter)) remove_item_filter(item, false);
  //XML Tree being used directly here while it shouldn't be.
  const repr = filter.getRepr();
  repr.parent()?.removeChild(repr);
  DocumentUndo.done(doc, C_('Undo', 'Remove filter'), ICON);
}

/** Append a copy of filter after the other filters (upstream duplicate_filter). */
export function duplicate_filter(filter: SPFilter): SPFilter | null {
  const doc = filter.document;
  const repr = filter.getRepr();
  const parent = repr.parent();
  if (!parent) return null;
  const copy = repr.duplicate(doc.getReprDoc());
  parent.appendChild(copy);
  DocumentUndo.done(doc, C_('Undo', 'Duplicate filter'), ICON);
  const f = doc.getObjectByRepr(copy);
  return f instanceof SPFilter ? f : null;
}

/** Set the label of filter (upstream on_name_edited). */
export function rename_filter(filter: SPFilter, text: string): void {
  filter.setAttribute('inkscape:label', text);
  DocumentUndo.done(filter.document, C_('Undo', 'Rename filter'), ICON);
}

/**
 * Apply filter to the selected items; if toggle and the selection uses only this filter, remove
 * the filters instead (upstream selection_toggled).
 */
export function selection_toggled(desktop: SPDesktop, filter: SPFilter, toggle: boolean): void {
  const sel = desktop.getSelection();
  const counts = filter_selection_counts(sel.items());
  /* If this filter is the only one used in the selection, unset it */
  const apply = counts.get(filter) === 1 && toggle ? null : filter;
  for (const item of sel.items()) {
    if (apply) spStyleSetPropertyUrl(item, 'filter', apply, false);
    else remove_item_filter(item, false);
    item.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_STYLE_MODIFIED_FLAG);
  }
  DocumentUndo.done(filter.document, C_('Undo', 'Apply filter'), ICON);
}

/** Select the items that use filter (upstream select_filter_elements). */
export function select_filter_elements(desktop: SPDesktop, filter: SPFilter): void {
  desktop.getSelection().setList(items_with_filter(desktop, filter));
}

// ---------------------------------------------------------------------------------------------
// The primitive list (upstream PrimitiveList)

/** A row of the primitive list. */
export interface PrimitiveRow {
  primitive: SPFilterPrimitive;
  type_id: FilterPrimitiveType;
  /** Translated type label. */
  type: string;
  id: string | null;
}

/** The primitives of filter (upstream PrimitiveList::update). */
export function primitive_rows(filter: SPFilter | null): PrimitiveRow[] {
  const rows: PrimitiveRow[] = [];
  if (!filter) return rows;
  for (const prim_obj of filter.children) {
    if (!(prim_obj instanceof SPFilterPrimitive)) break;
    //XML Tree being used directly here while it shouldn't be.
    const type_id = FPConverter.get_id_from_key(prim_obj.getRepr().name());
    rows.push({
      primitive: prim_obj,
      type_id,
      type: _(FPConverter.get_label(type_id)),
      id: prim_obj.getId(),
    });
  }
  return rows;
}

export enum EffectCategory {
  Effect,
  Compose,
  Colors,
  Generation,
}

/** The translated name of a category of the primitive menu. */
export function get_category_name(category: EffectCategory): string {
  return [_('Effect'), _('Compositing'), _('Color editing'), _('Generating')][category] ?? '';
}

const EFFECTS: readonly [FilterPrimitiveType, EffectCategory, string][] = [
  [
    FilterPrimitiveType.NR_FILTER_GAUSSIANBLUR,
    EffectCategory.Effect,
    N_('Uniformly blurs its input. Commonly used together with Offset to create a drop shadow effect.'),
  ],
  [
    FilterPrimitiveType.NR_FILTER_MORPHOLOGY,
    EffectCategory.Effect,
    N_(
      'Provides erode and dilate effects. For single-color objects erode makes the object thinner and dilate makes it thicker.',
    ),
  ],
  [
    FilterPrimitiveType.NR_FILTER_OFFSET,
    EffectCategory.Effect,
    N_('Offsets the input by an user-defined amount. Commonly used for drop shadow effects.'),
  ],
  [
    FilterPrimitiveType.NR_FILTER_CONVOLVEMATRIX,
    EffectCategory.Effect,
    N_(
      'Performs a convolution on the input image enabling effects like blur, sharpening, embossing and edge detection.',
    ),
  ],
  [
    FilterPrimitiveType.NR_FILTER_DISPLACEMENTMAP,
    EffectCategory.Effect,
    N_(
      'Displaces pixels from the first input using the second as a map of displacement intensity. Classical examples are whirl and pinch effects.',
    ),
  ],
  [
    FilterPrimitiveType.NR_FILTER_DROPSHADOW,
    EffectCategory.Effect,
    N_(
      'Creates a drop shadow of the input image. Combines offset, blur, and compositing in a single convenient primitive.',
    ),
  ],
  [
    FilterPrimitiveType.NR_FILTER_TILE,
    EffectCategory.Effect,
    N_(
      'Tiles a region with an input graphic. The source tile is defined by the filter primitive subregion of the input.',
    ),
  ],
  [
    FilterPrimitiveType.NR_FILTER_COMPOSITE,
    EffectCategory.Compose,
    N_(
      'Composites two images using one of the Porter-Duff blending modes or the arithmetic mode described in SVG standard.',
    ),
  ],
  [
    FilterPrimitiveType.NR_FILTER_BLEND,
    EffectCategory.Compose,
    N_('Provides image blending modes, such as screen, multiply, darken and lighten.'),
  ],
  [
    FilterPrimitiveType.NR_FILTER_MERGE,
    EffectCategory.Compose,
    N_(
      "Merges multiple inputs using normal alpha compositing. Equivalent to using several Blend primitives in 'normal' mode or several Composite primitives in 'over' mode.",
    ),
  ],
  [
    FilterPrimitiveType.NR_FILTER_COLORMATRIX,
    EffectCategory.Colors,
    N_(
      'Modifies pixel colors based on a transformation matrix. Useful for adjusting color hue and saturation.',
    ),
  ],
  [
    FilterPrimitiveType.NR_FILTER_COMPONENTTRANSFER,
    EffectCategory.Colors,
    N_(
      'Manipulates color components according to particular transfer functions. Useful for brightness and contrast adjustment, color balance, and thresholding.',
    ),
  ],
  [
    FilterPrimitiveType.NR_FILTER_DIFFUSELIGHTING,
    EffectCategory.Colors,
    N_(
      'Creates "embossed" shadings.  The input\'s alpha channel is used to provide depth information: higher opacity areas are raised toward the viewer and lower opacity areas recede away from the viewer.',
    ),
  ],
  [
    FilterPrimitiveType.NR_FILTER_SPECULARLIGHTING,
    EffectCategory.Colors,
    N_(
      'Creates "embossed" shadings.  The input\'s alpha channel is used to provide depth information: higher opacity areas are raised toward the viewer and lower opacity areas recede away from the viewer.',
    ),
  ],
  [
    FilterPrimitiveType.NR_FILTER_FLOOD,
    EffectCategory.Generation,
    N_(
      'Fills the region with a given color and opacity. Often used as input to other filters to apply color to a graphic.',
    ),
  ],
  [
    FilterPrimitiveType.NR_FILTER_IMAGE,
    EffectCategory.Generation,
    N_('Fills the region with graphics from an external file or from another portion of the document.'),
  ],
  [
    FilterPrimitiveType.NR_FILTER_TURBULENCE,
    EffectCategory.Generation,
    N_(
      'Renders Perlin noise, which is useful to generate textures such as clouds, fire, smoke, marble or granite.',
    ),
  ],
];

/** An item of the "add effect" menu. */
export interface EffectMenuItem {
  type: FilterPrimitiveType;
  label: string;
  category: EffectCategory;
  tooltip: string;
}

/** The items of the "add effect" menu, by category and label (upstream add_effects). */
export function get_effect_menu(): EffectMenuItem[] {
  return EFFECTS.map(([type, category, tooltip]) => ({
    type,
    label: _(FPConverter.get_label(type)),
    category,
    tooltip: _(tooltip),
  })).sort((a, b) => a.category - b.category || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
}

/** Add a primitive of type to filter (upstream add_filter_primitive). */
export function add_filter_primitive(filter: SPFilter, type: FilterPrimitiveType): SPFilterPrimitive {
  const prim = filter_add_primitive(filter, type);
  DocumentUndo.done(filter.document, C_('Undo', 'Add filter primitive'), ICON);
  return prim;
}

/** Remove a primitive (upstream remove_selected). */
export function remove_primitive(prim: SPFilterPrimitive): void {
  const doc = prim.document;
  //XML Tree being used directly here while it shouldn't be.
  const repr = prim.getRepr();
  repr.parent()?.removeChild(repr);
  DocumentUndo.done(doc, C_('Undo', 'Remove filter primitive'), ICON);
}

/** Append a copy of prim to filter (upstream duplicate_primitive). */
export function duplicate_primitive(filter: SPFilter, prim: SPFilterPrimitive): SPFilterPrimitive | null {
  const repr = prim.getRepr().duplicate(prim.getRepr().document());
  filter.getRepr().appendChild(repr);
  DocumentUndo.done(filter.document, C_('Undo', 'Duplicate filter primitive'), ICON);
  const p = filter.document.getObjectByRepr(repr);
  return p instanceof SPFilterPrimitive ? p : null;
}

// Checks all of prim's inputs, removes any that use result
function check_single_connection(prim: SPFilterPrimitive, result: number): void {
  if (result < 0) return;
  if (prim.get_in() === result) prim.removeAttribute('in');
  if (prim instanceof SPFeBlend || prim instanceof SPFeComposite || prim instanceof SPFeDisplacementMap) {
    if (prim.get_in2() === result) prim.removeAttribute('in2');
  }
}

// Remove any connections going to/from prim that forward-reference other primitives
// (the slots are those of the order before the move).
function sanitize_connections(filter: SPFilter, prim: SPFilterPrimitive): void {
  let before = true;
  for (const { primitive: cur_prim } of primitive_rows(filter)) {
    if (cur_prim === prim) before = false;
    else if (before) check_single_connection(cur_prim, prim.get_out());
    else check_single_connection(prim, cur_prim.get_out());
  }
}

/**
 * Move prim to position ndx of the primitives and remove the connections that then point
 * forward (upstream on_row_deleted after a drag).
 */
export function move_primitive(filter: SPFilter, prim: SPFilterPrimitive, ndx: number): void {
  filter.ensure_slots();
  prim.getRepr().setPosition(ndx);
  sanitize_connections(filter, prim);
  filter.requestModified(SP_OBJECT_MODIFIED_FLAG);
  DocumentUndo.done(filter.document, C_('Undo', 'Reorder filter primitive'), ICON);
}

/** The number of inputs of a primitive; Merge has one more than its merge nodes (upstream input_count). */
export function input_count(prim: SPFilterPrimitive | null): number {
  if (!prim) return 0;
  if (prim instanceof SPFeBlend || prim instanceof SPFeComposite || prim instanceof SPFeDisplacementMap)
    return 2;
  if (prim instanceof SPFeMerge) return prim.children.length + 1;
  return 1;
}

/** The value of input n (0-based) of prim: its in/in2 attribute, or the in of merge node n. */
export function get_input(prim: SPFilterPrimitive, n: number): string | null {
  if (prim instanceof SPFeMerge) {
    const node = prim.children.filter((c) => c instanceof SPFeMergeNode)[n];
    return node?.getAttribute('in') ?? null;
  }
  return prim.getAttribute(n === 0 ? 'in' : 'in2');
}

/** A source that an input can connect to: a standard input or an earlier primitive. */
export type InputSource = { input: string } | { primitive: SPFilterPrimitive };

/**
 * The sources an input of prim can connect to: the standard inputs, then the primitives before
 * prim (the connection canvas of upstream allows the same).
 */
export function input_sources(
  filter: SPFilter,
  prim: SPFilterPrimitive,
): { label: string; source: InputSource }[] {
  const list: { label: string; source: InputSource }[] = FPInputData.map((d) => ({
    label: _(d.label),
    source: { input: d.key },
  }));
  for (const row of primitive_rows(filter)) {
    if (row.primitive === prim) break;
    const result = row.primitive.getAttribute('result');
    list.push({ label: result ? `${row.type} (${result})` : row.type, source: { primitive: row.primitive } });
  }
  return list;
}

/**
 * Connect input n of prim to source, or disconnect it if source is null; a merge input that is
 * past the merge nodes adds a node, and a null merge input removes its node (upstream
 * on_click_released). A primitive source gets a result name if it has none.
 */
export function set_input(
  filter: SPFilter,
  prim: SPFilterPrimitive,
  n: number,
  source: InputSource | null,
): void {
  let in_val: string | null = null;
  if (source && 'input' in source) in_val = source.input;
  else if (source) {
    const repr = source.primitive.getRepr();
    // Make sure the target has a result
    const gres = repr.attribute('result');
    if (!gres) {
      in_val = filter.get_new_result_name();
      repr.setAttributeOrRemoveIfEmpty('result', in_val);
    } else in_val = gres;
  }

  if (prim instanceof SPFeMerge) {
    const nodes = prim.children.filter((c) => c instanceof SPFeMergeNode);
    const node = nodes[n];
    if (node) {
      // If input is null, delete it
      if (!in_val) {
        //XML Tree being used directly here while it shouldn't be.
        node.getRepr().parent()?.removeChild(node.getRepr());
        DocumentUndo.done(prim.document, C_('Undo', 'Remove merge node'), ICON);
      } else set_attr(filter, node, 'in', in_val);
    } else if (n === nodes.length && in_val) {
      // Add new input?
      const repr = prim.document.getReprDoc().createElement('svg:feMergeNode');
      repr.setAttribute('inkscape:collect', 'always');
      //XML Tree being used directly here while it shouldn't be.
      prim.getRepr().appendChild(repr);
      const merge_node = prim.document.getObjectByRepr(repr);
      if (merge_node) set_attr(filter, merge_node, 'in', in_val);
    }
  } else set_attr(filter, prim, n === 0 ? 'in' : 'in2', in_val);
}

// ---------------------------------------------------------------------------------------------
// Component transfer and light sources

/** The transfer function node of a channel; FuncNodes can be in any order (upstream find_node). */
export function find_func_node(ct: SPFeComponentTransfer, channel: number): SPFeFuncNode | null {
  for (const node of ct.children) if (node instanceof SPFeFuncNode && node.channel === channel) return node;
  return null;
}

/** The type of the transfer function of a channel; identity if there is no node. */
export function func_type(ct: SPFeComponentTransfer, channel: number): FilterComponentTransferType {
  const node = find_func_node(ct, channel);
  const key = node?.getAttribute('type');
  return key && ComponentTransferTypeConverter.is_valid_key(key)
    ? ComponentTransferTypeConverter.get_id_from_key(key)
    : FilterComponentTransferType.COMPONENTTRANSFER_TYPE_IDENTITY;
}

/**
 * The transfer function node of a channel, created with type identity if it is missing (upstream
 * creates it when the settings are shown; the web port creates it on the first change).
 */
export function ensure_func_node(ct: SPFeComponentTransfer, channel: number): SPFeFuncNode | null {
  const found = find_func_node(ct, channel);
  if (found) return found;
  const name = ['svg:feFuncR', 'svg:feFuncG', 'svg:feFuncB', 'svg:feFuncA'][channel];
  if (!name) return null;
  const repr = ct.document.getReprDoc().createElement(name);
  //XML Tree being used directly here while it shouldn't be.
  ct.getRepr().appendChild(repr);
  const node = find_func_node(ct, channel);
  node?.setAttribute('type', 'identity');
  return node;
}

/** Set the type of the transfer function of a channel (upstream on_type_changed). */
export function set_func_type(
  filter: SPFilter,
  ct: SPFeComponentTransfer,
  channel: number,
  type: FilterComponentTransferType,
): void {
  const node = ensure_func_node(ct, channel);
  if (!node) return;
  node.setAttributeOrRemoveIfEmpty('type', ComponentTransferTypeConverter.get_key(type));
  filter.requestModified(SP_OBJECT_MODIFIED_FLAG);
  DocumentUndo.done(ct.document, C_('Undo', 'New transfer function type'), ICON);
}

/** The light source of a lighting primitive, or null if it has none. */
export function get_light_source(prim: SPFilterPrimitive): LightSource | null {
  const child = prim.children[0];
  if (child instanceof SPFeDistantLight) return LightSource.LIGHT_DISTANT;
  if (child instanceof SPFePointLight) return LightSource.LIGHT_POINT;
  if (child instanceof SPFeSpotLight) return LightSource.LIGHT_SPOT;
  return null;
}

/** Replace the light source of a lighting primitive (upstream on_source_changed). */
export function set_light_source(prim: SPFilterPrimitive, ls: LightSource | null): void {
  // Check if the light source type has changed
  if (get_light_source(prim) === ls) return;
  const child = prim.children[0];
  //XML Tree being used directly here while it shouldn't be.
  if (child) child.getRepr().parent()?.removeChild(child.getRepr());
  if (ls !== null) {
    const repr = prim.document.getReprDoc().createElement(LightSourceConverter.get_key(ls));
    prim.getRepr().appendChild(repr);
  }
  DocumentUndo.done(prim.document, C_('Undo', 'New light source'), ICON);
}

/** The text in the settings area when no primitive is selected (upstream update_settings_view). */
export function empty_settings_text(filter: SPFilter | null, present: boolean): string {
  if (filter) return _('Add effect from the search bar');
  if (present) return _('Select a filter');
  return _('No filters in the document');
}
