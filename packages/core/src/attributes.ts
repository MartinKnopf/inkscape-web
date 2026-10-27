// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/attributes.cpp, src/attributes.h
/*
 * Lookup dictionary for attributes/properties.
 *
 * Author:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *
 * Copyright (C) 2006 Johan Engelen <johan@shouraizou.nl>
 * Copyright (C) 2002 Lauris Kaplinski
 */

/*
 * Do not change order of attributes and properties. Attribute and
 * order in an SVG file is (optionally) determined by the order here.
 * This makes comparing different versions of a drawing easier using
 * line-by-line comparison. Also, in order for proper parsing, some
 * properties must be before others (e.g. 'font' before 'font-family').
 */
export enum SPAttr {
  INVALID, // Must have value 0.
  // SPObject
  ID,
  STYLE,
  INKSCAPE_COLLECT,
  INKSCAPE_LABEL,
  // SPRoot  Put these near top as the apply to the entire SVG
  VERSION,
  INKSCAPE_VERSION,
  WIDTH,
  HEIGHT,
  VIEWBOX,
  PRESERVEASPECTRATIO,
  ONLOAD,
  SODIPODI_DOCNAME,
  // SPItem
  TRANSFORM,
  SODIPODI_TYPE,
  SODIPODI_INSENSITIVE,
  CONNECTOR_AVOID,
  CONNECTION_POINTS,
  TRANSFORM_CENTER_X,
  TRANSFORM_CENTER_Y,
  INKSCAPE_PATH_EFFECT,
  INKSCAPE_HIGHLIGHT_COLOR,
  INKSCAPE_SPRAY_ORIGIN,
  // SPAnchor
  XLINK_HREF,
  XLINK_TYPE,
  XLINK_ROLE,
  XLINK_ARCROLE,
  XLINK_TITLE,
  XLINK_SHOW,
  XLINK_ACTUATE,
  TARGET,
  // SPGroup
  INKSCAPE_GROUPMODE,
  INKSCAPE_EXPANDED,
  // SPNamedView
  VIEWONLY,
  SHOWGUIDES,
  GRIDTOLERANCE,
  GUIDETOLERANCE,
  OBJECTTOLERANCE,
  ALIGNMENTTOLERANCE,
  DISTRIBUTIONTOLERANCE,
  GUIDECOLOR,
  GUIDEOPACITY,
  GUIDEHICOLOR,
  GUIDEHIOPACITY,
  SHOWBORDER,
  SHOWPAGESHADOW,
  BORDERLAYER,
  BORDERCOLOR,
  BORDEROPACITY,
  PAGECOLOR,
  PAGELABELSTYLE,
  INKSCAPE_PAGEOPACITY,
  INKSCAPE_PAGESHADOW,
  INKSCAPE_ZOOM,
  INKSCAPE_ROTATION,
  INKSCAPE_CX,
  INKSCAPE_CY,
  INKSCAPE_WINDOW_WIDTH,
  INKSCAPE_WINDOW_HEIGHT,
  INKSCAPE_WINDOW_X,
  INKSCAPE_WINDOW_Y,
  INKSCAPE_WINDOW_MAXIMIZED,
  // INKSCAPE_SNAP_GLOBAL,
  // INKSCAPE_SNAP_DISTRIBUTION,
  // INKSCAPE_SNAP_ALIGNMENT,
  // INKSCAPE_SNAP_ALIGNMENT_SELF,
  // INKSCAPE_SNAP_PERP,
  // INKSCAPE_SNAP_TANG,
  // INKSCAPE_SNAP_BBOX,
  // INKSCAPE_SNAP_NODE,
  // INKSCAPE_SNAP_OTHERS,
  // INKSCAPE_SNAP_FROM_GUIDE,
  // INKSCAPE_SNAP_ROTATION_CENTER,
  // INKSCAPE_SNAP_GRID,
  // INKSCAPE_SNAP_GUIDE,
  // INKSCAPE_SNAP_NODE_SMOOTH,
  // INKSCAPE_SNAP_LINE_MIDPOINT,
  // INKSCAPE_SNAP_OBJECT_MIDPOINT,
  // INKSCAPE_SNAP_TEXT_BASELINE,
  // INKSCAPE_SNAP_BBOX_EDGE_MIDPOINT,
  // INKSCAPE_SNAP_BBOX_MIDPOINT,
  // INKSCAPE_SNAP_PATH_INTERSECTION,
  // INKSCAPE_SNAP_PATH,
  // INKSCAPE_SNAP_PATH_CLIP,
  // INKSCAPE_SNAP_PATH_MASK,
  // INKSCAPE_SNAP_NODE_CUSP,
  // INKSCAPE_SNAP_BBOX_EDGE,
  // INKSCAPE_SNAP_BBOX_CORNER,
  // INKSCAPE_SNAP_PAGE_BORDER,
  INKSCAPE_CURRENT_LAYER,
  INKSCAPE_DOCUMENT_UNITS,
  INKSCAPE_LOCKGUIDES,
  UNITS,
  // ColorProfile
  LOCAL,
  NAME,
  RENDERING_INTENT,
  // SPGuide
  ORIENTATION,
  POSITION,
  INKSCAPE_COLOR,
  INKSCAPE_LOCKED,
  // SPPage
  PAGE_MARGIN,
  PAGE_BLEED,
  PAGE_SIZE_NAME,
  // SPGrid
  ORIGINX,
  ORIGINY,
  SPACINGX,
  SPACINGY,
  ANGLE_X,
  ANGLE_Z,
  ANGLE_Y_VERTICAL,
  GAP_X,
  GAP_Y,
  MARGIN_X,
  MARGIN_Y,
  VISIBLE,
  ENABLED,
  EMPOPACITY,
  EMPCOLOR,
  MAJOR_LINE_INTERVAL,
  DOTTED,
  SNAP_TO_VISIBLE_ONLY,
  // SPImage, SPRect, etc.
  X,
  Y,
  SVG_DPI,
  // SPPath
  // D,  Promoted to property in SVG 2
  INKSCAPE_ORIGINAL_D,
  CONNECTOR_TYPE,
  CONNECTOR_CURVATURE,
  INKSCAPE_CONNECTOR_SPACING,
  CONNECTION_START,
  CONNECTION_END,
  CONNECTION_START_POINT,
  CONNECTION_END_POINT,
  // SPRect
  RX,
  RY,
  // Box3D
  INKSCAPE_BOX3D_PERSPECTIVE_ID,
  INKSCAPE_BOX3D_CORNER0, // "upper left front" corner (as a point in 3-space)
  INKSCAPE_BOX3D_CORNER7, // "lower right rear" corner (as a point in 3-space)
  // Box3DSide
  INKSCAPE_BOX3D_SIDE_TYPE,
  // Persp3D
  INKSCAPE_PERSP3D,
  INKSCAPE_PERSP3D_VP_X,
  INKSCAPE_PERSP3D_VP_Y,
  INKSCAPE_PERSP3D_VP_Z,
  INKSCAPE_PERSP3D_ORIGIN,
  // SPEllipse
  R,
  CX,
  CY,
  SODIPODI_CX,
  SODIPODI_CY,
  SODIPODI_RX,
  SODIPODI_RY,
  SODIPODI_START,
  SODIPODI_END,
  SODIPODI_OPEN,
  SODIPODI_ARC_TYPE,
  // SPStar
  SODIPODI_SIDES,
  SODIPODI_R1,
  SODIPODI_R2,
  SODIPODI_ARG1,
  SODIPODI_ARG2,
  INKSCAPE_FLATSIDED,
  INKSCAPE_ROUNDED,
  INKSCAPE_RANDOMIZED,
  // SPSpiral
  SODIPODI_EXPANSION,
  SODIPODI_REVOLUTION,
  SODIPODI_RADIUS,
  SODIPODI_ARGUMENT,
  SODIPODI_T0,
  // SPOffset
  SODIPODI_ORIGINAL,
  INKSCAPE_ORIGINAL,
  INKSCAPE_HREF,
  INKSCAPE_RADIUS,
  // SPLine
  X1,
  Y1,
  X2,
  Y2,
  // SPPolyline
  POINTS,
  // SPTSpan
  DX,
  DY,
  ROTATE,
  TEXTLENGTH,
  LENGTHADJUST,
  SODIPODI_ROLE,
  // SPText
  SODIPODI_LINESPACING,
  // SPTextPath
  STARTOFFSET,
  SIDE,
  // SPStop
  OFFSET,
  // SPFilter
  FILTERUNITS,
  PRIMITIVEUNITS,
  FILTERRES,
  // Filter primitives common
  IN_,
  RESULT,
  // feBlend
  MODE,
  IN2,
  // feColorMatrix
  TYPE,
  VALUES,
  // feComponentTransfer
  //TYPE,
  TABLEVALUES,
  SLOPE,
  INTERCEPT,
  AMPLITUDE,
  EXPONENT,
  //OFFSET,
  // feComposite
  OPERATOR,
  K1,
  K2,
  K3,
  K4,
  //IN2,
  // feConvolveMatrix
  ORDER,
  KERNELMATRIX,
  DIVISOR,
  BIAS,
  TARGETX,
  TARGETY,
  EDGEMODE,
  KERNELUNITLENGTH,
  PRESERVEALPHA,
  // feDiffuseLighting
  SURFACESCALE,
  DIFFUSECONSTANT,
  //KERNELUNITLENGTH,
  // feDisplacementMap
  SCALE,
  XCHANNELSELECTOR,
  YCHANNELSELECTOR,
  //IN2,
  // feDistantLight
  AZIMUTH,
  ELEVATION,
  // fePointLight
  Z,
  // feSpotLight
  POINTSATX,
  POINTSATY,
  POINTSATZ,
  LIMITINGCONEANGLE,
  // SPGaussianBlur
  STDDEVIATION,
  // feImage
  // feMerge
  // feMorphology
  //OPERATOR,
  RADIUS,
  // feOffset
  //DX,
  //DY,
  // feSpecularLighting
  //SURFACESCALE,
  SPECULARCONSTANT,
  SPECULAREXPONENT,
  // feTile
  // feTurbulence
  BASEFREQUENCY,
  NUMOCTAVES,
  SEED,
  STITCHTILES,
  //TYPE,
  // SPGradient
  GRADIENTUNITS,
  GRADIENTTRANSFORM,
  SPREADMETHOD,
  INKSCAPE_SWATCH,
  INKSCAPE_PINNED,
  // SPRadialGradient
  FX,
  FY,
  FR,
  // SPMeshPatch
  TENSOR,
  //TYPE,
  // SPPattern
  PATTERNUNITS,
  PATTERNCONTENTUNITS,
  PATTERNTRANSFORM,
  // SPHatch
  HATCHUNITS,
  HATCHCONTENTUNITS,
  // HATCHTRANSFORM,
  PITCH,
  // SPClipPath
  CLIPPATHUNITS,
  // SPMask
  MASKUNITS,
  MASKCONTENTUNITS,
  // SPMarker
  MARKERUNITS,
  REFX,
  REFY,
  MARKERWIDTH,
  MARKERHEIGHT,
  ORIENT,
  // SPStyleElem
  //TYPE,
  // Animations
  ATTRIBUTENAME,
  ATTRIBUTETYPE,
  BEGIN,
  DUR,
  END,
  MIN,
  MAX,
  RESTART,
  REPEATCOUNT,
  REPEATDUR,

  // Interpolating animations
  CALCMODE,
  //VALUES,
  KEYTIMES,
  KEYSPLINES,
  FROM,
  TO,
  BY,
  ADDITIVE,
  ACCUMULATE,

  // SVGFonts
  // SPFont
  HORIZ_ORIGIN_X,
  HORIZ_ORIGIN_Y,
  HORIZ_ADV_X,
  VERT_ORIGIN_X,
  VERT_ORIGIN_Y,
  VERT_ADV_Y,

  UNICODE,
  GLYPH_NAME,
  //ORIENTATION,
  ARABIC_FORM,
  LANG,

  // <hkern> and <vkern>
  U1,
  G1,
  U2,
  G2,
  K,

  // <font-face>
  //    FONT_FAMILY,
  //    FONT_STYLE,
  //    FONT_VARIANT,
  //    FONT_WEIGHT,
  //    FONT_STRETCH,
  //    FONT_SIZE,
  UNICODE_RANGE,
  UNITS_PER_EM,
  PANOSE_1,
  STEMV,
  STEMH,
  //SLOPE,
  CAP_HEIGHT,
  X_HEIGHT,
  ACCENT_HEIGHT,
  ASCENT,
  DESCENT,
  WIDTHS,
  BBOX,
  IDEOGRAPHIC,
  ALPHABETIC,
  MATHEMATICAL,
  HANGING,
  V_IDEOGRAPHIC,
  V_ALPHABETIC,
  V_MATHEMATICAL,
  V_HANGING,
  UNDERLINE_POSITION,
  UNDERLINE_THICKNESS,
  STRIKETHROUGH_POSITION,
  STRIKETHROUGH_THICKNESS,
  OVERLINE_POSITION,
  OVERLINE_THICKNESS,

  // XML
  XML_SPACE,
  XML_LANG,

  // typeset
  TEXT_NOMARKUP,
  TEXT_PANGOMARKUP,
  TEXT_INSHAPE,
  TEXT_ONPATH,
  TEXT_INBOX,
  TEXT_INCOLUMN,
  TEXT_EXCLUDE,
  LAYOUT_OPTIONS,

  // CSS & SVG Properties   KEEP ORDER!
  // If first or last property changed, attributeIsCss must be changed!

  // SVG 2 Attributes promoted to properties
  D,

  // Paint
  COLOR,
  OPACITY,
  FILL,
  FILL_OPACITY,
  FILL_RULE,
  STROKE,
  STROKE_OPACITY,
  STROKE_WIDTH,
  STROKE_LINECAP,
  STROKE_LINEJOIN,
  STROKE_MITERLIMIT,
  STROKE_DASHARRAY,
  STROKE_DASHOFFSET,
  STROKE_EXTENSIONS,
  MARKER,
  MARKER_END,
  MARKER_MID,
  MARKER_START,
  PAINT_ORDER, // SVG2
  SOLID_COLOR,
  SOLID_OPACITY,
  VECTOR_EFFECT,

  // CSS Blending/Compositing
  MIX_BLEND_MODE,
  ISOLATION,

  // Misc. Display
  DISPLAY,
  OVERFLOW_,
  VISIBILITY,

  // Clip/Mask
  CLIP,
  CLIP_PATH,
  CLIP_RULE,
  MASK,

  // Font: Order is important!
  FONT,
  FONT_FAMILY,
  INKSCAPE_FONT_SPEC, // Remove me
  FONT_SIZE,
  FONT_SIZE_ADJUST,
  FONT_STRETCH,
  FONT_STYLE,
  FONT_VARIANT,
  FONT_WEIGHT,

  // Font Variants CSS 3
  FONT_VARIANT_LIGATURES,
  FONT_VARIANT_POSITION,
  FONT_VARIANT_CAPS,
  FONT_VARIANT_NUMERIC,
  FONT_VARIANT_ALTERNATES,
  FONT_VARIANT_EAST_ASIAN,
  FONT_FEATURE_SETTINGS,

  // Variable Fonts (CSS Fonts Module Level 4)
  FONT_VARIATION_SETTINGS,

  // Text Layout
  TEXT_INDENT,
  TEXT_ALIGN,
  LINE_HEIGHT,
  LETTER_SPACING,
  WORD_SPACING,
  TEXT_TRANSFORM,

  // Text (CSS3)
  DIRECTION,
  WRITING_MODE,
  TEXT_ORIENTATION,
  UNICODE_BIDI,
  ALIGNMENT_BASELINE,
  BASELINE_SHIFT,
  DOMINANT_BASELINE,
  GLYPH_ORIENTATION_HORIZONTAL,
  GLYPH_ORIENTATION_VERTICAL,
  KERNING,
  TEXT_ANCHOR,
  WHITE_SPACE,

  // SVG 2 Text Wrapping
  SHAPE_INSIDE,
  SHAPE_SUBTRACT,
  SHAPE_PADDING,
  SHAPE_MARGIN,
  INLINE_SIZE,

  // Text Decoration
  TEXT_DECORATION, // CSS 2/CSS3-Shorthand
  TEXT_DECORATION_LINE,
  TEXT_DECORATION_STYLE,
  TEXT_DECORATION_COLOR,
  TEXT_DECORATION_FILL,
  TEXT_DECORATION_STROKE,

  // Filter
  ENABLE_BACKGROUND,
  FILTER,
  FLOOD_COLOR,
  FLOOD_OPACITY,
  LIGHTING_COLOR,
  AUTO_REGION,

  // Gradient
  STOP_COLOR,
  STOP_OPACITY,
  STOP_PATH,

  // Rendering
  COLOR_INTERPOLATION,
  COLOR_INTERPOLATION_FILTERS,
  COLOR_PROFILE,
  COLOR_RENDERING,
  IMAGE_RENDERING,
  SHAPE_RENDERING,
  TEXT_RENDERING,

  // Interactivity
  POINTER_EVENTS,
  CURSOR,

  // Conditional
  SYSTEM_LANGUAGE,
  REQUIRED_FEATURES,
  REQUIRED_EXTENSIONS,

  // LivePathEffect
  PATH_EFFECT,

  // canvas blackout color
  INKSCAPE_DESK_COLOR,
  INKSCAPE_DESK_OPACITY,
  INKSCAPE_DESK_CHECKERBOARD,
  // Inkscape-specific mode: clip content rendering to pages' boundaries
  INKSCAPE_CLIP_TO_PAGE_RENDERING,
  INKSCAPE_ANTIALIAS_RENDERING,
  INKSCAPE_ORIGIN_CORRECTION,
  INKSCAPE_Y_AXIS_DOWN,

  // sentinel
  SPAttr_SIZE,
}

/** Lookup dictionary for attributes/properties, in the order of {@link SPAttr}. */
const props: readonly (readonly [SPAttr, string | null])[] = [
  [SPAttr.INVALID, null],
  // SPObject
  [SPAttr.ID, 'id'],
  [SPAttr.STYLE, 'style'],
  [SPAttr.INKSCAPE_COLLECT, 'inkscape:collect'],
  [SPAttr.INKSCAPE_LABEL, 'inkscape:label'],
  // SPRoot
  [SPAttr.VERSION, 'version'],
  [SPAttr.INKSCAPE_VERSION, 'inkscape:version'],
  [SPAttr.WIDTH, 'width'],
  [SPAttr.HEIGHT, 'height'],
  [SPAttr.VIEWBOX, 'viewBox'],
  [SPAttr.PRESERVEASPECTRATIO, 'preserveAspectRatio'],
  [SPAttr.ONLOAD, 'onload'],
  [SPAttr.SODIPODI_DOCNAME, 'sodipodi:docname'],
  // SPItem
  [SPAttr.TRANSFORM, 'transform'],
  [SPAttr.SODIPODI_TYPE, 'sodipodi:type'],
  [SPAttr.SODIPODI_INSENSITIVE, 'sodipodi:insensitive'],
  [SPAttr.CONNECTOR_AVOID, 'inkscape:connector-avoid'],
  [SPAttr.CONNECTION_POINTS, 'inkscape:connection-points'],
  [SPAttr.TRANSFORM_CENTER_X, 'inkscape:transform-center-x'],
  [SPAttr.TRANSFORM_CENTER_Y, 'inkscape:transform-center-y'],
  [SPAttr.INKSCAPE_PATH_EFFECT, 'inkscape:path-effect'],
  [SPAttr.INKSCAPE_HIGHLIGHT_COLOR, 'inkscape:highlight-color'],
  [SPAttr.INKSCAPE_SPRAY_ORIGIN, 'inkscape:spray-origin'],
  // SPAnchor
  [SPAttr.XLINK_HREF, 'xlink:href'],
  [SPAttr.XLINK_TYPE, 'xlink:type'],
  [SPAttr.XLINK_ROLE, 'xlink:role'],
  [SPAttr.XLINK_ARCROLE, 'xlink:arcrole'],
  [SPAttr.XLINK_TITLE, 'xlink:title'],
  [SPAttr.XLINK_SHOW, 'xlink:show'],
  [SPAttr.XLINK_ACTUATE, 'xlink:actuate'],
  [SPAttr.TARGET, 'target'],
  [SPAttr.INKSCAPE_GROUPMODE, 'inkscape:groupmode'],
  [SPAttr.INKSCAPE_EXPANDED, 'inkscape:expanded'],
  // SPNamedView
  [SPAttr.VIEWONLY, 'viewonly'],
  [SPAttr.SHOWGUIDES, 'showguides'],
  [SPAttr.GRIDTOLERANCE, 'gridtolerance'],
  [SPAttr.GUIDETOLERANCE, 'guidetolerance'],
  [SPAttr.OBJECTTOLERANCE, 'objecttolerance'],
  [SPAttr.ALIGNMENTTOLERANCE, 'alignmenttolerance'],
  [SPAttr.DISTRIBUTIONTOLERANCE, 'distributiontolerance'],
  [SPAttr.GUIDECOLOR, 'guidecolor'],
  [SPAttr.GUIDEOPACITY, 'guideopacity'],
  [SPAttr.GUIDEHICOLOR, 'guidehicolor'],
  [SPAttr.GUIDEHIOPACITY, 'guidehiopacity'],
  [SPAttr.SHOWBORDER, 'showborder'],
  [SPAttr.SHOWPAGESHADOW, 'inkscape:showpageshadow'],
  [SPAttr.BORDERLAYER, 'borderlayer'],
  [SPAttr.BORDERCOLOR, 'bordercolor'],
  [SPAttr.BORDEROPACITY, 'borderopacity'],
  [SPAttr.PAGECOLOR, 'pagecolor'],
  [SPAttr.PAGELABELSTYLE, 'labelstyle'],
  [SPAttr.INKSCAPE_PAGEOPACITY, 'inkscape:pageopacity'],
  [SPAttr.INKSCAPE_PAGESHADOW, 'inkscape:pageshadow'],
  [SPAttr.INKSCAPE_ZOOM, 'inkscape:zoom'],
  [SPAttr.INKSCAPE_ROTATION, 'inkscape:rotation'],
  [SPAttr.INKSCAPE_CX, 'inkscape:cx'],
  [SPAttr.INKSCAPE_CY, 'inkscape:cy'],
  [SPAttr.INKSCAPE_WINDOW_WIDTH, 'inkscape:window-width'],
  [SPAttr.INKSCAPE_WINDOW_HEIGHT, 'inkscape:window-height'],
  [SPAttr.INKSCAPE_WINDOW_X, 'inkscape:window-x'],
  [SPAttr.INKSCAPE_WINDOW_Y, 'inkscape:window-y'],
  [SPAttr.INKSCAPE_WINDOW_MAXIMIZED, 'inkscape:window-maximized'],
  // {SPAttr::INKSCAPE_SNAP_GLOBAL, "inkscape:snap-global"},
  // {SPAttr::INKSCAPE_SNAP_DISTRIBUTION, "inkscape:snap-distribution"},
  // {SPAttr::INKSCAPE_SNAP_ALIGNMENT, "inkscape:snap-alignment"},
  // {SPAttr::INKSCAPE_SNAP_ALIGNMENT_SELF, "inkscape:snap-alignment-self"},
  // {SPAttr::INKSCAPE_SNAP_PERP, "inkscape:snap-perpendicular"},
  // {SPAttr::INKSCAPE_SNAP_TANG, "inkscape:snap-tangential"},
  // {SPAttr::INKSCAPE_SNAP_BBOX, "inkscape:snap-bbox"},
  // {SPAttr::INKSCAPE_SNAP_NODE, "inkscape:snap-nodes"},
  // {SPAttr::INKSCAPE_SNAP_OTHERS, "inkscape:snap-others"},
  // {SPAttr::INKSCAPE_SNAP_FROM_GUIDE, "inkscape:snap-from-guide"},
  // {SPAttr::INKSCAPE_SNAP_ROTATION_CENTER, "inkscape:snap-center"},
  // {SPAttr::INKSCAPE_SNAP_GRID, "inkscape:snap-grids"},
  // {SPAttr::INKSCAPE_SNAP_GUIDE, "inkscape:snap-to-guides"},
  // {SPAttr::INKSCAPE_SNAP_NODE_SMOOTH, "inkscape:snap-smooth-nodes"},
  // {SPAttr::INKSCAPE_SNAP_LINE_MIDPOINT, "inkscape:snap-midpoints"},
  // {SPAttr::INKSCAPE_SNAP_OBJECT_MIDPOINT, "inkscape:snap-object-midpoints"},
  // {SPAttr::INKSCAPE_SNAP_TEXT_BASELINE, "inkscape:snap-text-baseline"},
  // {SPAttr::INKSCAPE_SNAP_BBOX_EDGE_MIDPOINT, "inkscape:snap-bbox-edge-midpoints"},
  // {SPAttr::INKSCAPE_SNAP_BBOX_MIDPOINT, "inkscape:snap-bbox-midpoints"},
  // {SPAttr::INKSCAPE_SNAP_PATH_INTERSECTION, "inkscape:snap-intersection-paths"},
  // {SPAttr::INKSCAPE_SNAP_PATH, "inkscape:object-paths"},
  // {SPAttr::INKSCAPE_SNAP_PATH_CLIP, "inkscape:snap-path-clip"},
  // {SPAttr::INKSCAPE_SNAP_PATH_MASK, "inkscape:snap-path-mask"},
  // {SPAttr::INKSCAPE_SNAP_NODE_CUSP, "inkscape:object-nodes"},
  // {SPAttr::INKSCAPE_SNAP_BBOX_EDGE, "inkscape:bbox-paths"},
  // {SPAttr::INKSCAPE_SNAP_BBOX_CORNER, "inkscape:bbox-nodes"},
  // {SPAttr::INKSCAPE_SNAP_PAGE_BORDER, "inkscape:snap-page"},
  [SPAttr.INKSCAPE_CURRENT_LAYER, 'inkscape:current-layer'],
  [SPAttr.INKSCAPE_DOCUMENT_UNITS, 'inkscape:document-units'], // This setting sets the Display units, *not* the units used in SVG
  [SPAttr.INKSCAPE_LOCKGUIDES, 'inkscape:lockguides'],
  [SPAttr.UNITS, 'units'],
  // ColorProfile
  [SPAttr.LOCAL, 'local'],
  [SPAttr.NAME, 'name'],
  [SPAttr.RENDERING_INTENT, 'rendering-intent'],
  // SPGuide
  [SPAttr.ORIENTATION, 'orientation'],
  [SPAttr.POSITION, 'position'],
  [SPAttr.INKSCAPE_COLOR, 'inkscape:color'],
  [SPAttr.INKSCAPE_LOCKED, 'inkscape:locked'],
  // SPPage
  [SPAttr.PAGE_MARGIN, 'inkscape:margin'],
  [SPAttr.PAGE_BLEED, 'inkscape:bleed'],
  [SPAttr.PAGE_SIZE_NAME, 'inkscape:page-size'],
  // SPGrid
  [SPAttr.ORIGINX, 'originx'],
  [SPAttr.ORIGINY, 'originy'],
  [SPAttr.SPACINGX, 'spacingx'],
  [SPAttr.SPACINGY, 'spacingy'],
  [SPAttr.ANGLE_X, 'gridanglex'],
  [SPAttr.ANGLE_Z, 'gridanglez'],
  [SPAttr.ANGLE_Y_VERTICAL, 'angleyvertical'],
  [SPAttr.GAP_X, 'gapx'],
  [SPAttr.GAP_Y, 'gapy'],
  [SPAttr.MARGIN_X, 'marginx'],
  [SPAttr.MARGIN_Y, 'marginy'],
  [SPAttr.VISIBLE, 'visible'],
  [SPAttr.ENABLED, 'enabled'],
  [SPAttr.EMPOPACITY, 'empopacity'],
  [SPAttr.EMPCOLOR, 'empcolor'],
  [SPAttr.MAJOR_LINE_INTERVAL, 'empspacing'],
  [SPAttr.DOTTED, 'dotted'],
  [SPAttr.SNAP_TO_VISIBLE_ONLY, 'snapvisiblegridlinesonly'],
  // SPImage
  [SPAttr.X, 'x'],
  [SPAttr.Y, 'y'],
  [SPAttr.SVG_DPI, 'inkscape:svg-dpi'],
  // SPPath
  [SPAttr.INKSCAPE_ORIGINAL_D, 'inkscape:original-d'],
  // (Note: XML representation of connectors may change in future.)
  [SPAttr.CONNECTOR_TYPE, 'inkscape:connector-type'],
  [SPAttr.CONNECTOR_CURVATURE, 'inkscape:connector-curvature'],
  [SPAttr.INKSCAPE_CONNECTOR_SPACING, 'inkscape:connector-spacing'],
  [SPAttr.CONNECTION_START, 'inkscape:connection-start'],
  [SPAttr.CONNECTION_END, 'inkscape:connection-end'],
  [SPAttr.CONNECTION_START_POINT, 'inkscape:connection-start-point'],
  [SPAttr.CONNECTION_END_POINT, 'inkscape:connection-end-point'],
  // SPRect
  [SPAttr.RX, 'rx'],
  [SPAttr.RY, 'ry'],
  // Box3D
  [SPAttr.INKSCAPE_BOX3D_PERSPECTIVE_ID, 'inkscape:perspectiveID'],
  [SPAttr.INKSCAPE_BOX3D_CORNER0, 'inkscape:corner0'],
  [SPAttr.INKSCAPE_BOX3D_CORNER7, 'inkscape:corner7'],
  // Box3DSide
  [SPAttr.INKSCAPE_BOX3D_SIDE_TYPE, 'inkscape:box3dsidetype'], // XYfront, etc.
  // Persp3D
  [SPAttr.INKSCAPE_PERSP3D, 'inkscape:persp3d'],
  [SPAttr.INKSCAPE_PERSP3D_VP_X, 'inkscape:vp_x'],
  [SPAttr.INKSCAPE_PERSP3D_VP_Y, 'inkscape:vp_y'],
  [SPAttr.INKSCAPE_PERSP3D_VP_Z, 'inkscape:vp_z'],
  [SPAttr.INKSCAPE_PERSP3D_ORIGIN, 'inkscape:persp3d-origin'],
  // SPEllipse
  [SPAttr.R, 'r'],
  [SPAttr.CX, 'cx'],
  [SPAttr.CY, 'cy'],
  [SPAttr.SODIPODI_CX, 'sodipodi:cx'],
  [SPAttr.SODIPODI_CY, 'sodipodi:cy'],
  [SPAttr.SODIPODI_RX, 'sodipodi:rx'],
  [SPAttr.SODIPODI_RY, 'sodipodi:ry'],
  [SPAttr.SODIPODI_START, 'sodipodi:start'],
  [SPAttr.SODIPODI_END, 'sodipodi:end'],
  [SPAttr.SODIPODI_OPEN, 'sodipodi:open'], // Deprecated
  [SPAttr.SODIPODI_ARC_TYPE, 'sodipodi:arc-type'],
  // SPStar
  [SPAttr.SODIPODI_SIDES, 'sodipodi:sides'],
  [SPAttr.SODIPODI_R1, 'sodipodi:r1'],
  [SPAttr.SODIPODI_R2, 'sodipodi:r2'],
  [SPAttr.SODIPODI_ARG1, 'sodipodi:arg1'],
  [SPAttr.SODIPODI_ARG2, 'sodipodi:arg2'],
  [SPAttr.INKSCAPE_FLATSIDED, 'inkscape:flatsided'],
  [SPAttr.INKSCAPE_ROUNDED, 'inkscape:rounded'],
  [SPAttr.INKSCAPE_RANDOMIZED, 'inkscape:randomized'],
  // SPSpiral
  [SPAttr.SODIPODI_EXPANSION, 'sodipodi:expansion'],
  [SPAttr.SODIPODI_REVOLUTION, 'sodipodi:revolution'],
  [SPAttr.SODIPODI_RADIUS, 'sodipodi:radius'],
  [SPAttr.SODIPODI_ARGUMENT, 'sodipodi:argument'],
  [SPAttr.SODIPODI_T0, 'sodipodi:t0'],
  // SPOffset
  [SPAttr.SODIPODI_ORIGINAL, 'sodipodi:original'],
  [SPAttr.INKSCAPE_ORIGINAL, 'inkscape:original'],
  [SPAttr.INKSCAPE_HREF, 'inkscape:href'],
  [SPAttr.INKSCAPE_RADIUS, 'inkscape:radius'],
  // SPLine
  [SPAttr.X1, 'x1'],
  [SPAttr.Y1, 'y1'],
  [SPAttr.X2, 'x2'],
  [SPAttr.Y2, 'y2'],
  // SPPolyline
  [SPAttr.POINTS, 'points'],
  // SPTSpan
  [SPAttr.DX, 'dx'],
  [SPAttr.DY, 'dy'],
  [SPAttr.ROTATE, 'rotate'],
  [SPAttr.TEXTLENGTH, 'textLength'],
  [SPAttr.LENGTHADJUST, 'lengthAdjust'],
  [SPAttr.SODIPODI_ROLE, 'sodipodi:role'],
  // SPText
  [SPAttr.SODIPODI_LINESPACING, 'sodipodi:linespacing'],
  // SPTextPath
  [SPAttr.STARTOFFSET, 'startOffset'],
  [SPAttr.SIDE, 'side'],
  // SPStop
  [SPAttr.OFFSET, 'offset'],
  // SPFilter
  [SPAttr.FILTERUNITS, 'filterUnits'],
  [SPAttr.PRIMITIVEUNITS, 'primitiveUnits'],
  [SPAttr.FILTERRES, 'filterRes'],
  // Filter primitives common
  [SPAttr.IN_, 'in'],
  [SPAttr.RESULT, 'result'],
  // feBlend
  [SPAttr.MODE, 'mode'],
  [SPAttr.IN2, 'in2'],
  // feColorMatrix
  [SPAttr.TYPE, 'type'],
  [SPAttr.VALUES, 'values'],
  // feComponentTransfer
  //{SPAttr::TYPE, "type"},
  [SPAttr.TABLEVALUES, 'tableValues'],
  [SPAttr.SLOPE, 'slope'],
  [SPAttr.INTERCEPT, 'intercept'],
  [SPAttr.AMPLITUDE, 'amplitude'],
  [SPAttr.EXPONENT, 'exponent'],
  //{SPAttr::OFFSET, "offset"},
  // feComposite
  [SPAttr.OPERATOR, 'operator'],
  [SPAttr.K1, 'k1'],
  [SPAttr.K2, 'k2'],
  [SPAttr.K3, 'k3'],
  [SPAttr.K4, 'k4'],
  //{SPAttr::IN2, "in2"},
  // feConvolveMatrix
  [SPAttr.ORDER, 'order'],
  [SPAttr.KERNELMATRIX, 'kernelMatrix'],
  [SPAttr.DIVISOR, 'divisor'],
  [SPAttr.BIAS, 'bias'],
  [SPAttr.TARGETX, 'targetX'],
  [SPAttr.TARGETY, 'targetY'],
  [SPAttr.EDGEMODE, 'edgeMode'],
  [SPAttr.KERNELUNITLENGTH, 'kernelUnitLength'],
  [SPAttr.PRESERVEALPHA, 'preserveAlpha'],
  // feDiffuseLighting
  [SPAttr.SURFACESCALE, 'surfaceScale'],
  [SPAttr.DIFFUSECONSTANT, 'diffuseConstant'],
  //{SPAttr::KERNELUNITLENGTH, "kernelUnitLength"},
  // feDisplacementMap
  [SPAttr.SCALE, 'scale'],
  [SPAttr.XCHANNELSELECTOR, 'xChannelSelector'],
  [SPAttr.YCHANNELSELECTOR, 'yChannelSelector'],
  //{SPAttr::IN2, "in2"},
  // feDistantLight
  [SPAttr.AZIMUTH, 'azimuth'],
  [SPAttr.ELEVATION, 'elevation'],
  // fePointLight
  [SPAttr.Z, 'z'],
  // feSpotLight
  [SPAttr.POINTSATX, 'pointsAtX'],
  [SPAttr.POINTSATY, 'pointsAtY'],
  [SPAttr.POINTSATZ, 'pointsAtZ'],
  [SPAttr.LIMITINGCONEANGLE, 'limitingConeAngle'],
  // SPGaussianBlur
  [SPAttr.STDDEVIATION, 'stdDeviation'],
  // feImage
  // feMerge
  // feMorphology
  //{SPAttr::OPERATOR, "operator"},
  [SPAttr.RADIUS, 'radius'],
  // feOffset
  //{SPAttr::DX, "dx"},
  //{SPAttr::DY, "dy"},
  // feSpecularLighting
  [SPAttr.SPECULARCONSTANT, 'specularConstant'],
  [SPAttr.SPECULAREXPONENT, 'specularExponent'],
  // feTile
  // feTurbulence
  [SPAttr.BASEFREQUENCY, 'baseFrequency'],
  [SPAttr.NUMOCTAVES, 'numOctaves'],
  [SPAttr.SEED, 'seed'],
  [SPAttr.STITCHTILES, 'stitchTiles'],
  //{SPAttr::TYPE, "type"},
  // SPGradient
  [SPAttr.GRADIENTUNITS, 'gradientUnits'],
  [SPAttr.GRADIENTTRANSFORM, 'gradientTransform'],
  [SPAttr.SPREADMETHOD, 'spreadMethod'],
  [SPAttr.INKSCAPE_SWATCH, 'inkscape:swatch'],
  [SPAttr.INKSCAPE_PINNED, 'inkscape:pinned'],
  // SPRadialGradient
  [SPAttr.FX, 'fx'],
  [SPAttr.FY, 'fy'],
  [SPAttr.FR, 'fr'],
  // SPMeshPatch
  [SPAttr.TENSOR, 'tensor'],
  //{SPAttr::TYPE, "type"},
  // SPPattern
  [SPAttr.PATTERNUNITS, 'patternUnits'],
  [SPAttr.PATTERNCONTENTUNITS, 'patternContentUnits'],
  [SPAttr.PATTERNTRANSFORM, 'patternTransform'],
  // SPHatch
  [SPAttr.HATCHUNITS, 'hatchUnits'],
  [SPAttr.HATCHCONTENTUNITS, 'hatchContentUnits'],
  // {SPAttr::HATCHTRANSFORM, "transform"},
  [SPAttr.PITCH, 'pitch'],
  // SPClipPath
  [SPAttr.CLIPPATHUNITS, 'clipPathUnits'],
  // SPMask
  [SPAttr.MASKUNITS, 'maskUnits'],
  [SPAttr.MASKCONTENTUNITS, 'maskContentUnits'],
  // SPMarker
  [SPAttr.MARKERUNITS, 'markerUnits'],
  [SPAttr.REFX, 'refX'],
  [SPAttr.REFY, 'refY'],
  [SPAttr.MARKERWIDTH, 'markerWidth'],
  [SPAttr.MARKERHEIGHT, 'markerHeight'],
  [SPAttr.ORIENT, 'orient'],
  // SPStyleElem
  //{SPAttr::TYPE, "type"},
  // Animations
  [SPAttr.ATTRIBUTENAME, 'attributeName'],
  [SPAttr.ATTRIBUTETYPE, 'attributeType'],
  [SPAttr.BEGIN, 'begin'],
  [SPAttr.DUR, 'dur'],
  [SPAttr.END, 'end'],
  [SPAttr.MIN, 'min'],
  [SPAttr.MAX, 'max'],
  [SPAttr.RESTART, 'restart'],
  [SPAttr.REPEATCOUNT, 'repeatCount'],
  [SPAttr.REPEATDUR, 'repeatDur'],
  // Interpolating animations
  [SPAttr.CALCMODE, 'calcMode'],
  //{SPAttr::VALUES, "values"},
  [SPAttr.KEYTIMES, 'keyTimes'],
  [SPAttr.KEYSPLINES, 'keySplines'],
  [SPAttr.FROM, 'from'],
  [SPAttr.TO, 'to'],
  [SPAttr.BY, 'by'],
  [SPAttr.ADDITIVE, 'additive'],
  [SPAttr.ACCUMULATE, 'accumulate'],

  // SVGFonts
  // <font>
  [SPAttr.HORIZ_ORIGIN_X, 'horiz-origin-x'],
  [SPAttr.HORIZ_ORIGIN_Y, 'horiz-origin-y'],
  [SPAttr.HORIZ_ADV_X, 'horiz-adv-x'],
  [SPAttr.VERT_ORIGIN_X, 'vert-origin-x'],
  [SPAttr.VERT_ORIGIN_Y, 'vert-origin-y'],
  [SPAttr.VERT_ADV_Y, 'vert-adv-y'],

  // <glyph>
  [SPAttr.UNICODE, 'unicode'],
  [SPAttr.GLYPH_NAME, 'glyph-name'],
  //{SPAttr::ORIENTATION, "orientation"},
  [SPAttr.ARABIC_FORM, 'arabic-form'],
  [SPAttr.LANG, 'lang'],

  // <hkern> and <vkern>
  [SPAttr.U1, 'u1'],
  [SPAttr.G1, 'g1'],
  [SPAttr.U2, 'u2'],
  [SPAttr.G2, 'g2'],
  [SPAttr.K, 'k'],

  // <font-face>
  //{SPAttr::FONT_FAMILY, "font-family"}, these are already set for CSS2 (SPAttr::FONT_FAMILY, SPAttr::FONT_STYLE, SPAttr::FONT_VARIANT etc...)
  //{SPAttr::FONT_STYLE, "font-style"},
  //{SPAttr::FONT_VARIANT, "font-variant"},
  //{SPAttr::FONT_WEIGHT, "font-weight"},
  //{SPAttr::FONT_STRETCH, "font-stretch"},
  //{SPAttr::FONT_SIZE, "font-size"},
  [SPAttr.UNICODE_RANGE, 'unicode-range'],
  [SPAttr.UNITS_PER_EM, 'units-per-em'],
  [SPAttr.PANOSE_1, 'panose-1'],
  [SPAttr.STEMV, 'stemv'],
  [SPAttr.STEMH, 'stemh'],
  //{SPAttr::SLOPE, "slope"},
  [SPAttr.CAP_HEIGHT, 'cap-height'],
  [SPAttr.X_HEIGHT, 'x-height'],
  [SPAttr.ACCENT_HEIGHT, 'accent-height'],
  [SPAttr.ASCENT, 'ascent'],
  [SPAttr.DESCENT, 'descent'],
  [SPAttr.WIDTHS, 'widths'],
  [SPAttr.BBOX, 'bbox'],
  [SPAttr.IDEOGRAPHIC, 'ideographic'],
  [SPAttr.ALPHABETIC, 'alphabetic'],
  [SPAttr.MATHEMATICAL, 'mathematical'],
  [SPAttr.HANGING, 'hanging'],
  [SPAttr.V_IDEOGRAPHIC, 'v-ideographic'],
  [SPAttr.V_ALPHABETIC, 'v-alphabetic'],
  [SPAttr.V_MATHEMATICAL, 'v-mathematical'],
  [SPAttr.V_HANGING, 'v-hanging'],
  [SPAttr.UNDERLINE_POSITION, 'underline-position'],
  [SPAttr.UNDERLINE_THICKNESS, 'underline-thickness'],
  [SPAttr.STRIKETHROUGH_POSITION, 'strikethrough-position'],
  [SPAttr.STRIKETHROUGH_THICKNESS, 'strikethrough-thickness'],
  [SPAttr.OVERLINE_POSITION, 'overline-position'],
  [SPAttr.OVERLINE_THICKNESS, 'overline-thickness'],

  // XML
  [SPAttr.XML_SPACE, 'xml:space'],
  [SPAttr.XML_LANG, 'xml:lang'],

  // typeset
  [SPAttr.TEXT_NOMARKUP, 'inkscape:srcNoMarkup'],
  [SPAttr.TEXT_PANGOMARKUP, 'inkscape:srcPango'],
  [SPAttr.TEXT_INSHAPE, 'inkscape:dstShape'],
  [SPAttr.TEXT_ONPATH, 'inkscape:dstPath'],
  [SPAttr.TEXT_INBOX, 'inkscape:dstBox'],
  [SPAttr.TEXT_INCOLUMN, 'inkscape:dstColumn'],
  [SPAttr.TEXT_EXCLUDE, 'inkscape:excludeShape'],
  [SPAttr.LAYOUT_OPTIONS, 'inkscape:layoutOptions'],

  // CSS & SVG Properties

  // SVG 2 Attributes promoted to properties
  [SPAttr.D, 'd'],

  // Paint
  [SPAttr.COLOR, 'color'],
  [SPAttr.OPACITY, 'opacity'],
  [SPAttr.FILL, 'fill'],
  [SPAttr.FILL_OPACITY, 'fill-opacity'],
  [SPAttr.FILL_RULE, 'fill-rule'],
  [SPAttr.STROKE, 'stroke'],
  [SPAttr.STROKE_OPACITY, 'stroke-opacity'],
  [SPAttr.STROKE_WIDTH, 'stroke-width'],
  [SPAttr.STROKE_LINECAP, 'stroke-linecap'],
  [SPAttr.STROKE_LINEJOIN, 'stroke-linejoin'],
  [SPAttr.STROKE_MITERLIMIT, 'stroke-miterlimit'],
  [SPAttr.STROKE_DASHARRAY, 'stroke-dasharray'],
  [SPAttr.STROKE_DASHOFFSET, 'stroke-dashoffset'],
  [SPAttr.STROKE_EXTENSIONS, '-inkscape-stroke'],
  [SPAttr.MARKER, 'marker'],
  [SPAttr.MARKER_END, 'marker-end'],
  [SPAttr.MARKER_MID, 'marker-mid'],
  [SPAttr.MARKER_START, 'marker-start'],
  [SPAttr.PAINT_ORDER, 'paint-order'],
  [SPAttr.SOLID_COLOR, 'solid-color'],
  [SPAttr.SOLID_OPACITY, 'solid-opacity'],
  [SPAttr.VECTOR_EFFECT, 'vector-effect'],

  // CSS Blending/Compositing
  [SPAttr.MIX_BLEND_MODE, 'mix-blend-mode'],
  [SPAttr.ISOLATION, 'isolation'],

  // Misc. Display
  [SPAttr.DISPLAY, 'display'],
  [SPAttr.OVERFLOW_, 'overflow'],
  [SPAttr.VISIBILITY, 'visibility'],

  // Clip/Mask
  [SPAttr.CLIP, 'clip'],
  [SPAttr.CLIP_PATH, 'clip-path'],
  [SPAttr.CLIP_RULE, 'clip-rule'],
  [SPAttr.MASK, 'mask'],

  // Font
  [SPAttr.FONT, 'font'],
  [SPAttr.FONT_FAMILY, 'font-family'],
  [SPAttr.INKSCAPE_FONT_SPEC, '-inkscape-font-specification'],
  [SPAttr.FONT_SIZE, 'font-size'],
  [SPAttr.FONT_SIZE_ADJUST, 'font-size-adjust'],
  [SPAttr.FONT_STRETCH, 'font-stretch'],
  [SPAttr.FONT_STYLE, 'font-style'],
  [SPAttr.FONT_VARIANT, 'font-variant'],
  [SPAttr.FONT_WEIGHT, 'font-weight'],

  // Font Variants CSS 3
  [SPAttr.FONT_VARIANT_LIGATURES, 'font-variant-ligatures'],
  [SPAttr.FONT_VARIANT_POSITION, 'font-variant-position'],
  [SPAttr.FONT_VARIANT_CAPS, 'font-variant-caps'],
  [SPAttr.FONT_VARIANT_NUMERIC, 'font-variant-numeric'],
  [SPAttr.FONT_VARIANT_ALTERNATES, 'font-variant-alternates'],
  [SPAttr.FONT_VARIANT_EAST_ASIAN, 'font-variant-east-asian'],
  [SPAttr.FONT_FEATURE_SETTINGS, 'font-feature-settings'],

  // Variable Fonts (CSS Fonts Module Level 4)
  [SPAttr.FONT_VARIATION_SETTINGS, 'font-variation-settings'],

  // Text
  [SPAttr.TEXT_INDENT, 'text-indent'],
  [SPAttr.TEXT_ALIGN, 'text-align'],
  [SPAttr.LINE_HEIGHT, 'line-height'],
  [SPAttr.LETTER_SPACING, 'letter-spacing'],
  [SPAttr.WORD_SPACING, 'word-spacing'],
  [SPAttr.TEXT_TRANSFORM, 'text-transform'],

  // Text (CSS3)
  [SPAttr.DIRECTION, 'direction'],
  [SPAttr.WRITING_MODE, 'writing-mode'],
  [SPAttr.TEXT_ORIENTATION, 'text-orientation'],
  [SPAttr.UNICODE_BIDI, 'unicode-bidi'],
  [SPAttr.ALIGNMENT_BASELINE, 'alignment-baseline'],
  [SPAttr.BASELINE_SHIFT, 'baseline-shift'],
  [SPAttr.DOMINANT_BASELINE, 'dominant-baseline'],
  [SPAttr.GLYPH_ORIENTATION_HORIZONTAL, 'glyph-orientation-horizontal'],
  [SPAttr.GLYPH_ORIENTATION_VERTICAL, 'glyph-orientation-vertical'],
  [SPAttr.KERNING, 'kerning'],
  [SPAttr.TEXT_ANCHOR, 'text-anchor'],
  [SPAttr.WHITE_SPACE, 'white-space'],

  // SVG 2 Text Wrapping
  [SPAttr.SHAPE_INSIDE, 'shape-inside'],
  [SPAttr.SHAPE_SUBTRACT, 'shape-subtract'],
  [SPAttr.SHAPE_PADDING, 'shape-padding'],
  [SPAttr.SHAPE_MARGIN, 'shape-margin'],
  [SPAttr.INLINE_SIZE, 'inline-size'],

  // Text Decoration
  [SPAttr.TEXT_DECORATION, 'text-decoration'], // CSS 2/CSS3-Shorthand
  [SPAttr.TEXT_DECORATION_LINE, 'text-decoration-line'],
  [SPAttr.TEXT_DECORATION_STYLE, 'text-decoration-style'],
  [SPAttr.TEXT_DECORATION_COLOR, 'text-decoration-color'],
  [SPAttr.TEXT_DECORATION_FILL, 'text-decoration-fill'],
  [SPAttr.TEXT_DECORATION_STROKE, 'text-decoration-stroke'],

  // Filter
  [SPAttr.ENABLE_BACKGROUND, 'enable-background'],
  [SPAttr.FILTER, 'filter'],
  [SPAttr.FLOOD_COLOR, 'flood-color'],
  [SPAttr.FLOOD_OPACITY, 'flood-opacity'],
  [SPAttr.LIGHTING_COLOR, 'lighting-color'],
  [SPAttr.AUTO_REGION, 'inkscape:auto-region'],

  // Gradient
  [SPAttr.STOP_COLOR, 'stop-color'],
  [SPAttr.STOP_OPACITY, 'stop-opacity'],
  [SPAttr.STOP_PATH, 'path'],

  // Rendering
  [SPAttr.COLOR_INTERPOLATION, 'color-interpolation'],
  [SPAttr.COLOR_INTERPOLATION_FILTERS, 'color-interpolation-filters'],
  [SPAttr.COLOR_PROFILE, 'color-profile'],
  [SPAttr.COLOR_RENDERING, 'color-rendering'], // Obsolete
  [SPAttr.IMAGE_RENDERING, 'image-rendering'],
  [SPAttr.SHAPE_RENDERING, 'shape-rendering'],
  [SPAttr.TEXT_RENDERING, 'text-rendering'],

  // Interactivity
  [SPAttr.POINTER_EVENTS, 'pointer-events'],
  [SPAttr.CURSOR, 'cursor'],

  // Conditional
  [SPAttr.SYSTEM_LANGUAGE, 'systemLanguage'],
  [SPAttr.REQUIRED_FEATURES, 'requiredFeatures'],
  [SPAttr.REQUIRED_EXTENSIONS, 'requiredExtensions'],

  // LivePathEffect
  [SPAttr.PATH_EFFECT, 'effect'],

  // canvas blackout color
  [SPAttr.INKSCAPE_DESK_COLOR, 'inkscape:deskcolor'],
  [SPAttr.INKSCAPE_DESK_OPACITY, 'inkscape:deskopacity'],
  [SPAttr.INKSCAPE_DESK_CHECKERBOARD, 'inkscape:pagecheckerboard'], // old attr
  // rendering mode
  [SPAttr.INKSCAPE_CLIP_TO_PAGE_RENDERING, 'inkscape:clip-to-page'],
  [SPAttr.INKSCAPE_ANTIALIAS_RENDERING, 'inkscape:antialias-rendering'],
  // named view settings
  [SPAttr.INKSCAPE_ORIGIN_CORRECTION, 'origin-correction'],
  [SPAttr.INKSCAPE_Y_AXIS_DOWN, 'y-axis-down'],
];

// Sanity check: the order of props must match SPAttr.
if (props.length !== SPAttr.SPAttr_SIZE) {
  throw new Error('attributes: props does not match SPAttr');
}
props.forEach(([code], i) => {
  if (code !== i) throw new Error(`attributes: props[${i}] is out of order`);
});

/** Inverse to the props array for lookup by name. Built on first use. */
let lookupMap: Map<string, SPAttr> | undefined;

function getLookupMap(): Map<string, SPAttr> {
  if (!lookupMap) {
    lookupMap = new Map();
    for (const [code, name] of props) {
      if (name !== null) lookupMap.set(name, code);
    }
    // SVG 2.0 alias for xlink:href
    lookupMap.set('href', SPAttr.XLINK_HREF);
  }
  return lookupMap;
}

/**
 * True iff k is a property in SVG, i.e. something that can be written either in a style attribute
 * or as its own XML attribute. This must be kept in sync with SPAttr.
 * Upstream: SP_ATTRIBUTE_IS_CSS
 */
export function attributeIsCss(k: SPAttr): boolean {
  return k >= SPAttr.D && k < SPAttr.SYSTEM_LANGUAGE;
}

/**
 * Get attribute id by name. Return SPAttr.INVALID for invalid names.
 * Upstream: sp_attribute_lookup
 */
export function attributeLookup(key: string | null | undefined): SPAttr {
  if (key == null) return SPAttr.INVALID;
  return getLookupMap().get(key) ?? SPAttr.INVALID;
}

/**
 * Get attribute name by id. Return null for invalid ids.
 * Upstream: sp_attribute_name
 */
export function attributeName(id: SPAttr): string | null {
  return props[id]?.[1] ?? null;
}

/**
 * Get sorted attribute name list.
 * @param cssOnly If true, only return CSS properties
 * Upstream: sp_attribute_name_list
 */
export function attributeNameList(cssOnly = false): string[] {
  const result: string[] = [];
  for (const [code, name] of props) {
    if (name !== null && (!cssOnly || attributeIsCss(code))) result.push(name);
  }
  return result.sort();
}
