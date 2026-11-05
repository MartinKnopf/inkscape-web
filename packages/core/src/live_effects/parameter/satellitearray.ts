// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/parameter/satellitearray.cpp, src/live_effects/parameter/satellitearray.h
/*
 * Author(s):
 *   Jabiertxo Arraiza Cenoz <jabier.arraiza@marker.es>
 *
 * Copyright (C) 2018 Authors
 */
import { SPItem } from '../../object/sp-item.ts';
import {
  SP_OBJECT_CHILD_MODIFIED_FLAG,
  SP_OBJECT_MODIFIED_FLAG,
  SP_OBJECT_STYLE_MODIFIED_FLAG,
  SP_OBJECT_VIEWPORT_MODIFIED_FLAG,
  type SPObject,
} from '../../object/sp-object.ts';
import { BadURIException } from '../../object/uri-references.ts';
import { type Effect, LPEAction } from '../effect.ts';
import { ParamType } from '../effect-enum.ts';
import { Parameter, type ParamWidget } from './parameter.ts';
import { SatelliteReference } from './satellite.ts';

/** A reference of a SatelliteArrayParam: the reference and whether the item is used (upstream SatelliteReference::getActive). */
export class SatelliteArrayReference extends SatelliteReference {
  active = true;

  getActive(): boolean {
    return this.active;
  }
  setActive(active: boolean): void {
    this.active = active;
  }
}

/**
 * A list of links to items, each with an active flag, written as "#id,active | ..." (upstream
 * SatelliteArrayParam).
 * TODO: the list in the dialog (link from the clipboard, remove, reorder, toggle active) and
 * linking the selected items; the links are written to the SVG only.
 */
export class SatelliteArrayParam extends Parameter {
  _vector: SatelliteArrayReference[] = [];
  readonly #visible: boolean;
  #connections: (() => void)[] = [];

  constructor(label: string, tip: string, key: string, effect: Effect, visible = true) {
    super(label, tip, key, effect);
    this.#visible = visible;
    this.param_widget_is_visible(visible);
    if (visible) this.oncanvas_editable = true;
  }

  data(): readonly SatelliteArrayReference[] {
    return this._vector;
  }

  /** Unlink all items. */
  clear(): void {
    this.quit_listening();
    for (const ref of this._vector) ref.detach();
    this._vector = [];
  }

  param_set_default(): void {}
  param_update_default(_default_value: string): void {}

  param_newWidget(): ParamWidget | null {
    return null;
  }

  override param_get_satellites(): SPObject[] {
    const objects: SPObject[] = [];
    for (const ref of this._vector) {
      const obj = ref.getObject();
      if (obj) objects.push(obj);
    }
    return objects;
  }

  param_readSVGValue(strvalue: string): boolean {
    const changed = this.#connections.length === 0 || !this.param_effect.is_load;
    this.quit_listening();
    for (const ref of this._vector) ref.detach();
    this._vector = [];
    for (const part of strvalue === '' ? [] : strvalue.split('|')) {
      const [href, active] = part.trim().split(',');
      if (!href?.startsWith('#')) continue;
      const ref = new SatelliteArrayReference(this.param_effect.getLPEObj());
      try {
        ref.attach(href);
        ref.setActive(active === undefined || active.trim() !== '0');
        this._vector.push(ref);
      } catch (e) {
        if (!(e instanceof BadURIException)) throw e;
        console.warn(e.message);
        ref.detach();
      }
    }
    if (changed) this.start_listening();
    return true;
  }

  param_getSVGValue(): string {
    return this._vector
      .filter((ref) => ref.isAttached())
      .map((ref) => `${ref.getURI()},${ref.getActive() ? '1' : '0'}`)
      .join(' | ');
  }

  param_getDefaultSVGValue(): string {
    return '';
  }

  start_listening(): void {
    this.quit_listening();
    for (const ref of this._vector) {
      const item = ref.getObject();
      if (ref.isAttached() && item instanceof SPItem) {
        this.#connections.push(
          item.releaseSignal.connect(() => this.updatesignal()),
          item.modifiedSignal.connect((obj, flags) => this.linked_modified(obj, flags)),
          item.transformedSignal.connect(() => this.updatesignal()),
          ref.changedSignal.connect(() => this.updatesignal()),
        );
      }
    }
  }

  quit_listening(): void {
    for (const c of this.#connections) c();
    this.#connections = [];
  }

  linked_modified(_linked_obj: SPObject, flags: number): void {
    if (
      !this._updating &&
      !this.param_effect.is_load &&
      this.param_effect.isReady() &&
      flags &
        (SP_OBJECT_MODIFIED_FLAG |
          SP_OBJECT_STYLE_MODIFIED_FLAG |
          SP_OBJECT_CHILD_MODIFIED_FLAG |
          SP_OBJECT_VIEWPORT_MODIFIED_FLAG)
    ) {
      this.param_effect.processObjects(LPEAction.LPE_UPDATE);
    }
  }

  updatesignal(): void {
    if (!this._updating && !this.param_effect.is_load && this.param_effect.isReady()) {
      this.param_effect.processObjects(LPEAction.LPE_UPDATE);
    }
  }

  paramType(): ParamType {
    return ParamType.SATELLITE_ARRAY;
  }

  get visible(): boolean {
    return this.#visible;
  }
}
