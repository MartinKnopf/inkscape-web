// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/persp3d-reference.cpp, src/object/persp3d-reference.h
/*
 * The reference corresponding to the inkscape:perspectiveID attribute
 *
 * Copyright (C) 2007 Johan Engelen
 * Copyright (C) 2007 Maximilian Albert
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { Persp3D } from './persp3d.ts';
import { SP_OBJECT_MODIFIED_FLAG, type SPObject } from './sp-object.ts';
import { URIReference } from './uri-references.ts';

/**
 * The reference of a 3D box to its perspective (upstream Persp3DReference): it follows the
 * perspective, deletes the box when the perspective is deleted and updates the box when the
 * perspective changes.
 */
export class Persp3DReference extends URIReference {
  readonly owner: SPObject;
  #quit: (() => void) | null = null;

  constructor(owner: SPObject) {
    super(owner);
    this.owner = owner;
    this.changedSignal.connect(() => {
      this.#quit_listening();
      const refobj = this.getObject();
      if (refobj) this.#start_listening(refobj);
      this.owner.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
    });
  }

  override getObject(): Persp3D | null {
    return super.getObject() as Persp3D | null;
  }

  protected override _acceptObject(obj: SPObject): boolean {
    return obj instanceof Persp3D && super._acceptObject(obj);
  }

  #start_listening(to: Persp3D): void {
    const offs = [
      to.deleteSignal.connect(() => this.owner.deleteObject()),
      to.modifiedSignal.connect(() => this.owner.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG)),
    ];
    this.#quit = () => {
      for (const f of offs) f();
    };
  }

  #quit_listening(): void {
    this.#quit?.();
    this.#quit = null;
  }
}
