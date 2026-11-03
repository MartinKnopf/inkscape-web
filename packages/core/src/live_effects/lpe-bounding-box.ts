// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-bounding-box.cpp, src/live_effects/lpe-bounding-box.h
/*
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { LineSegment, Path, type PathVector, type Point, type Rect } from '@inkscape-web/geom';
import { _ } from '../i18n.ts';
import { SPItem } from '../object/sp-item.ts';
import type { SPLPEItem } from '../object/sp-lpe-item.ts';
import { SP_OBJECT_MODIFIED_FLAG } from '../object/sp-object.ts';
import { Effect } from './effect.ts';
import type { LivePathEffectObject } from './lpeobject.ts';
import { BoolParam } from './parameter/bool.ts';
import { OriginalSatelliteParam } from './parameter/satellite.ts';

/** The closed path of a rectangle (upstream Geom::Path(Rect)): corners 0 to 3, closed. */
function rectPath(r: Rect): Path {
  const corners: Point[] = [0, 1, 2, 3].map((i) => r.corner(i));
  const p = new Path(corners[0]);
  for (let i = 1; i < 4; i++) p.appendCurve(new LineSegment(corners[i - 1] as Point, corners[i] as Point));
  p.close();
  return p;
}

/** Bounding Box (upstream LPEBoundingBox): the bounding box of a linked item. */
export class LPEBoundingBox extends Effect {
  readonly linked_path: OriginalSatelliteParam;
  readonly visual_bounds: BoolParam;

  constructor(lpeobject: LivePathEffectObject) {
    super(lpeobject);
    this.linked_path = new OriginalSatelliteParam(
      _('Linked path:'),
      _('Path from which to take the original path data'),
      'linkedpath',
      this,
    );
    this.visual_bounds = new BoolParam(
      _('Visual Bounds'),
      _('Uses the visual bounding box'),
      'visualbounds',
      this,
      false,
    );
    this.registerParameter(this.linked_path);
    this.registerParameter(this.visual_bounds);
    this.linked_path.setUpdating(true);
    this.linked_path.lookup = true;
  }

  protected override doOnOpen(_lpeitem: SPLPEItem): boolean {
    if (!this.is_load || this.is_applied) return false;
    this.linked_path.setUpdating(false);
    this.linked_path.start_listening(this.linked_path.getObject());
    return false;
  }

  protected override doOnApply(_lpeitem: SPLPEItem): void {
    this.lpeversion.param_setValue('1.3', true);
  }

  protected override doBeforeEffect(_lpeitem: SPLPEItem): void {
    if (!this.is_load) return;
    this.linked_path.setUpdating(false);
    this.linked_path.start_listening(this.linked_path.getObject());
    const item = this.linked_path.getObject();
    if (item instanceof SPItem) item.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
  }

  override doEffect(curve: PathVector): PathVector {
    const item = this.linked_path.linksToItem() ? this.linked_path.getObject() : null;
    if (!(item instanceof SPItem)) return curve;
    const visual = this.visual_bounds.get_value();
    let bbox: Rect | null;
    if (this.lpeversion.param_getSVGValue() >= '1.3' && this.sp_lpe_item) {
      const trans = item.getRelativeTransform(this.sp_lpe_item);
      bbox = visual ? item.visualBounds(trans) : item.geometricBounds(trans);
    } else {
      bbox = visual ? item.visualBounds() : item.geometricBounds();
    }
    return bbox ? [rectPath(bbox)] : [];
  }
}
