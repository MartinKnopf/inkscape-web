// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpeobject-reference.cpp, src/live_effects/lpeobject-reference.h
/*
 * The reference corresponding to the inkscape:live-effect attribute
 *
 * Copyright (C) 2007 Johan Engelen
 */
import { SP_OBJECT_MODIFIED_FLAG, type SPObject } from '../object/sp-object.ts';
import { BadURIException, URIReference } from '../object/uri-references.ts';
import type { Node } from '../xml/node.ts';
import { LivePathEffectObject } from './lpeobject.ts';

/** A reference from an item to a LivePathEffectObject (one entry of inkscape:path-effect). */
export class LPEObjectReference extends URIReference {
  owner: SPObject | null;
  lpeobject_href: string | null = null;
  lpeobject_repr: Node | null = null;
  lpeobject: LivePathEffectObject | null = null;
  #release_connection: (() => void) | null = null;
  readonly #changed_connection: () => void;
  readonly #owner_release_connection: () => void;

  constructor(i_owner: SPObject) {
    super(i_owner);
    this.owner = i_owner;
    // listening to myself, this should be virtual instead
    this.#changed_connection = this.changedSignal.connect(() => this.#href_changed());
    this.#owner_release_connection = i_owner.releaseSignal.connect(() => this.#release_owner());
  }

  /** Disconnect and unlink (upstream destructor). */
  destroy(): void {
    this.#owner_release_connection(); // to do before unlinking
    this.#changed_connection(); // to do before unlinking
    this.unlink();
  }

  protected override _acceptObject(obj: SPObject): boolean {
    return obj instanceof LivePathEffectObject && super._acceptObject(obj);
  }

  link(to: string | null): void {
    if (!to) {
      this.unlink();
    } else if (this.lpeobject_href !== to) {
      this.lpeobject_href = to;
      try {
        this.attach(to);
      } catch (e) {
        if (!(e instanceof BadURIException)) throw e;
        /* TODO: Proper error handling as per
         * http://www.w3.org/TR/SVG11/implnote.html#ErrorProcessing.
         */
        console.warn(e.message);
        this.detach();
      }
    }
  }

  unlink(): void {
    this.#release_connection?.();
    this.#release_connection = null;
    this.lpeobject_repr = null;
    this.lpeobject = null;
    this.lpeobject_href = null;
    this.detach();
  }

  start_listening(to: LivePathEffectObject | null): void {
    if (!to) return;
    this.lpeobject = to;
    this.lpeobject_repr = to.getRepr();
    this.#release_connection?.();
    this.#release_connection = to.releaseSignal.connect(() => this.unlink());
  }

  #href_changed(): void {
    const refobj = this.getObject();
    if (refobj instanceof LivePathEffectObject) this.start_listening(refobj);
    this.owner?.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
  }

  #release_owner(): void {
    this.unlink();
    this.owner = null;
  }
}
