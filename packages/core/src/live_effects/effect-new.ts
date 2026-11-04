// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/effect.cpp
/*
 * Copyright (C) Johan Engelen 2007 <j.b.c.engelen@utwente.nl>
 *   Abhishek Sharma
 */
import { type Effect, setEffectFactory } from './effect.ts';
import { EffectType } from './effect-enum.ts';
import { LPEBendPath } from './lpe-bendpath.ts';
import { LPEBoundingBox } from './lpe-bounding-box.ts';
import { LPEBSpline } from './lpe-bspline.ts';
import { LPECloneOriginal } from './lpe-clone-original.ts';
import { LPECopyRotate } from './lpe-copy_rotate.ts';
import { LPEDashedStroke } from './lpe-dashed-stroke.ts';
import { LPEEnvelope } from './lpe-envelope.ts';
import { LPEFillBetweenMany } from './lpe-fill-between-many.ts';
import { LPEFillBetweenStrokes } from './lpe-fill-between-strokes.ts';
import { LPEFilletChamfer } from './lpe-fillet-chamfer.ts';
import { LPEInterpolate } from './lpe-interpolate.ts';
import { LPEJoinType } from './lpe-jointype.ts';
import { LPEMirrorSymmetry } from './lpe-mirror_symmetry.ts';
import { LPEOffset } from './lpe-offset.ts';
import { LPEPatternAlongPath } from './lpe-patternalongpath.ts';
import { LPEPerspectiveEnvelope } from './lpe-perspective-envelope.ts';
import { LPEPowerMask } from './lpe-powermask.ts';
import { LPEPowerStroke } from './lpe-powerstroke.ts';
import { LPERoughen } from './lpe-roughen.ts';
import { LPEShowHandles } from './lpe-show_handles.ts';
import { LPESimplify } from './lpe-simplify.ts';
import { LPESketch } from './lpe-sketch.ts';
import { LPESpiro } from './lpe-spiro.ts';
import { LPETaperStroke } from './lpe-taperstroke.ts';
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
    default:
      return null;
  }
}

setEffectFactory(newEffect);
