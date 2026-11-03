// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/parameter/patharray.cpp, src/live_effects/parameter/patharray.h
/*
 * Copyright (C) Theodore Janeczko 2012 <flutterguy317@gmail.com>
 */
import type { PathVector } from '@inkscape-web/geom';
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
import { SPShape } from '../../object/sp-shape.ts';
import { URIReference } from '../../object/uri-references.ts';
import type { Effect } from '../effect.ts';
import { ParamType } from '../effect-enum.ts';
import { LPEBSpline, sp_bspline_do_effect } from '../lpe-bspline.ts';
import { LPESpiro, sp_spiro_do_effect } from '../lpe-spiro.ts';
import { Parameter, type ParamWidget } from './parameter.ts';

/** One linked path of a PathArrayParam (upstream PathAndDirectionAndVisible). */
export class PathAndDirectionAndVisible {
  href = '';
  readonly ref: URIReference;
  _pathvector: PathVector = [];
  reversed = false;
  visibled = true;
  connections: (() => void)[] = [];
  linked_changed_connection: (() => void) | null = null;

  constructor(owner: SPObject) {
    this.ref = new URIReference(owner);
  }

  disconnect(): void {
    for (const c of this.connections) c();
    this.connections = [];
  }
}

/**
 * A list of links to paths, each with a reverse and a visible flag, written as
 * "#id,reversed,visible | ..." (upstream PathArrayParam).
 * TODO: text as linked path (getNormalizedBpath), relink to the successor after ungroup.
 */
export class PathArrayParam extends Parameter {
  _vector: PathAndDirectionAndVisible[] = [];
  _from_original_d = false;
  _allow_only_bspline_spiro = false;

  constructor(label: string, tip: string, key: string, effect: Effect) {
    super(label, tip, key, effect);
    // refresh widgets on load to allow to remove the
    // memory leak calling initui here
    effect.refresh_widgets = true;
    this.oncanvas_editable = true;
  }

  param_set_default(): void {}
  param_update_default(_default_value: string): void {}

  param_newWidget(): ParamWidget | null {
    return {
      kind: 'patharray',
      rows: this._vector.map((w) => {
        const obj = w.ref.getObject();
        return {
          label: obj?.getId() ? (obj.label() ?? obj.getId() ?? w.href) : w.href,
          reversed: w.reversed,
          visible: w.visibled,
        };
      }),
    };
  }

  override param_get_satellites(): SPObject[] {
    return this._vector.flatMap((w) => {
      const obj = w.ref.isAttached() ? w.ref.getObject() : null;
      return obj ? [obj] : [];
    });
  }

  // The widget (rows by index; upstream uses the selected row of a tree view)

  on_reverse_toggled(index: number): void {
    const w = this._vector[index];
    if (!w) return;
    w.reversed = !w.reversed;
    this.param_write_to_repr(this.param_getSVGValue());
    this.param_effect.makeUndoDone(C_('Undo', 'Link path parameter to path'));
  }

  on_visible_toggled(index: number): void {
    const w = this._vector[index];
    if (!w) return;
    w.visibled = !w.visibled;
    this.param_write_to_repr(this.param_getSVGValue());
    this.param_effect.makeUndoDone(C_('Undo', 'Toggle path parameter visibility'));
  }

  on_up_button_click(index: number): void {
    if (index <= 0 || index >= this._vector.length) return;
    const [w] = this._vector.splice(index, 1);
    this._vector.splice(index - 1, 0, w as PathAndDirectionAndVisible);
    this.param_write_to_repr(this.param_getSVGValue());
    this.param_effect.makeUndoDone(C_('Undo', 'Move path up'));
  }

  on_down_button_click(index: number): void {
    if (index < 0 || index >= this._vector.length - 1) return;
    const [w] = this._vector.splice(index, 1);
    this._vector.splice(index + 1, 0, w as PathAndDirectionAndVisible);
    this.param_write_to_repr(this.param_getSVGValue());
    this.param_effect.makeUndoDone(C_('Undo', 'Move path down'));
  }

  on_remove_button_click(index: number): void {
    const w = this._vector[index];
    if (!w) return;
    this.unlink(w);
    this.param_write_to_repr(this.param_getSVGValue());
    this.param_effect.makeUndoDone(C_('Undo', 'Remove path'));
  }

  /** Add links to the copied paths and texts pathsid (upstream on_link_button_click; the dialog reads the clipboard). */
  on_link_button_click(pathsid: string[]): void {
    if (pathsid.length === 0) return;
    const items = [this.param_getSVGValue(), ...pathsid.map((id) => `#${id},0,1`)].filter((s) => s);
    this.param_write_to_repr(items.join('|'));
    this.param_effect.makeUndoDone(C_('Undo', 'Link patharray parameter to path'));
  }

  unlink(to: PathAndDirectionAndVisible): void {
    to.disconnect();
    to.linked_changed_connection?.();
    to.ref.detach();
    to._pathvector = [];
    to.href = '';
    const i = this._vector.indexOf(to);
    if (i >= 0) this._vector.splice(i, 1);
  }

  start_listening(): void {
    for (const w of this._vector) this.linked_changed(null, w.ref.getObject(), w);
  }

  setFromOriginalD(from_original_d: boolean): void {
    this._from_original_d = from_original_d;
    this.update();
  }

  allowOnlyBsplineSpiro(allow_only_bspline_spiro: boolean): void {
    this._allow_only_bspline_spiro = allow_only_bspline_spiro;
    this.update();
  }

  linked_release(to: PathAndDirectionAndVisible): void {
    if (this.param_effect.getLPEObj()) to.disconnect();
  }

  linked_changed(_old_obj: SPObject | null, new_obj: SPObject | null, to: PathAndDirectionAndVisible): void {
    to.disconnect();
    if (new_obj instanceof SPItem) {
      to.connections.push(
        new_obj.releaseSignal.connect(() => this.linked_release(to)),
        new_obj.modifiedSignal.connect((obj, flags) => this.linked_modified(obj, flags, to)),
      );
      this.linked_modified(new_obj, SP_OBJECT_MODIFIED_FLAG, to);
    } else {
      this.param_effect.getLPEObj().requestModified(SP_OBJECT_MODIFIED_FLAG);
    }
  }

  setPathVector(linked_obj: SPObject | null, to: PathAndDirectionAndVisible): void {
    let curve: PathVector | null = null;
    if (linked_obj instanceof SPShape) {
      const lpe_item = linked_obj as SPShape & SPLPEItem;
      if (this._from_original_d) {
        curve = linked_obj.curveForEdit();
      } else if (this._allow_only_bspline_spiro && lpe_item.hasPathEffect()) {
        curve = linked_obj.curveForEdit();
        for (const i of lpe_item.getEffectList()) {
          const lpe = i.lpeobject?.get_lpe();
          if (!curve) break;
          if (lpe instanceof LPEBSpline) curve = sp_bspline_do_effect(curve, 0, [], lpe.uniform.get_value());
          else if (lpe instanceof LPESpiro) curve = sp_spiro_do_effect(curve);
        }
      } else {
        curve = linked_obj.curve();
      }
    }
    // curve invalid, set empty pathvector
    to._pathvector = curve ?? [];
  }

  linked_modified(linked_obj: SPObject, flags: number, to: PathAndDirectionAndVisible): void {
    if (
      !this._updating &&
      flags &
        (SP_OBJECT_MODIFIED_FLAG |
          SP_OBJECT_STYLE_MODIFIED_FLAG |
          SP_OBJECT_CHILD_MODIFIED_FLAG |
          SP_OBJECT_VIEWPORT_MODIFIED_FLAG)
    ) {
      this.setPathVector(linked_obj, to);
      if (!this.param_effect.is_load || this.param_effect.isReady()) {
        this.param_effect.getLPEObj().requestModified(SP_OBJECT_MODIFIED_FLAG);
      }
    }
  }

  param_readSVGValue(strvalue: string): boolean {
    while (this._vector.length)
      this.unlink(this._vector[this._vector.length - 1] as PathAndDirectionAndVisible);
    for (const item of strvalue.split('|')) {
      const s = item.trim();
      if (!s.startsWith('#')) continue;
      const sub = s.split(',');
      const w = new PathAndDirectionAndVisible(this.param_effect.getLPEObj());
      w.href = sub[0] as string;
      w.reversed = sub[1] !== undefined && sub[1].startsWith('1');
      //Like this to make backwards compatible, new value added in 0.93
      w.visibled = sub[2] === undefined || sub[2].startsWith('1');
      w.linked_changed_connection = w.ref.changedSignal.connect((o, n) => this.linked_changed(o, n, w));
      w.ref.try_attach(w.href);
      this._vector.push(w);
    }
    return true;
  }

  param_getSVGValue(): string {
    return this._vector.map((w) => `${w.href},${w.reversed ? '1' : '0'},${w.visibled ? '1' : '0'}`).join('|');
  }

  param_getDefaultSVGValue(): string {
    return '';
  }

  update(): void {
    for (const w of this._vector) {
      const linked_obj = w.ref.getObject();
      if (linked_obj) this.linked_modified(linked_obj, SP_OBJECT_MODIFIED_FLAG, w);
    }
  }

  paramType(): ParamType {
    return ParamType.PATH_ARRAY;
  }
}
