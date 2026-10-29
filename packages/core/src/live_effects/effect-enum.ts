// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/effect-enum.h, src/live_effects/effect.cpp
/*
 * Inkscape::LivePathEffect::EffectType
 *
 * Copyright (C) Johan Engelen 2008 <j.b.c.engelen@utwente.nl>
 */
import { N_, NC_ } from '../i18n.ts';

// Please fill in the same order than in effect.cpp:98
export enum EffectType {
  BEND_PATH = 0,
  GEARS,
  PATTERN_ALONG_PATH,
  CURVE_STITCH,
  VONKOCH,
  KNOT,
  CONSTRUCT_GRID,
  SPIRO,
  ENVELOPE,
  INTERPOLATE,
  ROUGH_HATCHES,
  SKETCH,
  RULER,
  POWERSTROKE,
  CLONE_ORIGINAL,
  SIMPLIFY,
  LATTICE2,
  PERSPECTIVE_ENVELOPE,
  INTERPOLATE_POINTS,
  TRANSFORM_2PTS,
  SHOW_HANDLES,
  ROUGHEN,
  BSPLINE,
  JOIN_TYPE,
  TAPER_STROKE,
  MIRROR_SYMMETRY,
  COPY_ROTATE,
  ATTACH_PATH,
  FILL_BETWEEN_MANY,
  ELLIPSE_5PTS,
  BOUNDING_BOX,
  MEASURE_SEGMENTS,
  FILLET_CHAMFER,
  POWERCLIP,
  POWERMASK,
  PTS2ELLIPSE,
  OFFSET,
  DASHED_STROKE,
  BOOL_OP,
  SLICE,
  TILING,
  // PUT NEW LPE BEFORE EXPERIMENTAL IN THE SAME ORDER AS IN effect.cpp
  // Visible Experimental LPE's
  ANGLE_BISECTOR,
  CIRCLE_WITH_RADIUS,
  CIRCLE_3PTS,
  EXTRUDE,
  LINE_SEGMENT,
  PARALLEL,
  PERP_BISECTOR,
  TANGENT_TO_CURVE,
  FILL_BETWEEN_STROKES,
  // Hidden Experimental LPE's
  DOEFFECTSTACK_TEST,
  DYNASTROKE,
  LATTICE,
  PATH_LENGTH,
  RECURSIVE_SKELETON,
  TEXT_LABEL,
  EMBRODERY_STITCH,
  INVALID_LPE, // This must be last
}

// ALPHABETIC
export enum ParamType {
  ARRAY = 0,
  BOOL,
  COLOR_PICKER,
  ENUM,
  ENUM_ARRAY,
  FONT_BUTTON,
  HIDDEN,
  MESSAGE,
  NODE_SATELLITE_ARRAY,
  ORIGINAL_PATH,
  ORIGINAL_SATELLITE,
  PATH_REFERENCE,
  PATH,
  PATH_ARRAY,
  POINT,
  POWERSTROKE_POINT_ARRAY,
  RANDOM,
  SATELLITE,
  SATELLITE_ARRAY,
  SCALAR,
  SCALAR_ARRAY,
  TEXT,
  TOGGLE_BUTTON,
  TRANSFORMED_POINT,
  UNIT,
  VECTOR,
  INVALID_PARAM, // This must be last
}

export enum LPECategory {
  Undefined,
  Favorites,
  EditTools,
  Distort,
  Generate,
  Convert,
  Experimental,
}

/** An effect with its UI label, SVG key, icon and description (untranslated). */
export interface EnumEffectData<E extends number> {
  id: E;
  label: string;
  key: string;
  icon: string;
  description: string;
  category: LPECategory;
  on_path: boolean;
  on_shape: boolean;
  on_group: boolean;
  on_image: boolean;
  on_text: boolean;
  experimental: boolean;
}

/**
 * Simplified management of enumerations of LPE items with UI labels.
 * get_id_from_key and get_id_from_label return 0 if they cannot find an entry for that key string;
 * get_label and get_key return an empty string when the requested id is not in the list.
 */
export class EnumEffectDataConverter<E extends number> {
  readonly _length: number;
  readonly #data: readonly EnumEffectData<E>[];

  constructor(cd: readonly EnumEffectData<E>[]) {
    this.#data = cd;
    this._length = cd.length;
  }

  #find(id: E): EnumEffectData<E> | undefined {
    return this.#data.find((d) => d.id === id);
  }
  get_id_from_label(label: string): E {
    return this.#data.find((d) => d.label === label)?.id ?? (0 as E);
  }
  get_id_from_key(key: string): E {
    return this.#data.find((d) => d.key === key)?.id ?? (0 as E);
  }
  is_valid_key(key: string): boolean {
    return this.#data.some((d) => d.key === key);
  }
  is_valid_id(id: E): boolean {
    return this.#find(id) !== undefined;
  }
  get_label(id: E): string {
    return this.#find(id)?.label ?? '';
  }
  get_key(id: E): string {
    return this.#find(id)?.key ?? '';
  }
  get_icon(id: E): string {
    return this.#find(id)?.icon ?? '';
  }
  get_description(id: E): string {
    return this.#find(id)?.description ?? '';
  }
  get_category(id: E): LPECategory {
    return this.#find(id)?.category ?? LPECategory.Undefined;
  }
  get_on_path(id: E): boolean {
    return this.#find(id)?.on_path ?? false;
  }
  get_on_shape(id: E): boolean {
    return this.#find(id)?.on_shape ?? false;
  }
  get_on_group(id: E): boolean {
    return this.#find(id)?.on_group ?? false;
  }
  get_on_image(id: E): boolean {
    return this.#find(id)?.on_image ?? false;
  }
  get_on_text(id: E): boolean {
    return this.#find(id)?.on_text ?? false;
  }
  get_experimental(id: E): boolean {
    return this.#find(id)?.experimental ?? false;
  }
  data(i: number): EnumEffectData<E> {
    return this.#data[i] as EnumEffectData<E>;
  }
}

const entry = (
  id: EffectType,
  label: string,
  key: string,
  icon: string,
  description: string,
  category: LPECategory,
): EnumEffectData<EffectType> => ({
  id,
  label,
  key,
  icon,
  description,
  category,
  on_path: true,
  on_shape: true,
  on_group: true,
  on_image: false,
  on_text: false,
  experimental: false,
});

/**
 * The effects of upstream LPETypeData (effect.cpp) that are ported, in the upstream order.
 * Documents that use another effect keep it, but its stack is disabled as upstream does for an
 * unknown effect. TODO: the other effects.
 */
export const LPETypeData: readonly EnumEffectData<EffectType>[] = [
  // {constant defined in effect-enum.h, N_("name of your effect"), "name of your effect in SVG"}
  /* 0.46 */
  entry(
    EffectType.BEND_PATH,
    NC_('path effect', 'Bend'),
    'bend_path',
    'bend-path',
    N_('Bend an object along the curvature of another path'),
    LPECategory.Distort,
  ),
  /* 0.91 */
  entry(
    EffectType.SIMPLIFY,
    NC_('path effect', 'Simplify'),
    'simplify',
    'simplify',
    N_("Smoothen and simplify a object. This effect is also available in the Pencil tool's tool controls."),
    LPECategory.EditTools,
  ),
  entry(
    EffectType.ROUGHEN,
    NC_('path effect', 'Roughen'),
    'roughen',
    'roughen',
    N_('Roughen an object by adding and randomly shifting new nodes'),
    LPECategory.Distort,
  ),
  entry(
    EffectType.MIRROR_SYMMETRY,
    NC_('path effect', 'Mirror symmetry'),
    'mirror_symmetry',
    'mirror-symmetry',
    N_(
      'Mirror an object along a movable axis, or around the page center. The mirrored copy can be styled independently.',
    ),
    LPECategory.Generate,
  ),
  entry(
    EffectType.COPY_ROTATE,
    NC_('path effect', 'Rotate copies'),
    'copy_rotate',
    'copy-rotate',
    N_(
      'Create multiple rotated copies of an object, as in a kaleidoscope. The copies can be styled independently.',
    ),
    LPECategory.Generate,
  ),
  /* 1.0 */
  entry(
    EffectType.OFFSET,
    NC_('path effect', 'Offset'),
    'offset',
    'offset',
    N_('Offset the path, optionally keeping cusp corners cusp'),
    LPECategory.EditTools,
  ),
];

export const LPETypeConverter = new EnumEffectDataConverter<EffectType>(LPETypeData);
