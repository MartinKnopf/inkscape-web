// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpegroupbbox.cpp, src/live_effects/lpegroupbbox.h
/*
 * Copyright (C) Steren Giannini 2008 <steren.giannini@gmail.com>
 *   Abhishek Sharma
 */
import { Affine, Interval, type OptRect, unify } from '@inkscape-web/geom';
import { SPGroup } from '../object/sp-item-group.ts';
import type { SPLPEItem } from '../object/sp-lpe-item.ts';
import { Effect } from './effect.ts';

/**
 * An effect that uses the bounding box of the item (upstream: effects derive from Effect and
 * GroupBBoxEffect; here GroupBBoxEffect is a base class between them).
 */
export abstract class GroupBBoxEffect extends Effect {
  protected boundingbox_X = new Interval();
  protected boundingbox_Y = new Interval();

  protected clip_mask_bbox(item: SPLPEItem, transform: Affine): OptRect {
    let bbox: OptRect = null;
    const affine = transform.multiply(item.transform);
    const clip_path = item.getClipObject();
    if (clip_path) bbox = unify(bbox, clip_path.geometricBounds(affine));
    const mask_path = item.getMaskObject();
    if (mask_path) bbox = unify(bbox, mask_path.visualBounds(affine));
    if (item instanceof SPGroup) {
      for (const iter of item.item_list()) {
        if ('path_effect_list' in iter) bbox = unify(bbox, this.clip_mask_bbox(iter as SPLPEItem, affine));
      }
    }
    return bbox;
  }

  /**
   * Updates the boundingbox_X and boundingbox_Y values from the geometric bounding box of lpeitem.
   *
   * @pre   lpeitem must have an existing geometric boundingbox (usually this is guaranteed when: \code cast<SPShape>(lpeitem)->curve != NULL \endcode )
   *        It's not possible to run LPEs on items without their original-d having a bbox.
   * @param lpeitem   This is not allowed to be NULL.
   * @param absolute  Determines whether the bbox should be calculated of the untransformed lpeitem (\c absolute = \c false)
   *                  or of the transformed lpeitem (\c absolute = \c true) using sp_item_i2doc_affine.
   * @post Updated values of boundingbox_X and boundingbox_Y. These intervals are set to empty intervals when the precondition is not met.
   */
  protected original_bbox(
    lpeitem: SPLPEItem,
    absolute = false,
    clip_mask = false,
    base_transform = Affine.identity(),
  ): void {
    // Get item bounding box
    const transform = absolute ? lpeitem.i2docAffine() : base_transform;
    let bbox = lpeitem.geometricBounds(transform);
    if (clip_mask)
      bbox = unify(bbox, this.clip_mask_bbox(lpeitem, transform.multiply(lpeitem.transform.inverse())));
    if (bbox) {
      this.boundingbox_X = bbox.xInterval;
      this.boundingbox_Y = bbox.yInterval;
    } else {
      this.boundingbox_X = new Interval();
      this.boundingbox_Y = new Interval();
    }
  }
}
