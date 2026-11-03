// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-fill-between-many.cpp, src/live_effects/lpe-fill-between-many.h
/*
 * Copyright (C) Theodore Janeczko 2012 <flutterguy317@gmail.com>
 */
import { are_near, distance, LineSegment, type Path, type PathVector, type Point } from '@inkscape-web/geom';
import { _, N_ } from '../i18n.ts';
import { SPItem } from '../object/sp-item.ts';
import type { SPLPEItem } from '../object/sp-lpe-item.ts';
import { EnumDataConverter } from '../util/enums.ts';
import { Effect } from './effect.ts';
import type { LivePathEffectObject } from './lpeobject.ts';
import { BoolParam } from './parameter/bool.ts';
import { EnumParam } from './parameter/enum.ts';
import { type PathAndDirectionAndVisible, PathArrayParam } from './parameter/patharray.ts';

export enum Filllpemethod {
  FLM_ORIGINALD,
  FLM_BSPLINESPIRO,
  FLM_D,
  FLM_END,
}

const FLMConverter = new EnumDataConverter<Filllpemethod>(
  [
    { id: Filllpemethod.FLM_ORIGINALD, label: N_('Without LPEs'), key: 'originald' },
    { id: Filllpemethod.FLM_BSPLINESPIRO, label: N_('With Spiro or BSpline'), key: 'bsplinespiro' },
    { id: Filllpemethod.FLM_D, label: N_('With all LPEs'), key: 'd' },
  ],
  Filllpemethod.FLM_END,
);

/** Close the gap when the end of a closed path is near its start (upstream Path::snapEnds). */
function snapEnds(path: Path, precision: number): void {
  if (!path.closed()) return;
  if (path.sizeOpen() > 1 && path.closingSegment().length() <= precision) path.setFinal(path.initialPoint());
}

/** Whether the version "major.minor..." is between lower and upper (upstream Version::isInsideRangeExclusive). */
function insideRangeExclusive(
  version: string | null,
  lower: [number, number],
  upper: [number, number],
): boolean {
  const m = /^(\d+)\.(\d+)/.exec(version ?? '');
  const v = m ? [Number(m[1]), Number(m[2])] : [0, 0];
  const cmp = (a: number[], b: number[]) =>
    (a[0] as number) - (b[0] as number) || (a[1] as number) - (b[1] as number);
  return cmp(v, lower) > 0 && cmp(v, upper) < 0;
}

/**
 * Fill between many (upstream LPEFillBetweenMany): a path made of the linked paths, joined end to
 * end, to fill the area between them.
 * TODO: moving the linked paths with the item (upstream transform_multiply_nested).
 */
export class LPEFillBetweenMany extends Effect {
  readonly linked_paths: PathArrayParam;
  readonly method: EnumParam<Filllpemethod>;
  readonly join: BoolParam;
  readonly close: BoolParam;
  readonly autoreverse: BoolParam;
  previous_method = Filllpemethod.FLM_END;
  legacytest = false;

  constructor(lpeobject: LivePathEffectObject) {
    super(lpeobject);
    this.linked_paths = new PathArrayParam(
      _('Linked path:'),
      _('Paths from which to take the original path data'),
      'linkedpaths',
      this,
    );
    this.method = new EnumParam(
      _('LPEs:'),
      _('Which LPEs of the linked paths should be considered'),
      'method',
      FLMConverter,
      this,
      Filllpemethod.FLM_BSPLINESPIRO,
    );
    this.join = new BoolParam(_('Join subpaths'), _('Join subpaths'), 'join', this, true);
    this.close = new BoolParam(_('Close'), _('Close path'), 'close', this, true);
    this.autoreverse = new BoolParam(_('Autoreverse'), _('Autoreverse'), 'autoreverse', this, true);
    this.registerParameter(this.linked_paths);
    this.registerParameter(this.method);
    this.registerParameter(this.join);
    this.registerParameter(this.close);
    this.registerParameter(this.autoreverse);
    this.linked_paths.setUpdating(true);
  }

  protected override doOnApply(_lpeitem: SPLPEItem): void {
    this.lpeversion.param_setValue('1.2', true);
  }

  protected override doOnOpen(_lpeitem: SPLPEItem): boolean {
    if (!this.is_load || this.is_applied) return false;
    this.linked_paths.setUpdating(false);
    this.linked_paths.start_listening();
    const lpeitems = this.getCurrrentLPEItems();
    if (lpeitems.length === 1) this.sp_lpe_item = lpeitems[0] as SPLPEItem;
    return false;
  }

  protected override doBeforeEffect(_lpeitem: SPLPEItem): void {
    this.legacytest = false;
    const lpeitems = this.getCurrrentLPEItems();
    if (lpeitems.length === 1) this.sp_lpe_item = lpeitems[0] as SPLPEItem;
    if (this.is_load) {
      this.linked_paths.setUpdating(false);
      this.linked_paths.start_listening();
    }
    if (this.lpeversion.param_getSVGValue() < '1.2') this.legacytest = true;
  }

  /** The linked item of w, if it gives a path to use. */
  #usable(w: PathAndDirectionAndVisible): SPItem | null {
    const item = w.ref.isAttached() ? w.ref.getObject() : null;
    return item instanceof SPItem && w._pathvector.length > 0 && w.visibled ? item : null;
  }

  #relative(item: SPItem, p: Path): Path {
    return this.sp_lpe_item ? p.transformed(item.getRelativeTransform(this.sp_lpe_item)) : p;
  }

  /** Join linked_path to the end of the first result path, or add it as a new path. */
  #add(res_pathv: Path[], linked_path: Path, reverse_to_nearest: boolean): void {
    let lp = linked_path;
    const first = res_pathv[0];
    if (first && this.join.get_value()) {
      if (
        reverse_to_nearest &&
        distance(first.finalPoint(), lp.initialPoint()) > distance(first.finalPoint(), lp.finalPoint())
      ) {
        lp = lp.reversed();
      }
      if (!are_near(first.finalPoint(), lp.initialPoint(), 0.1)) {
        first.appendCurve(new LineSegment(first.finalPoint(), lp.initialPoint()));
      } else {
        lp = lp.clone();
        lp.setInitial(first.finalPoint());
      }
      first.append(lp);
    } else {
      if (this.close.get_value() && !this.join.get_value()) {
        lp = lp.clone();
        lp.close();
      }
      res_pathv.push(lp);
    }
  }

  override doEffect(curve: PathVector): PathVector {
    const method = this.method.get_value();
    if (this.previous_method !== method) {
      if (method === Filllpemethod.FLM_BSPLINESPIRO) {
        this.linked_paths.allowOnlyBsplineSpiro(true);
        this.linked_paths.setFromOriginalD(false);
      } else if (method === Filllpemethod.FLM_ORIGINALD) {
        this.linked_paths.allowOnlyBsplineSpiro(false);
        this.linked_paths.setFromOriginalD(true);
      } else {
        this.linked_paths.allowOnlyBsplineSpiro(false);
        this.linked_paths.setFromOriginalD(false);
      }
      this.previous_method = method;
    }
    const vec = this.linked_paths._vector;
    const res_pathv: Path[] = [];
    if (!this.autoreverse.get_value()) {
      for (const iter of vec) {
        const item = this.#usable(iter);
        if (!item) continue;
        for (const p of iter._pathvector) {
          const linked_path = this.#relative(item, iter.reversed ? p.reversed() : p);
          this.#add(res_pathv, linked_path, false);
        }
      }
    } else {
      let counter = 0;
      let current: Point | null = null;
      const done: number[] = [];
      for (const iter of vec) {
        const item = this.#usable(iter);
        if (!item) continue;
        const front = iter._pathvector[0] as Path;
        if (front.closed() && vec.length > 1) {
          counter++;
          continue;
        }
        if (counter === 0) {
          let initial_path = front;
          if (!this.legacytest && iter.reversed) initial_path = initial_path.reversed();
          done.push(0);
          if (this.close.get_value() && !this.join.get_value()) {
            initial_path = initial_path.clone();
            initial_path.close();
          }
          initial_path = this.#relative(item, initial_path);
          res_pathv.push(initial_path);
          current = (res_pathv[0] as Path).finalPoint();
        }
        let dist = Number.POSITIVE_INFINITY;
        let counter2 = 0;
        let added = 0;
        let nearest: PathAndDirectionAndVisible | null = null;
        for (const iter2 of vec) {
          const item2 = this.#usable(iter2);
          if (!item2) continue;
          const front2 = iter2._pathvector[0] as Path;
          if (item === item2 || done.includes(counter2) || (front2.closed() && vec.length > 1)) {
            counter2++;
            continue;
          }
          let start = front2.initialPoint();
          let end = front2.finalPoint();
          if (!this.legacytest && iter2.reversed) [start, end] = [end, start];
          if (!this.legacytest) current = (res_pathv[res_pathv.length - 1] as Path).finalPoint();
          const c = current as Point;
          const distance_iter = Math.min(distance(c, end), distance(c, start));
          if (dist > distance_iter) {
            dist = distance_iter;
            nearest = iter2;
            added = counter2;
          }
          counter2++;
        }
        if (nearest) {
          done.push(added);
          const nfront = nearest._pathvector[0] as Path;
          let start = nfront.initialPoint();
          let end = nfront.finalPoint();
          if (!this.legacytest && nearest.reversed) [start, end] = [end, start];
          const c = current as Point;
          let linked_path = distance(c, end) > distance(c, start) ? nfront : nfront.reversed();
          if (this.legacytest) current = end;
          const itemnear = nearest.ref.isAttached() ? nearest.ref.getObject() : null;
          if (itemnear instanceof SPItem) linked_path = this.#relative(itemnear, linked_path);
          // documents of Inkscape 1.1 and newer: join to the nearest end
          const reverse_to_nearest = !insideRangeExclusive(
            this.getSPDoc()?.getRoot().getAttribute('inkscape:version') ?? null,
            [0, 1],
            [1, 1],
          );
          this.#add(res_pathv, linked_path, reverse_to_nearest);
        }
        counter++;
      }
    }
    const first = res_pathv[0];
    if (first && this.close.get_value()) {
      first.close();
      snapEnds(first, 0.1);
    }
    return res_pathv.length ? res_pathv : curve;
  }
}
