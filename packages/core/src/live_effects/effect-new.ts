// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/effect.cpp
/*
 * Copyright (C) Johan Engelen 2007 <j.b.c.engelen@utwente.nl>
 *   Abhishek Sharma
 */
import { type Effect, setEffectFactory } from './effect.ts';
import { EffectType } from './effect-enum.ts';
import { LPEAngleBisector } from './lpe-angle_bisector.ts';
import { LPEAttachPath } from './lpe-attach-path.ts';
import { LPEBendPath } from './lpe-bendpath.ts';
import { LPEBool } from './lpe-bool.ts';
import { LPEBoundingBox } from './lpe-bounding-box.ts';
import { LPEBSpline } from './lpe-bspline.ts';
import { LPECircle3Pts } from './lpe-circle_3pts.ts';
import { LPECircleWithRadius } from './lpe-circle_with_radius.ts';
import { LPECloneOriginal } from './lpe-clone-original.ts';
import { LPEConstructGrid } from './lpe-constructgrid.ts';
import { LPECopyRotate } from './lpe-copy_rotate.ts';
import { LPECurveStitch } from './lpe-curvestitch.ts';
import { LPEDashedStroke } from './lpe-dashed-stroke.ts';
import { LPEDynastroke } from './lpe-dynastroke.ts';
import { LPEEllipse5Pts } from './lpe-ellipse_5pts.ts';
import { LPEEmbroderyStitch } from './lpe-embrodery-stitch.ts';
import { LPEEnvelope } from './lpe-envelope.ts';
import { LPEExtrude } from './lpe-extrude.ts';
import { LPEFillBetweenMany } from './lpe-fill-between-many.ts';
import { LPEFillBetweenStrokes } from './lpe-fill-between-strokes.ts';
import { LPEFilletChamfer } from './lpe-fillet-chamfer.ts';
import { LPEGears } from './lpe-gears.ts';
import { LPEInterpolate } from './lpe-interpolate.ts';
import { LPEInterpolatePoints } from './lpe-interpolate_points.ts';
import { LPEJoinType } from './lpe-jointype.ts';
import { LPEKnot } from './lpe-knot.ts';
import { LPELattice } from './lpe-lattice.ts';
import { LPELattice2 } from './lpe-lattice2.ts';
import { LPELineSegment } from './lpe-line_segment.ts';
import { LPEMeasureSegments } from './lpe-measure-segments.ts';
import { LPEMirrorSymmetry } from './lpe-mirror_symmetry.ts';
import { LPEOffset } from './lpe-offset.ts';
import { LPEParallel } from './lpe-parallel.ts';
import { LPEPathLength } from './lpe-path_length.ts';
import { LPEPatternAlongPath } from './lpe-patternalongpath.ts';
import { LPEPerpBisector } from './lpe-perp_bisector.ts';
import { LPEPerspectiveEnvelope } from './lpe-perspective-envelope.ts';
import { LPEPowerClip } from './lpe-powerclip.ts';
import { LPEPowerMask } from './lpe-powermask.ts';
import { LPEPowerStroke } from './lpe-powerstroke.ts';
import { LPEPts2Ellipse } from './lpe-pts2ellipse.ts';
import { LPERecursiveSkeleton } from './lpe-recursiveskeleton.ts';
import { LPERoughHatches } from './lpe-rough-hatches.ts';
import { LPERoughen } from './lpe-roughen.ts';
import { LPERuler } from './lpe-ruler.ts';
import { LPEShowHandles } from './lpe-show_handles.ts';
import { LPESimplify } from './lpe-simplify.ts';
import { LPESketch } from './lpe-sketch.ts';
import { LPESpiro } from './lpe-spiro.ts';
import { LPETangentToCurve } from './lpe-tangent_to_curve.ts';
import { LPETaperStroke } from './lpe-taperstroke.ts';
import { LPEdoEffectStackTest } from './lpe-test-doEffect-stack.ts';
import { LPETextLabel } from './lpe-text_label.ts';
import { LPETiling } from './lpe-tiling.ts';
import { LPETransform2Pts } from './lpe-transform_2pts.ts';
import { LPEVonKoch } from './lpe-vonkoch.ts';
import type { LivePathEffectObject } from './lpeobject.ts';

/**
 * The switch of upstream Effect::New: the effect object of a type. It is a separate module
 * because the effects import the object classes; object/sp-factory.ts imports it.
 * TODO: the other effects of effect-enum.ts.
 */
function newEffect(lpenr: EffectType, lpeobj: LivePathEffectObject): Effect | null {
  switch (lpenr) {
    case EffectType.BEND_PATH:
      return new LPEBendPath(lpeobj);
    case EffectType.PATTERN_ALONG_PATH:
      return new LPEPatternAlongPath(lpeobj);
    case EffectType.ENVELOPE:
      return new LPEEnvelope(lpeobj);
    case EffectType.PERSPECTIVE_ENVELOPE:
      return new LPEPerspectiveEnvelope(lpeobj);
    case EffectType.SPIRO:
      return new LPESpiro(lpeobj);
    case EffectType.POWERMASK:
      return new LPEPowerMask(lpeobj);
    case EffectType.POWERSTROKE:
      return new LPEPowerStroke(lpeobj);
    case EffectType.CLONE_ORIGINAL:
      return new LPECloneOriginal(lpeobj);
    case EffectType.INTERPOLATE:
      return new LPEInterpolate(lpeobj);
    case EffectType.SKETCH:
      return new LPESketch(lpeobj);
    case EffectType.JOIN_TYPE:
      return new LPEJoinType(lpeobj);
    case EffectType.DASHED_STROKE:
      return new LPEDashedStroke(lpeobj);
    case EffectType.SHOW_HANDLES:
      return new LPEShowHandles(lpeobj);
    case EffectType.BOUNDING_BOX:
      return new LPEBoundingBox(lpeobj);
    case EffectType.SIMPLIFY:
      return new LPESimplify(lpeobj);
    case EffectType.ROUGHEN:
      return new LPERoughen(lpeobj);
    case EffectType.MIRROR_SYMMETRY:
      return new LPEMirrorSymmetry(lpeobj);
    case EffectType.COPY_ROTATE:
      return new LPECopyRotate(lpeobj);
    case EffectType.FILL_BETWEEN_MANY:
      return new LPEFillBetweenMany(lpeobj);
    case EffectType.FILL_BETWEEN_STROKES:
      return new LPEFillBetweenStrokes(lpeobj);
    case EffectType.FILLET_CHAMFER:
      return new LPEFilletChamfer(lpeobj);
    case EffectType.BSPLINE:
      return new LPEBSpline(lpeobj);
    case EffectType.TAPER_STROKE:
      return new LPETaperStroke(lpeobj);
    case EffectType.OFFSET:
      return new LPEOffset(lpeobj);
    case EffectType.BOOL_OP:
      return new LPEBool(lpeobj);
    case EffectType.POWERCLIP:
      return new LPEPowerClip(lpeobj);
    case EffectType.TILING:
      return new LPETiling(lpeobj);
    case EffectType.GEARS:
      return new LPEGears(lpeobj);
    case EffectType.VONKOCH:
      return new LPEVonKoch(lpeobj);
    case EffectType.KNOT:
      return new LPEKnot(lpeobj);
    case EffectType.ROUGH_HATCHES:
      return new LPERoughHatches(lpeobj);
    case EffectType.LATTICE2:
      return new LPELattice2(lpeobj);
    case EffectType.ATTACH_PATH:
      return new LPEAttachPath(lpeobj);
    case EffectType.EXTRUDE:
      return new LPEExtrude(lpeobj);
    case EffectType.DOEFFECTSTACK_TEST:
      return new LPEdoEffectStackTest(lpeobj);
    case EffectType.DYNASTROKE:
      return new LPEDynastroke(lpeobj);
    case EffectType.LATTICE:
      return new LPELattice(lpeobj);
    case EffectType.RECURSIVE_SKELETON:
      return new LPERecursiveSkeleton(lpeobj);
    case EffectType.EMBRODERY_STITCH:
      return new LPEEmbroderyStitch(lpeobj);
    case EffectType.ANGLE_BISECTOR:
      return new LPEAngleBisector(lpeobj);
    case EffectType.CIRCLE_3PTS:
      return new LPECircle3Pts(lpeobj);
    case EffectType.CIRCLE_WITH_RADIUS:
      return new LPECircleWithRadius(lpeobj);
    case EffectType.CONSTRUCT_GRID:
      return new LPEConstructGrid(lpeobj);
    case EffectType.CURVE_STITCH:
      return new LPECurveStitch(lpeobj);
    case EffectType.ELLIPSE_5PTS:
      return new LPEEllipse5Pts(lpeobj);
    case EffectType.INTERPOLATE_POINTS:
      return new LPEInterpolatePoints(lpeobj);
    case EffectType.LINE_SEGMENT:
      return new LPELineSegment(lpeobj);
    case EffectType.MEASURE_SEGMENTS:
      return new LPEMeasureSegments(lpeobj);
    case EffectType.PARALLEL:
      return new LPEParallel(lpeobj);
    case EffectType.PATH_LENGTH:
      return new LPEPathLength(lpeobj);
    case EffectType.PERP_BISECTOR:
      return new LPEPerpBisector(lpeobj);
    case EffectType.PTS2ELLIPSE:
      return new LPEPts2Ellipse(lpeobj);
    case EffectType.RULER:
      return new LPERuler(lpeobj);
    case EffectType.TANGENT_TO_CURVE:
      return new LPETangentToCurve(lpeobj);
    case EffectType.TEXT_LABEL:
      return new LPETextLabel(lpeobj);
    case EffectType.TRANSFORM_2PTS:
      return new LPETransform2Pts(lpeobj);
    default:
      return null;
  }
}

setEffectFactory(newEffect);
