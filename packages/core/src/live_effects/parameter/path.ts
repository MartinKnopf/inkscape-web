// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/parameter/path.cpp, src/live_effects/parameter/path.h
/*
 * Copyright (C) Johan Engelen 2007 <j.b.c.engelen@utwente.nl>
 *
 * Abhishek Sharma
 */
import { Affine, type PathVector } from '@inkscape-web/geom';
import { C_ } from '../../i18n.ts';
import { SPItem } from '../../object/sp-item.ts';
import type { SPLPEItem } from '../../object/sp-lpe-item.ts';
import {
  SP_OBJECT_CHILD_MODIFIED_FLAG,
  SP_OBJECT_MODIFIED_FLAG,
  SP_OBJECT_STYLE_MODIFIED_FLAG,
  SP_OBJECT_VIEWPORT_MODIFIED_FLAG,
  type SPObject,
} from '../../object/sp-object.ts';
import { BadURIException, URIReference } from '../../object/uri-references.ts';
import { sp_svg_read_pathv, sp_svg_write_path } from '../../svg/svg-path.ts';
import { Signal } from '../../util/signal.ts';
import type { Effect } from '../effect.ts';
import { ParamType } from '../effect-enum.ts';
import { Parameter, type ParamWidget } from './parameter.ts';

/** The curve of a linked object, if it is a shape (upstream casts to SPShape; SPShape extends SPLPEItem). */
interface CurveSource {
  curve(): PathVector | null;
  curveForEdit(): PathVector | null;
}
const isCurveSource = (o: SPObject): o is SPObject & CurveSource => 'curveForEdit' in o;

/**
 * A path, edited on canvas with the node tool, or a link ("#id") to the path of another object
 * (upstream PathParam).
 * TODO: copy and paste with the clipboard, text objects as linked paths.
 */
export class PathParam extends Parameter {
  /** Set when the path changes; effects that cache derived data reset it. */
  changed = true;
  protected _pathvector: PathVector = [];
  protected defvalue: string;
  _from_original_d = false;
  href: string | null = null;
  readonly ref: URIReference;
  readonly signal_path_changed = new Signal<[]>();
  #linked_connections: (() => void)[] = [];

  constructor(label: string, tip: string, key: string, effect: Effect, default_value = 'M0,0 L1,0') {
    super(label, tip, key, effect);
    this.defvalue = default_value;
    this.ref = new URIReference(effect.getLPEObj());
    this.ref.changedSignal.connect((_old, new_ref) => this.#ref_changed(new_ref));
    this.param_readSVGValue(this.defvalue);
    this.oncanvas_editable = true;
  }

  /** The linked object, or null. */
  getItem(): SPItem | null {
    const o = this.ref.getObject();
    return o instanceof SPItem ? o : null;
  }

  /** Reread the linked path. */
  reload(): void {
    this.setUpdating(false);
    const item = this.getItem();
    if (item) {
      this.#start_listening(item);
      item.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
    }
  }

  /** The transform of the linked path relative to the item (identity without link). */
  get_relative_affine(): Affine {
    const item = this.getItem();
    if (!item) return Affine.identity();
    const lpeitems = this.param_effect.getCurrrentLPEItems();
    if (lpeitems.length === 1) this.param_effect.sp_lpe_item = lpeitems[0] as SPLPEItem;
    const target = this.param_effect.sp_lpe_item;
    return target ? item.getRelativeTransform(target) : Affine.identity();
  }

  get_pathvector(): PathVector {
    return this._pathvector;
  }

  param_set_default(): void {
    this.param_readSVGValue(this.defvalue);
  }
  param_set_and_write_default(): void {
    this.param_write_to_repr(this.defvalue);
  }
  override param_get_satellites(): SPObject[] {
    const o = this.ref.getObject();
    return o ? [o] : [];
  }
  param_readSVGValue(strvalue: string): boolean {
    this._pathvector = [];
    this.unlink();
    if (strvalue.startsWith('#')) {
      this.href = strvalue;
      try {
        this.ref.attach(this.href);
        const i = this.ref.getObject();
        if (i) this.#linked_modified_callback(i, SP_OBJECT_MODIFIED_FLAG);
        // else: document still processing new events. Repr of the linked object not created yet.
      } catch (e) {
        if (!(e instanceof BadURIException)) throw e;
        console.warn(e.message);
        this.ref.detach();
        this._pathvector = sp_svg_read_pathv(this.defvalue);
      }
    } else {
      this._pathvector = sp_svg_read_pathv(strvalue);
    }
    this.emit_changed();
    return true;
  }
  param_getSVGValue(): string {
    return this.href ?? sp_svg_write_path(this._pathvector);
  }
  param_getDefaultSVGValue(): string {
    return this.defvalue;
  }
  param_update_default(default_value: string): void {
    this.defvalue = default_value;
  }
  param_newWidget(): ParamWidget | null {
    return { kind: 'path' };
  }
  override addCanvasIndicators(_lpeitem: SPLPEItem, hp_vec: PathVector[]): void {
    hp_vec.push(this._pathvector);
  }
  /** Only applies transform when not referring to other path! */
  override param_transform_multiply(postmul: Affine, _set: boolean): void {
    if (this.href) return;
    this.set_new_value(
      this._pathvector.map((p) => p.transformed(postmul)),
      true,
    );
  }

  /**
   * This method sets new path data.
   * If this PathParam refers to another path, this link is removed (and replaced with explicit path data).
   *
   * If write_to_svg = true :
   *          The new path data is written to SVG. In this case the signal_path_changed signal
   *          is not directly emitted in this method, because writing to SVG
   *          triggers the LPEObject to which this belongs to call Effect::setParameter which calls
   *          PathParam::readSVGValue, which finally emits the signal_path_changed signal.
   * If write_to_svg = false :
   *          The new path data is not written to SVG. This method will emit the signal_path_changed signal.
   */
  set_new_value(newpath: PathVector, write_to_svg: boolean): void {
    this.unlink();
    if (newpath.length === 0) {
      this.param_set_and_write_default();
      return;
    }
    this._pathvector = newpath;
    if (write_to_svg) this.param_write_to_repr(sp_svg_write_path(this._pathvector));
    else this.emit_changed();
  }

  /** Paste path data in document coordinates (upstream paste_param_path with the selected item). */
  paste_param_path(svgd: string, item: SPLPEItem | null): void {
    if (!svgd) return;
    this.unlink();
    let d = svgd;
    if (item) {
      const m = item.i2docAffine().inverse();
      d = sp_svg_write_path(sp_svg_read_pathv(svgd).map((p) => p.transformed(m)));
    }
    this.param_write_to_repr(d);
    this.param_effect.makeUndoDone(C_('Undo', 'Paste path parameter'));
  }

  /** Link to the path with id (upstream linkitem). */
  linkitem(pathid: string): void {
    if (!pathid) return;
    const href = `#${pathid}`;
    if (this.href === href) return;
    this.param_write_to_repr(href);
    this.param_effect.makeUndoDone(C_('Undo', 'Link path parameter to path'));
  }

  emit_changed(): void {
    this.changed = true;
    this.signal_path_changed.emit();
  }

  unlink(): void {
    if (this.href) {
      this.ref.detach();
      this.href = null;
    }
  }

  paramType(): ParamType {
    return ParamType.PATH;
  }

  #quit_listening(): void {
    for (const c of this.#linked_connections) c();
    this.#linked_connections = [];
  }

  #start_listening(to: SPObject | null): void {
    if (!to) return;
    this.#quit_listening();
    this.#linked_connections.push(
      to.deleteSignal.connect(() => this.#linked_deleted()),
      to.modifiedSignal.connect((obj, flags) => this.#linked_modified(obj, flags)),
    );
    if (to instanceof SPItem) {
      this.#linked_connections.push(
        to.transformedSignal.connect(() => this.#linked_modified_callback(to, SP_OBJECT_MODIFIED_FLAG)),
      );
    }
    this.#linked_modified(to, SP_OBJECT_MODIFIED_FLAG); // simulate linked_modified signal, so that path data is updated
  }

  #ref_changed(new_ref: SPObject | null): void {
    this.#quit_listening();
    if (new_ref) this.#start_listening(new_ref);
  }

  #linked_deleted(): void {
    const pv = this._pathvector;
    this.#quit_listening();
    this.set_new_value(pv, true);
  }

  #linked_modified(linked_obj: SPObject, flags: number): void {
    if (
      flags &
      (SP_OBJECT_MODIFIED_FLAG |
        SP_OBJECT_STYLE_MODIFIED_FLAG |
        SP_OBJECT_CHILD_MODIFIED_FLAG |
        SP_OBJECT_VIEWPORT_MODIFIED_FLAG)
    ) {
      this.#linked_modified_callback(linked_obj, flags);
    }
  }

  #linked_modified_callback(linked_obj: SPObject, flags: number): void {
    if (
      this._updating ||
      !(
        flags &
        (SP_OBJECT_MODIFIED_FLAG |
          SP_OBJECT_STYLE_MODIFIED_FLAG |
          SP_OBJECT_CHILD_MODIFIED_FLAG |
          SP_OBJECT_VIEWPORT_MODIFIED_FLAG)
      )
    ) {
      return;
    }
    let curve: PathVector | null = null;
    if (isCurveSource(linked_obj))
      curve = this._from_original_d ? linked_obj.curveForEdit() : linked_obj.curve();
    // TODO: text (getNormalizedBpath).
    const old = this._pathvector;
    this._pathvector = curve ?? sp_svg_read_pathv(this.defvalue);
    this.emit_changed();
    const unchanged =
      old.length === this._pathvector.length &&
      old.every((p, i) => p.equals(this._pathvector[i] as typeof p));
    if (!unchanged || !this.param_effect.is_load) {
      this.param_effect.getLPEObj().requestModified(SP_OBJECT_MODIFIED_FLAG);
    }
  }
}
