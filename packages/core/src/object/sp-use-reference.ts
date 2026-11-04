// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-use-reference.cpp, src/object/sp-use-reference.h
/*
 * The reference corresponding to href of <use> element.
 *
 * Copyright (C) 2004 Bulia Byak
 * Copyright (C) 2004 Monash University
 */
import type { PathVector } from '@inkscape-web/geom';
import { Preferences } from '../preferences.ts';
import { SPItem } from './sp-item.ts';
import { SP_OBJECT_MODIFIED_FLAG, type SPObject } from './sp-object.ts';
import { SPShape } from './sp-shape.ts';
import { URIReference } from './uri-references.ts';

/**
 * The reference of a clone to its original: accepts items only (upstream SPUseReference).
 */
export class SPUseReference extends URIReference {
  override getObject(): SPItem | null {
    return super.getObject() as SPItem | null;
  }

  protected override _acceptObject(obj: SPObject): boolean {
    if (!(obj instanceof SPItem)) return false;
    return super._acceptObject(obj);
  }
}

/** Clone orphans preference values (upstream SP_CLONE_ORPHANS_*). */
const SP_CLONE_ORPHANS_UNLINK = 0;
const SP_CLONE_ORPHANS_DELETE = 1;

/**
 * The reference of a textPath (or a linked offset) to its path, with the
 * path data of the source (upstream SPUsePath). sourceDirty is set when the
 * source changes; the owner calls refresh_source() in its update.
 */
export class SPUsePath extends SPUseReference {
  readonly owner: SPObject;
  sourceDirty = false;
  sourceHref: string | null = null;
  sourceObject: SPItem | null = null;
  originalPath: PathVector | null = null;
  /** Called when the source is deleted and the reference is unlinked. */
  user_unlink: ((owner: SPObject) => void) | null = null;
  #connections: (() => void)[] = [];

  constructor(owner: SPObject) {
    super(owner);
    this.owner = owner;
    // listening to myself, this should be virtual instead
    this.changedSignal.connect(() => {
      this.quit_listening();
      const refobj = this.getObject();
      if (refobj) this.start_listening(refobj);
      this.sourceDirty = true;
      this.owner.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
    });
  }

  link(to: string | null): void {
    if (to === null) {
      this.quit_listening();
      this.unlink();
    } else if (!this.sourceHref || to !== this.sourceHref) {
      this.sourceHref = to;
      if (!this.try_attach(to)) this.detach();
    }
  }

  unlink(): void {
    this.sourceHref = null;
    this.detach();
  }

  start_listening(to: SPItem | null): void {
    if (!to) return;
    this.sourceObject = to;
    const dirty = () => {
      this.sourceDirty = true;
      this.owner.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
    };
    this.#connections = [
      to.deleteSignal.connect(() => {
        const mode = Preferences.get().getInt('/options/cloneorphans/value', SP_CLONE_ORPHANS_UNLINK);
        if (mode === SP_CLONE_ORPHANS_UNLINK) {
          // leave it be. just forget about the source
          this.quit_listening();
          this.unlink();
          this.user_unlink?.(this.owner);
        } else if (mode === SP_CLONE_ORPHANS_DELETE) {
          this.owner.deleteObject();
        }
      }),
      to.transformedSignal.connect(dirty),
      to.modifiedSignal.connect(dirty),
    ];
  }

  quit_listening(): void {
    if (!this.sourceObject) return;
    for (const disconnect of this.#connections) disconnect();
    this.#connections = [];
    this.sourceObject = null;
  }

  /** Read the path of the source: the curve of a shape or the outlines of a text. */
  refresh_source(): void {
    this.sourceDirty = false;
    this.originalPath = null;
    const refobj = this.sourceObject;
    if (!refobj) return;
    if (refobj instanceof SPShape) {
      const curve = refobj.curve();
      if (curve) this.originalPath = curve;
      else this.sourceDirty = true;
    } else if ('getNormalizedBpath' in refobj && typeof refobj.getNormalizedBpath === 'function') {
      this.originalPath = refobj.getNormalizedBpath() as PathVector;
    }
  }
}
