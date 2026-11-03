// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/parameter/satellite.cpp, src/live_effects/parameter/satellite.h, src/live_effects/parameter/satellite-reference.cpp, src/live_effects/parameter/satellite-reference.h, src/live_effects/parameter/originalsatellite.cpp, src/live_effects/parameter/originalsatellite.h
/*
 * Author(s):
 *   Jabiertxo Arraiza Cenoz <jabier.arraiza@marker.es>
 *
 * Copyright (C) 2018 Authors
 */
import { C_ } from '../../i18n.ts';
import { SPItem } from '../../object/sp-item.ts';
import { SPGroup } from '../../object/sp-item-group.ts';
import {
  SP_OBJECT_CHILD_MODIFIED_FLAG,
  SP_OBJECT_MODIFIED_FLAG,
  SP_OBJECT_STYLE_MODIFIED_FLAG,
  SP_OBJECT_VIEWPORT_MODIFIED_FLAG,
  type SPObject,
} from '../../object/sp-object.ts';
import { SPShape } from '../../object/sp-shape.ts';
import { SPText } from '../../object/sp-text.ts';
import { SPUse } from '../../object/sp-use.ts';
import { BadURIException, URIReference } from '../../object/uri-references.ts';
import { type Effect, LPEAction } from '../effect.ts';
import { EffectType, ParamType } from '../effect-enum.ts';
import { LivePathEffectObject } from '../lpeobject.ts';
import { type LinkParam, Parameter, type ParamWidget } from './parameter.ts';

/** A reference from an effect to a shape, text, group or clone (upstream SatelliteReference). */
export class SatelliteReference extends URIReference {
  protected override _acceptObject(obj: SPObject): boolean {
    if (obj instanceof SPShape || obj instanceof SPText || obj instanceof SPGroup || obj instanceof SPUse) {
      /* Refuse references to lpeobject */
      const owner = this.getOwner();
      if (obj === owner) return false;
      if (!(owner instanceof LivePathEffectObject)) return false;
      return super._acceptObject(obj);
    }
    return false;
  }
}

/** A link from the effect to another item, written as "#id" (upstream SatelliteParam). */
export class SatelliteParam extends Parameter implements LinkParam {
  readonly lperef: SatelliteReference;
  /** Set when the link button looks for a clone on the clipboard (upstream lookup). */
  lookup = false;
  #connections: (() => void)[] = [];

  constructor(label: string, tip: string, key: string, effect: Effect) {
    super(label, tip, key, effect);
    this.lperef = new SatelliteReference(effect.getLPEObj());
  }

  override param_get_satellites(): SPObject[] {
    // we reload connexions in case are lost for example item recreation on ungroup
    if (this.#connections.length === 0) this.write_to_SVG();
    const linked_obj = this.lperef.getObject();
    return linked_obj ? [linked_obj] : [];
  }

  param_readSVGValue(strvalue: string): boolean {
    const current = this.lperef.getObject();
    if (strvalue.startsWith('#') && current && strvalue.slice(1) === current.getId()) return false;
    // TODO: relink to the successor of the item after ungroup (upstream _tmpsuccessor).
    const lpeitems = this.param_effect.getCurrrentLPEItems();
    const old_ref = this.lperef.getObject();
    if (old_ref) this.unlink();
    if (strvalue.startsWith('#')) {
      try {
        this.lperef.attach(strvalue);
        // lp:1299948
        const new_ref = this.lperef.getObject();
        if (new_ref) this.linked_changed(old_ref, new_ref);
        // else: document still processing new events. Repr of the linked object not created yet.
      } catch (e) {
        if (!(e instanceof BadURIException)) throw e;
        console.warn(e.message);
        this.lperef.detach();
      }
    } else if (
      lpeitems.length === 0 &&
      !this.param_effect.is_applied &&
      !this.param_effect.getSPDoc()?.isSeeking()
    ) {
      this.param_write_to_repr('');
    }
    return true;
  }

  linksToItem(): boolean {
    return this.lperef.isAttached();
  }

  getObject(): SPObject | null {
    return this.lperef.isAttached() ? this.lperef.getObject() : null;
  }

  linkedObject(): SPObject | null {
    return this.lperef.getObject();
  }

  param_getSVGValue(): string {
    return this.lperef.getURI() ?? '';
  }
  param_getDefaultSVGValue(): string {
    return '';
  }
  param_set_default(): void {
    this.param_readSVGValue('');
  }
  param_update_default(_default_value: string): void {}

  unlink(): void {
    this.quit_listening();
    if (this.linksToItem()) this.lperef.detach();
  }

  /** Link to the item with id itemid (upstream link). */
  link(itemid: string): void {
    if (!itemid) return;
    const object = this.param_effect.getSPDoc()?.getObjectById(itemid);
    if (object && object !== this.getObject()) this.param_write_to_repr(`#${itemid}`);
    else this.param_write_to_repr('');
    this.param_effect.makeUndoDone(C_('Undo', 'Link item parameter to path'));
  }

  /** Link to the copied item itemid (upstream on_link_button_click; the dialog reads the clipboard). */
  on_link_button_click(itemid: string): void {
    // here prevent item is reseted transform on link
    if (this.effectType() === EffectType.CLONE_ORIGINAL) this.param_effect.is_load = false;
    if (!itemid) return;
    this.link(itemid);
  }

  // SIGNALS

  start_listening(to: SPObject | null): void {
    if (!to) return;
    this.quit_listening();
    this.#connections.push(this.lperef.changedSignal.connect((o, n) => this.linked_changed(o, n)));
    if (to instanceof SPItem) {
      this.#connections.push(
        to.releaseSignal.connect(() => this.linked_released()),
        to.modifiedSignal.connect((obj, flags) => this.linked_modified(obj, flags)),
        to.transformedSignal.connect(() => this.linked_transformed()),
      );
      if (!this.param_effect.is_load) this.linked_modified(to, SP_OBJECT_MODIFIED_FLAG);
    }
  }

  quit_listening(): void {
    for (const c of this.#connections) c();
    this.#connections = [];
  }

  isConnected(): boolean {
    return this.#connections.length > 0;
  }

  linked_changed(_old_obj: SPObject | null, new_obj: SPObject | null): void {
    this.quit_listening();
    if (new_obj) this.start_listening(new_obj);
  }

  linked_released(): void {
    if (this.param_effect.getLPEObj()) {
      this.unlink();
      this.param_effect.processObjects(LPEAction.LPE_UPDATE);
    }
  }

  linked_modified(_linked_obj: SPObject, flags: number): void {
    if (
      !this._updating &&
      flags &
        (SP_OBJECT_MODIFIED_FLAG |
          SP_OBJECT_STYLE_MODIFIED_FLAG |
          SP_OBJECT_CHILD_MODIFIED_FLAG |
          SP_OBJECT_VIEWPORT_MODIFIED_FLAG)
    ) {
      if (!this.param_effect.is_load || this.param_effect.isReady()) {
        this.param_effect.getLPEObj().requestModified(SP_OBJECT_MODIFIED_FLAG);
      }
      if (this.effectType() !== EffectType.CLONE_ORIGINAL) this.update_satellites();
    }
  }

  linked_transformed(): void {
    if (!this._updating) this.update_satellites();
  }

  param_newWidget(): ParamWidget | null {
    return { kind: 'satellite', select_original: false };
  }

  paramType(): ParamType {
    return ParamType.SATELLITE;
  }
}

/** The link of Clone original: the widget can also select the original (upstream OriginalSatelliteParam). */
export class OriginalSatelliteParam extends SatelliteParam {
  override param_newWidget(): ParamWidget | null {
    return { kind: 'satellite', select_original: true };
  }
  override paramType(): ParamType {
    return ParamType.ORIGINAL_SATELLITE;
  }
}
