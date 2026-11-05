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
  on_shape = true,
  on_group = true,
): EnumEffectData<EffectType> => ({
  id,
  label,
  key,
  icon,
  description,
  category,
  on_path: true,
  on_shape,
  on_group,
  on_image: false,
  on_text: false,
  experimental: false,
});

/** An effect of the category Experimental (icon "experimental"; shown with "Show experimental effects"). */
const experimentalEntry = (
  id: EffectType,
  label: string,
  key: string,
  description: string,
): EnumEffectData<EffectType> => ({
  ...entry(id, label, key, 'experimental', description, LPECategory.Experimental),
  experimental: true,
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
  entry(
    EffectType.GEARS,
    NC_('path effect', 'Gears'),
    'gears',
    'gears',
    N_('Create interlocking, configurable gears based on the nodes of a path'),
    LPECategory.Convert,
  ),
  entry(
    EffectType.PATTERN_ALONG_PATH,
    NC_('path effect', 'Pattern Along Path'),
    'skeletal',
    'skeletal',
    N_('Place one or more copies of another path along the path'),
    LPECategory.Distort,
  ),
  /* 0.47 */
  entry(
    EffectType.VONKOCH,
    NC_('path effect', 'VonKoch'),
    'vonkoch',
    'vonkoch',
    N_('Create VonKoch fractal'),
    LPECategory.Generate,
  ),
  entry(
    EffectType.KNOT,
    NC_('path effect', 'Knot'),
    'knot',
    'knot',
    N_('Create gaps in self-intersections, as in Celtic knots'),
    LPECategory.EditTools,
  ),
  entry(
    EffectType.SPIRO,
    NC_('path effect', 'Spiro spline'),
    'spiro',
    'spiro',
    N_(
      'Make the path curl like wire, using Spiro B-Splines. This effect is usually used directly on the canvas with the Spiro mode of the drawing tools.',
    ),
    LPECategory.Convert,
    false,
    false,
  ),
  entry(
    EffectType.ENVELOPE,
    NC_('path effect', 'Envelope Deformation'),
    'envelope',
    'envelope',
    N_('Adjust the shape of an object by transforming paths on its four sides'),
    LPECategory.Distort,
  ),
  entry(
    EffectType.INTERPOLATE,
    NC_('path effect', 'Interpolate Sub-Paths'),
    'interpolate',
    'interpolate',
    N_(
      'Create a smooth transition between the two subpaths of a path, blending their shapes together in steps.',
    ),
    LPECategory.Generate,
    false,
    false,
  ),
  entry(
    EffectType.ROUGH_HATCHES,
    NC_('path effect', 'Hatches (rough)'),
    'rough_hatches',
    'rough-hatches',
    N_('Fill the object with adjustable hatching'),
    LPECategory.Generate,
  ),
  entry(
    EffectType.SKETCH,
    NC_('path effect', 'Sketch'),
    'sketch',
    'sketch',
    N_('Draw multiple short strokes along the path, as in a pencil sketch'),
    LPECategory.Generate,
  ),
  /* 0.91 */
  entry(
    EffectType.POWERSTROKE,
    NC_('path effect', 'Power stroke'),
    'powerstroke',
    'powerstroke',
    N_(
      'Create calligraphic strokes and control their variable width and curvature. This effect can also be used directly on the canvas with a pressure sensitive stylus and the Pencil tool.',
    ),
    LPECategory.EditTools,
    true,
    false,
  ),
  entry(
    EffectType.CLONE_ORIGINAL,
    NC_('path effect', 'Clone original'),
    'clone_original',
    'clone-original',
    N_('Let an object take on the shape, fill, stroke and/or other attributes of another object.'),
    LPECategory.Generate,
  ),
  /* 0.92 */
  entry(
    EffectType.SIMPLIFY,
    NC_('path effect', 'Simplify'),
    'simplify',
    'simplify',
    N_("Smoothen and simplify a object. This effect is also available in the Pencil tool's tool controls."),
    LPECategory.EditTools,
  ),
  entry(
    EffectType.LATTICE2,
    NC_('path effect', 'Lattice Deformation'),
    'lattice2',
    'lattice2',
    N_("Warp an object's shape based on a 5x5 grid"),
    LPECategory.Distort,
  ),
  entry(
    EffectType.PERSPECTIVE_ENVELOPE,
    NC_('path effect', 'Perspective/Envelope'),
    'perspective-envelope', // wrong key with "-" retain because historic
    'perspective-envelope',
    N_(
      'Transform the object to fit into a shape with four corners, either by stretching it or creating the illusion of a 3D-perspective',
    ),
    LPECategory.Distort,
  ),
  entry(
    EffectType.SHOW_HANDLES,
    NC_('path effect', 'Show handles'),
    'show_handles',
    'show-handles',
    N_('Draw the handles and nodes of objects (replaces the original styling with a black stroke)'),
    LPECategory.Convert,
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
    EffectType.BSPLINE,
    NC_('path effect', 'BSpline'),
    'bspline',
    'bspline',
    N_(
      "Create a BSpline that molds into the path's corners. This effect is usually used directly on the canvas with the BSpline mode of the drawing tools.",
    ),
    LPECategory.Convert,
    false,
    false,
  ),
  entry(
    EffectType.JOIN_TYPE,
    NC_('path effect', 'Join type'),
    'join_type',
    'join-type',
    N_("Select among various join types for a object's corner nodes (mitre, rounded, extrapolated arc, ...)"),
    LPECategory.Convert,
  ),
  entry(
    EffectType.TAPER_STROKE,
    NC_('path effect', 'Taper stroke'),
    'taper_stroke',
    'taper-stroke',
    N_("Let the path's ends narrow down to a tip"),
    LPECategory.EditTools,
    true,
    false,
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
  entry(
    EffectType.ATTACH_PATH,
    NC_('path effect', 'Attach path'),
    'attach_path',
    'attach-path',
    N_("Glue the current path's ends to a specific position on one or two other paths"),
    LPECategory.Convert,
  ),
  entry(
    EffectType.FILL_BETWEEN_MANY,
    NC_('path effect', 'Fill between many'),
    'fill_between_many',
    'fill-between-many',
    N_(
      'Turn the path into a fill between multiple other open paths (e.g. between paths with PowerStroke applied to them)',
    ),
    LPECategory.Generate,
  ),
  entry(
    EffectType.BOUNDING_BOX,
    NC_('path effect', 'Bounding Box'),
    'bounding_box',
    'bounding-box',
    N_('Turn the path into a bounding box that entirely encompasses another path'),
    LPECategory.Convert,
  ),
  /* 1.0 */
  entry(
    EffectType.FILLET_CHAMFER,
    NC_('path effect', 'Corners'),
    'fillet_chamfer',
    'fillet-chamfer',
    N_(
      "Fillet/Chamfer: Adjust the shape of a path's corners, rounding them to a specified radius, or cutting them off",
    ),
    LPECategory.EditTools,
    true,
    false,
  ),
  entry(
    EffectType.POWERCLIP,
    NC_('path effect', 'Power clip'),
    'powerclip',
    'powerclip',
    N_('Invert, hide or flatten a clip (apply like a Boolean operation)'),
    LPECategory.Generate,
  ),
  entry(
    EffectType.POWERMASK,
    NC_('path effect', 'Power mask'),
    'powermask',
    'powermask',
    N_('Invert or hide a mask, or use its negative'),
    LPECategory.Generate,
  ),
  entry(
    EffectType.OFFSET,
    NC_('path effect', 'Offset'),
    'offset',
    'offset',
    N_('Offset the path, optionally keeping cusp corners cusp'),
    LPECategory.EditTools,
  ),
  entry(
    EffectType.DASHED_STROKE,
    NC_('path effect', 'Dashed Stroke'),
    'dashed_stroke',
    'dashed-stroke',
    N_(
      'Add a dashed stroke whose dashes end exactly on a node, optionally with the same number of dashes per path segment',
    ),
    LPECategory.Convert,
  ),
  /* Construction and measuring effects */
  entry(
    EffectType.CURVE_STITCH,
    NC_('path effect', 'Stitch Sub-Paths'),
    'curvestitching',
    'curvestitching',
    N_('Draw perpendicular lines between subpaths of a path, like rungs of a ladder'),
    LPECategory.Generate,
    false,
  ),
  entry(
    EffectType.CONSTRUCT_GRID,
    NC_('path effect', 'Construct grid'),
    'construct_grid',
    'construct-grid',
    N_('Create a (perspective) grid from a 3-node path'),
    LPECategory.Convert,
    true,
    false,
  ),
  entry(
    EffectType.RULER,
    NC_('path effect', 'Ruler'),
    'ruler',
    'ruler',
    N_("Add ruler marks to the object in adjustable intervals, using the object's stroke style."),
    LPECategory.Convert,
    true,
    false,
  ),
  entry(
    EffectType.INTERPOLATE_POINTS,
    NC_('path effect', 'Interpolate points'),
    'interpolate_points',
    'interpolate-points',
    N_('Change the type of all nodes on the path. Useful for smoothing the shape or making it sharp.'),
    LPECategory.Convert,
    true,
    false,
  ),
  entry(
    EffectType.TRANSFORM_2PTS,
    NC_('path effect', 'Transform by 2 points'),
    'transform_2pts',
    'transform-2pts',
    N_('Scale, stretch and rotate an object by two handles'),
    LPECategory.Distort,
    true,
    false,
  ),
  entry(
    EffectType.ELLIPSE_5PTS,
    NC_('path effect', 'Ellipse by 5 points'),
    'ellipse_5pts',
    'ellipse-5pts',
    N_('Create an ellipse from 5 nodes on its circumference'),
    LPECategory.Convert,
    false,
    false,
  ),
  entry(
    EffectType.MEASURE_SEGMENTS,
    NC_('path effect', 'Measure Segments'),
    'measure_segments',
    'measure-segments',
    N_(
      'Add dimensioning for distances between nodes, optionally with projection and many other configuration options',
    ),
    LPECategory.Convert,
    false,
    false,
  ),
  entry(
    EffectType.PTS2ELLIPSE,
    NC_('path effect', 'Ellipse from points'),
    'pts2ellipse',
    'pts2ellipse',
    N_('Draw a circle, ellipse, arc or slice based on the nodes of a path'),
    LPECategory.Convert,
    true,
    false,
  ),
  /* Experimental effects */
  experimentalEntry(
    EffectType.ANGLE_BISECTOR,
    NC_('path effect', 'Angle bisector'),
    'angle_bisector',
    N_('Draw a line that halves the angle between the first three nodes of the path'),
  ),
  experimentalEntry(
    EffectType.CIRCLE_WITH_RADIUS,
    NC_('path effect', 'Circle'),
    'circle_with_radius',
    N_(
      'Draw a circle by center and radius, where the first node of the path is the center, and the last determines its radius',
    ),
  ),
  experimentalEntry(
    EffectType.CIRCLE_3PTS,
    NC_('path effect', 'Circle by 3 points'),
    'circle_3pts',
    N_('Draw a circle whose circumference passes through the first three nodes of the path'),
  ),
  experimentalEntry(
    EffectType.LINE_SEGMENT,
    NC_('path effect', 'Line Segment'),
    'line_segment',
    N_('Draw a straight line that connects the first and last node of a path'),
  ),
  experimentalEntry(
    EffectType.PARALLEL,
    NC_('path effect', 'Parallel'),
    'parallel',
    N_('Create a draggable line that will always be parallel to a two-node path'),
  ),
  experimentalEntry(
    EffectType.PERP_BISECTOR,
    NC_('path effect', 'Perpendicular bisector'),
    'perp_bisector',
    N_(
      'Draw a perpendicular line in the middle of the (imaginary) line that connects the start and end nodes',
    ),
  ),
  experimentalEntry(
    EffectType.TANGENT_TO_CURVE,
    NC_('path effect', 'Tangent to curve'),
    'tangent_to_curve',
    N_('Draw a tangent with variable length and additional angle that can be moved along the path'),
  ),
  experimentalEntry(
    EffectType.PATH_LENGTH,
    NC_('path effect', 'Path length'),
    'path_length',
    N_('Display the total length of a (curved) path'),
  ),
  experimentalEntry(
    EffectType.TEXT_LABEL,
    NC_('path effect', 'Text label'),
    'text_label',
    N_('Add a label for the object'),
  ),
  /* 1.1 */
  entry(
    EffectType.BOOL_OP,
    NC_('path effect', 'Boolean operation'),
    'bool_op',
    'bool-op',
    N_('Cut, union, subtract, intersect and divide a path non-destructively with another path'),
    LPECategory.Generate,
  ),
  /* 1.2 */
  entry(
    EffectType.TILING,
    NC_('path effect', 'Tiling'),
    'tiling',
    'tiling',
    N_(
      'Create multiple copies of an object following a grid layout. Customize size, rotation, distances, style and tiling symmetry.',
    ),
    LPECategory.Generate,
  ),
  {
    ...entry(
      EffectType.EXTRUDE,
      NC_('path effect', 'Extrude'),
      'extrude',
      'experimental',
      N_('Extrude the path, creating a face for each path segment'),
      LPECategory.Experimental,
    ),
    experimental: true,
  },
  {
    ...entry(
      EffectType.FILL_BETWEEN_STROKES,
      NC_('path effect', 'Fill between strokes'),
      'fill_between_strokes',
      'experimental',
      N_(
        'Turn the path into a fill between two other open paths (e.g. between two paths with PowerStroke applied to them)',
      ),
      LPECategory.Experimental,
    ),
    experimental: true,
  },
  // upstream: only with LPE_ENABLE_TEST_EFFECTS
  {
    ...entry(
      EffectType.DOEFFECTSTACK_TEST,
      NC_('path effect', 'doEffect stack test'),
      'doeffectstacktest',
      'experimental',
      N_('Test LPE'),
      LPECategory.Experimental,
    ),
    experimental: true,
  },
  {
    ...entry(
      EffectType.DYNASTROKE,
      NC_('path effect', 'Dynamic stroke'),
      'dynastroke',
      'experimental',
      N_(
        'Create calligraphic strokes with variably shaped ends, making use of a parameter for the brush angle',
      ),
      LPECategory.Experimental,
    ),
    experimental: true,
  },
  {
    ...entry(
      EffectType.LATTICE,
      NC_('path effect', 'Lattice Deformation Legacy'),
      'lattice',
      'experimental',
      N_('Deform an object using a 4x4 grid'),
      LPECategory.Experimental,
    ),
    experimental: true,
  },
  {
    ...entry(
      EffectType.RECURSIVE_SKELETON,
      NC_('path effect', 'Recursive skeleton'),
      'recursive_skeleton',
      'experimental',
      N_('Draw a path recursively'),
      LPECategory.Experimental,
    ),
    experimental: true,
  },
  {
    ...entry(
      EffectType.EMBRODERY_STITCH,
      NC_('path effect', 'Embroidery stitch'),
      'embrodery_stitch',
      'embrodery-stitch',
      N_('Embroidery stitch'),
      LPECategory.Experimental,
    ),
    experimental: false,
  },
];

export const LPETypeConverter = new EnumEffectDataConverter<EffectType>(LPETypeData);
