// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/selection.cpp, src/selection.h
/*
 * Per-desktop selection container
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   MenTaLguY <mental@rydia.net>
 *   bulia byak <buliabyak@users.sf.net>
 *   Andrius R. <knutux@gmail.com>
 *   Abhishek Sharma
 *   Adrian Boguszewski
 *
 * Copyright (C) 2016 Adrian Boguszewski
 * Copyright (C) 2006 Andrius R.
 * Copyright (C) 2004-2005 MenTaLguY
 * Copyright (C) 1999-2002 Lauris Kaplinski
 * Copyright (C) 2001-2002 Ximian, Inc.
 */
import { DocumentUndo } from './document-undo.ts';
import { C_ } from './i18n.ts';
import { ObjectSet } from './object/object-set.ts';
import type { SPObject } from './object/sp-object.ts';
import { SnapCandidatePoint } from './snap-candidate.ts';
import { SnapSourceType, SnapTargetType } from './snap-enums.ts';
import type { SnapPreferences } from './snap-preferences.ts';
import { Signal } from './util/signal.ts';

/**
 * The selection of a desktop (upstream Inkscape::Selection): an ObjectSet
 * with signals. `changed` is emitted when the set changes; `modified` is
 * emitted once after the selected objects were modified (collected flags).
 * TODO: anchors (setAnchor, scaleAnchored),
 * the page manager, getState/setState, selectionDistinctLayerAndParentCounts.
 */
export class Selection extends ObjectSet {
  readonly #changedSignal = new Signal<[Selection]>();
  readonly #modifiedSignal = new Signal<[Selection, number]>();
  #modifiedConnections = new Map<SPObject, () => void>();
  #selectionContext: SPObject | null = null;
  #contextReleaseConnection: (() => void) | null = null;
  #flags = 0;
  #idle = false;
  #changeLayer = true;

  /** The current layer, or the layer kept by set(object, true). */
  activeContext(): SPObject | null {
    return this.#selectionContext ?? this._desktop?.layerManager().currentLayer() ?? null;
  }

  connectChanged(slot: (selection: Selection) => void): () => void {
    return this.#changedSignal.connect(slot);
  }

  connectModified(slot: (selection: Selection, flags: number) => void): () => void {
    return this.#modifiedSignal.connect(slot);
  }

  emitModified(): void {
    this.#emitModified(this.#flags);
  }

  /**
   * The snap points of the selected items (desktop coordinates). The
   * rotation center counts once per item, as a source only.
   */
  getSnapPoints(snapprefs: SnapPreferences | null): SnapCandidatePoint[] {
    const p: SnapCandidatePoint[] = [];
    if (!snapprefs) return p;
    const snapprefs_dummy = snapprefs.clone(); // create a local copy of the snapping prefs
    snapprefs_dummy.setTargetSnappable(SnapTargetType.SNAPTARGET_ROTATION_CENTER, false); // locally disable snapping to the item center
    for (const this_item of this.items()) {
      this_item.getSnappoints(p, snapprefs_dummy);
      //Include the transformation origin for snapping
      //For a selection or group only the overall center is considered, not for each item individually
      if (snapprefs.isTargetSnappable(SnapTargetType.SNAPTARGET_ROTATION_CENTER)) {
        p.push(new SnapCandidatePoint(this_item.getCenter(), SnapSourceType.SNAPSOURCE_ROTATION_CENTER));
      }
    }
    return p;
  }

  /**
   * Rotate by angle_degrees around the rotation center, with an undo step
   * that merges with the previous rotation in the same direction. With
   * zoom ≠ 1, the angle is the distance in screen pixels that the farthest
   * corner moves.
   * TODO: the anchor (setAnchor) and the previous rotation anchor.
   */
  rotateAnchored(angle_degrees: number, zoom = 1): void {
    const bbox = this.visualBounds();
    const document = this.document();
    if (!bbox || !document) return;
    const center = this.center() ?? bbox.midpoint();

    if (zoom !== 1.0) {
      const m = bbox.midpoint();
      let i = 0;
      if (center.x < m.x) i = 1;
      if (center.y < m.y) i = 3 - i;
      const r = bbox.corner(i).sub(center).length();
      angle_degrees = (180 * Math.atan2(angle_degrees / zoom, r)) / Math.PI;
    }

    this.rotateRelative(center, angle_degrees);

    // Visual angle might be different from actual angle,
    // when y axis points up.
    const visual_angle = angle_degrees * document.yaxisdir();

    if (visual_angle === 90.0) {
      DocumentUndo.maybeDone(
        document,
        'selector:rotate:cw',
        C_('Undo', 'Rotate 90° CW'),
        'object-rotate-right',
      );
    } else if (visual_angle === -90.0) {
      DocumentUndo.maybeDone(
        document,
        'selector:rotate:ccw',
        C_('Undo', 'Rotate 90° CCW'),
        'object-rotate-left',
      );
    } else {
      DocumentUndo.maybeDone(
        document,
        visual_angle > 0 ? 'selector:rotate:ccw' : 'selector:rotate:cw',
        C_('Undo', 'Rotate'),
        'tool-pointer',
      );
    }
  }

  /** Whether selecting a single item makes its layer the current layer (default true). */
  getChangeLayer(): boolean {
    return this.#changeLayer;
  }
  setChangeLayer(option: boolean): void {
    this.#changeLayer = option;
  }

  protected override _connectSignals(object: SPObject): void {
    this.#modifiedConnections.set(
      object,
      object.modifiedSignal.connect((_obj, flags) => this.#scheduleModified(flags)),
    );
  }

  protected override _releaseSignals(object: SPObject): void {
    this.#modifiedConnections.get(object)?.();
    this.#modifiedConnections.delete(object);
  }

  protected override _emitChanged(persist_selection_context = false): void {
    super._emitChanged();
    const layers = this._desktop?.layerManager();
    if (persist_selection_context) {
      if (!this.#selectionContext && layers) {
        const context = layers.currentLayer();
        this.#selectionContext = context;
        this.#contextReleaseConnection =
          context?.releaseSignal.connect((obj) => this.#releaseContext(obj)) ?? null;
      }
    } else {
      this.#releaseContext(this.#selectionContext);
    }

    // Change the layer selection to the item selection. Only change if there's a single object.
    if (this._document && layers) {
      const item = this.singleItem();
      if (item && this.#changeLayer) {
        const layer = layers.layerForObject(item);
        if (layer && layer !== this.#selectionContext) layers.setCurrentLayer(layer);
      }
      // TODO: select the best page (page manager).
      DocumentUndo.resetKey(this._document);
    }

    this.#changedSignal.emit(this);
  }

  /** Collect the flags and emit `modified` once, after the current update (upstream: idle handler). */
  #scheduleModified(flags: number): void {
    if (!this.#idle) {
      this.#idle = true;
      queueMicrotask(() => {
        // force new handler to be created if requested before we return
        this.#idle = false;
        const collected = this.#flags;
        this.#flags = 0;
        this.#emitModified(collected);
      });
    }
    this.#flags |= flags;
  }

  #emitModified(flags: number): void {
    this.#modifiedSignal.emit(this, flags);
    // TODO: select the best page for the moved items (page manager).
  }

  #releaseContext(obj: SPObject | null): void {
    if (!this.#selectionContext || this.#selectionContext !== obj) return;
    this.#contextReleaseConnection?.();
    this.#contextReleaseConnection = null;
    this.#selectionContext = null;
  }
}
