// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-fill-between-strokes.cpp, src/live_effects/lpe-fill-between-strokes.h
/*
 * Copyright (C) Theodore Janeczko 2012 <flutterguy317@gmail.com>
 */
import { are_near, LineSegment, type Path, type PathVector } from '@inkscape-web/geom';
import { _ } from '../i18n.ts';
import type { SPItem } from '../object/sp-item.ts';
import type { SPLPEItem } from '../object/sp-lpe-item.ts';
import { SP_OBJECT_MODIFIED_FLAG } from '../object/sp-object.ts';
import { Effect } from './effect.ts';
import type { LivePathEffectObject } from './lpeobject.ts';
import { BoolParam } from './parameter/bool.ts';
import { OriginalPathParam } from './parameter/originalpath.ts';

/**
 * Fill between strokes (upstream LPEFillBetweenStrokes): a path made of two linked paths.
 * TODO: moving the linked paths with the item (upstream transform_multiply_nested).
 */
export class LPEFillBetweenStrokes extends Effect {
  readonly linked_path: OriginalPathParam;
  readonly second_path: OriginalPathParam;
  readonly reverse_second: BoolParam;
  readonly join: BoolParam;
  readonly close: BoolParam;
  legacytest = false;

  constructor(lpeobject: LivePathEffectObject) {
    super(lpeobject);
    this.linked_path = new OriginalPathParam(
      _('Linked path:'),
      _('Path from which to take the original path data'),
      'linkedpath',
      this,
    );
    this.second_path = new OriginalPathParam(
      _('Second path:'),
      _('Second path from which to take the original path data'),
      'secondpath',
      this,
    );
    this.reverse_second = new BoolParam(
      _('Reverse Second'),
      _('Reverses the second path order'),
      'reversesecond',
      this,
      false,
    );
    this.join = new BoolParam(_('Join subpaths'), _('Join subpaths'), 'join', this, true);
    this.close = new BoolParam(_('Close'), _('Close path'), 'close', this, true);
    this.registerParameter(this.linked_path);
    this.registerParameter(this.second_path);
    this.registerParameter(this.reverse_second);
    this.registerParameter(this.join);
    this.registerParameter(this.close);
    this.linked_path.setUpdating(true);
    this.second_path.setUpdating(true);
  }

  protected override doOnApply(_lpeitem: SPLPEItem): void {
    this.lpeversion.param_setValue('1.2', true);
  }

  #listen(): void {
    this.linked_path.setUpdating(false);
    this.second_path.setUpdating(false);
    this.linked_path.reload();
    this.second_path.reload();
  }

  protected override doOnOpen(_lpeitem: SPLPEItem): boolean {
    if (!this.is_load || this.is_applied) return false;
    this.#listen();
    const lpeitems = this.getCurrrentLPEItems();
    if (lpeitems.length === 1) this.sp_lpe_item = lpeitems[0] as SPLPEItem;
    return false;
  }

  protected override doBeforeEffect(_lpeitem: SPLPEItem): void {
    this.legacytest = false;
    const lpeitems = this.getCurrrentLPEItems();
    if (lpeitems.length === 1) this.sp_lpe_item = lpeitems[0] as SPLPEItem;
    if (this.is_load) this.#listen();
    if (this.lpeversion.param_getSVGValue() < '1.2') this.legacytest = true;
  }

  /** The path of param in the coordinates of the item. */
  #pathv(param: OriginalPathParam, linked: SPItem): Path[] {
    if (this.is_load) linked.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
    const affine = this.sp_lpe_item ? linked.getRelativeTransform(this.sp_lpe_item) : null;
    return param.get_pathvector().map((p) => (affine ? p.transformed(affine) : p.clone()));
  }

  override doEffect(curve: PathVector): PathVector {
    const linked1 = this.linked_path.linksToPath() ? this.linked_path.getObject() : null;
    const linked2 = this.second_path.linksToPath() ? this.second_path.getObject() : null;
    const close = this.close.get_value();
    if (linked1 && linked2) {
      const result_linked_pathv = this.#pathv(this.linked_path, linked1);
      const result_second_pathv = this.#pathv(this.second_path, linked2);
      const first = result_linked_pathv[0];
      let second = result_second_pathv[0];
      if (first && second && !first.closed()) {
        if (this.reverse_second.get_value()) {
          second = second.reversed();
          result_second_pathv[0] = second;
        }
        if (this.join.get_value()) {
          if (!are_near(first.finalPoint(), second.initialPoint(), 0.1)) {
            first.appendCurve(new LineSegment(first.finalPoint(), second.initialPoint()));
          } else {
            second.setInitial(first.finalPoint());
          }
          first.append(second);
          if (close) first.close();
        } else {
          if (close) {
            first.close();
            second.close();
          }
          result_linked_pathv.push(second);
        }
        return result_linked_pathv;
      }
      if (result_linked_pathv.length) return result_linked_pathv;
      if (result_second_pathv.length) return result_second_pathv;
    } else if (linked1) {
      const result_pathv = this.#pathv(this.linked_path, linked1);
      if (result_pathv.length) {
        if (close) result_pathv[0]?.close();
        return result_pathv;
      }
    } else if (linked2) {
      const result_pathv = this.#pathv(this.second_path, linked2);
      const first = result_pathv[0];
      if (first) {
        if (close) {
          first.close();
          if (first.sizeOpen() > 1 && first.closingSegment().length() <= 0.1)
            first.setFinal(first.initialPoint());
        }
        return result_pathv;
      }
    }
    return curve;
  }
}
