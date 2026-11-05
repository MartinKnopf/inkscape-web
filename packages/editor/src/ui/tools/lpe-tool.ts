// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tools/lpe-tool.cpp, src/ui/tools/lpe-tool.h
/*
 * LPEToolContext: a context for a generic tool composed of subtools that are given by LPEs
 *
 * Authors:
 *   Maximilian Albert <maximilian.albert@gmail.com>
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   Abhishek Sharma
 *
 * Copyright (C) 1998 The Free Software Foundation
 * Copyright (C) 1999-2005 authors
 * Copyright (C) 2001-2002 Ximian, Inc.
 * Copyright (C) 2008 Maximilian Albert
 */
import {
  _,
  convertUnit,
  Effect,
  EffectType,
  LPETypeConverter,
  Preferences,
  type Selection,
  type SPDocument,
  SPLPEItem,
  SPPath,
} from '@inkscape-web/core';
import { type PathVector, Point, Rect } from '@inkscape-web/geom';
import { show_output } from '../../actions/actions-helper.ts';
import type { SPDesktop } from '../../desktop.ts';
import { CanvasItemRect } from '../../display/control/canvas-item-rect.ts';
import { CanvasItemText } from '../../display/control/canvas-item-text.ts';
import { ShapeEditor } from '../shape-editor.ts';
import { PenMode, PenTool } from './pen-tool.ts';

/** A subtool of the LPE tool: the construction (path effect) and its icon. */
export interface SubtoolEntry {
  type: EffectType;
  icon_name: string;
}

/** This is the list of subtools from which the toolbar of the LPETool is built automatically. */
export const lpesubtools: readonly SubtoolEntry[] = [
  // this must be here to account for the "all inactive" action
  { type: EffectType.INVALID_LPE, icon_name: 'draw-geometry-inactive' },
  { type: EffectType.LINE_SEGMENT, icon_name: 'draw-geometry-line-segment' },
  { type: EffectType.CIRCLE_3PTS, icon_name: 'draw-geometry-circle-from-three-points' },
  { type: EffectType.CIRCLE_WITH_RADIUS, icon_name: 'draw-geometry-circle-from-radius' },
  { type: EffectType.PARALLEL, icon_name: 'draw-geometry-line-parallel' },
  { type: EffectType.PERP_BISECTOR, icon_name: 'draw-geometry-line-perpendicular' },
  { type: EffectType.ANGLE_BISECTOR, icon_name: 'draw-geometry-angle-bisector' },
  { type: EffectType.MIRROR_SYMMETRY, icon_name: 'draw-geometry-mirror' },
];

export const num_subtools = lpesubtools.length;

/**
 * Whether the construction of a subtool can be used: its path effect is ported (in the
 * registry of LPETypeData). The inactive subtool is always available.
 */
export function lpetool_type_is_available(type: EffectType): boolean {
  return type === EffectType.INVALID_LPE || LPETypeConverter.is_valid_id(type);
}

/**
 * The LPE tool (upstream LpeTool): a pen tool whose path gets a geometric construction (a
 * path effect) of the subtool chosen in the toolbar (/tools/lpetool/mode, an index of
 * lpesubtools). Constructions that take a fixed number of clicks finish the path after them.
 * It shows the limiting bounding box (used to cut infinite lines) and the length of the
 * selected paths.
 * TODO: item_handler (a click on an item only selects it), cursor.
 */
export class LpeTool extends PenTool {
  /** The active construction (upstream LpeTool::mode; PenTool has a mode field of its own). */
  lpe_mode = EffectType.INVALID_LPE;

  readonly #shape_editor: ShapeEditor;
  #canvas_bbox: CanvasItemRect | null = null;
  readonly #measuring_items = new Map<SPPath, CanvasItemText>();
  readonly #sel_changed_connection: () => void;
  readonly #sel_modified_connection: () => void;

  constructor(desktop: SPDesktop) {
    super(desktop, '/tools/lpetool');
    const selection = desktop.getSelection();
    const item = selection.singleItem();

    this.#sel_changed_connection = selection.connectChanged((s) => this.#selection_changed(s));
    // (upstream: LPEToolbar::sel_modified)
    this.#sel_modified_connection = selection.connectModified(() => this.update_measuring_items());

    this.#shape_editor = new ShapeEditor(desktop);

    this.switch_mode(EffectType.INVALID_LPE);
    this.reset_limiting_bbox();
    this.create_measuring_items();

    // TODO temp force:
    this.enableSelectionCue();

    if (item) this.#shape_editor.set_item(item);
  }

  override destroy(): void {
    this.#sel_changed_connection();
    this.#sel_modified_connection();
    this.#shape_editor.unset_item();
    this.#canvas_bbox?.unlink();
    this.#canvas_bbox = null;
    this.delete_measuring_items();
    super.destroy();
  }

  /**
   * Callback that processes the "changed" signal on the selection;
   * destroys old and creates new nodepath and reassigns listeners to the new selected item's repr.
   */
  #selection_changed(selection: Selection): void {
    this.#shape_editor.unset_item();
    const item = selection.singleItem();
    if (item) this.#shape_editor.set_item(item);
    // The measuring info of the selection (upstream: LPEToolbar::sel_changed).
    this.delete_measuring_items();
    this.create_measuring_items(selection);
  }

  override set(name: string): void {
    // Called from the PenTool constructor too: only PenTool fields are set here.
    if (name === 'mode') {
      Preferences.get().setString('/tools/geometric/mode', 'drag');
      this.mode = PenMode.MODE_DRAG;
    }
  }

  override root_handler(event: Event): boolean {
    if (this.hasWaitingLPE()) {
      // quit when we are waiting for a LPE to be applied
      return super.root_handler(event);
    }

    let ret = false;
    if (event.type === 'pointerdown') {
      const e = event as PointerEvent;
      if (e.button === 0 && this._numPress(e) === 1) {
        const type = lpesubtools[Preferences.get().getInt('/tools/lpetool/mode', 0)]?.type;
        if (
          this.lpe_mode === EffectType.INVALID_LPE ||
          type === undefined ||
          !lpetool_type_is_available(type)
        ) {
          // don't do anything for now if we are inactive (except clearing the selection
          // since this was a click into empty space)
          this._desktop.getSelection().clear();
          show_output(_('Choose a construction tool from the toolbar.'), false);
          ret = true;
        } else {
          this.saveDragOrigin(this._windowPoint(e));
          this.waitForLPEMouseClicks(type, Effect.acceptsNumClicks(type));
        }
      }
    }

    return ret || super.root_handler(event);
  }

  /** A geometric LPE was applied: switch back to "inactive" mode. */
  override waiting_LPE_applied(): void {
    super.waiting_LPE_applied();
    this.switch_mode(EffectType.INVALID_LPE);
  }

  /** Set the construction (and the toolbar mode, /tools/lpetool/mode). */
  switch_mode(type: EffectType): void {
    const index = lpetool_mode_to_index(type);
    if (index === -1) {
      console.warn(`Invalid mode selected: ${type}`);
      return;
    }
    this.lpe_mode = type;
    Preferences.get().setInt('/tools/lpetool/mode', index);
  }

  /**
   * Reads the limiting bounding box from preferences and draws it on the screen
   * TODO: Note that currently the bbox is not user-settable; we simply use the page borders
   */
  reset_limiting_bbox(): void {
    this.#canvas_bbox?.unlink();
    this.#canvas_bbox = null;

    if (!Preferences.get().getBool('/tools/lpetool/show_bbox', true)) return;

    const [A, B] = lpetool_get_limiting_bbox_corners(this._desktop.getDocument());
    const doc2dt = this._desktop.doc2dt();
    this.#canvas_bbox = new CanvasItemRect(
      this._desktop.getCanvasControls(),
      new Rect(A.transformed(doc2dt), B.transformed(doc2dt)),
    );
    this.#canvas_bbox.set_stroke(0x0000ffff);
    this.#canvas_bbox.set_dashed(true);
  }

  /** Whether the limiting bounding box is shown (for tests and the toolbar). */
  has_limiting_bbox(): boolean {
    return this.#canvas_bbox !== null;
  }

  create_measuring_items(selection: Selection = this._desktop.getSelection()): void {
    const show = Preferences.get().getBool('/tools/lpetool/show_measuring_info', true);
    const tmpgrp = this._desktop.getCanvasTemp();
    for (const item of selection.items()) {
      if (!(item instanceof SPPath)) continue;
      const canvas_text = new CanvasItemText(tmpgrp, new Point(0, 0), '');
      this.#set_text_and_pos(canvas_text, item);
      if (!show) canvas_text.set_visible(false);
      this.#measuring_items.set(item, canvas_text);
    }
  }

  delete_measuring_items(): void {
    for (const text of this.#measuring_items.values()) text.unlink();
    this.#measuring_items.clear();
  }

  update_measuring_items(): void {
    for (const [path, text] of this.#measuring_items) this.#set_text_and_pos(text, path);
  }

  show_measuring_info(show = true): void {
    for (const text of this.#measuring_items.values()) text.set_visible(show);
  }

  /** The length of path in the unit of /tools/lpetool/unit, placed beside the middle of the path. */
  #set_text_and_pos(canvas_text: CanvasItemText, path: SPPath): void {
    const unit = Preferences.get().getString('/tools/lpetool/unit') || 'px';
    const curve = path.curve() ?? [];
    const { length, pos, dir } = arc_length_middle(curve);
    const lengthval = convertUnit(length, 'px', unit);
    canvas_text.set_text(`${lengthval.toFixed(2)} ${unit}`);

    // Upstream set_pos_and_anchor() at t = 0.5, 10 px from the path.
    const n = new Point(dir.y, -dir.x); // -rot90(dir)
    const angle = Math.atan2(-dir.y, dir.x); // angle_between(dir, (1, 0))
    canvas_text.set_coord(pos.add(n.mul(10)).transformed(path.i2dtAffine()));
    canvas_text.set_anchor(new Point(Math.sin(angle), -Math.cos(angle)));
  }
}

/**
 * The arc length of the paths, and the point and unit tangent at half of it (upstream:
 * arc_length_parametrization of the piecewise curve). The curves are sampled.
 */
function arc_length_middle(pathv: PathVector): { length: number; pos: Point; dir: Point } {
  const pts: Point[] = [];
  for (const path of pathv) {
    pts.push(path.initialPoint());
    for (const c of path.curves()) {
      const n = c.isLineSegment() ? 1 : 32;
      for (let i = 1; i <= n; i++) pts.push(c.pointAt(i / n));
    }
  }
  const seg = (i: number) => (pts[i + 1] as Point).sub(pts[i] as Point);
  let length = 0;
  for (let i = 0; i + 1 < pts.length; i++) length += seg(i).length();
  let rest = length / 2;
  for (let i = 0; i + 1 < pts.length; i++) {
    const d = seg(i);
    const l = d.length();
    if (l > 0 && rest <= l) {
      return { length, pos: (pts[i] as Point).add(d.mul(rest / l)), dir: d.div(l) };
    }
    rest -= l;
  }
  return { length, pos: pts[0] ?? new Point(0, 0), dir: new Point(1, 0) };
}

/**
 * Finds the index in the list of geometric subtools corresponding to the given LPE type.
 * Returns -1 if no subtool is found.
 */
export function lpetool_mode_to_index(type: EffectType): number {
  return lpesubtools.findIndex((entry) => entry.type === type);
}

/**
 * Checks whether an item has a construction applied as LPE and if so returns the index in
 * lpesubtools of this construction
 */
export function lpetool_item_has_construction(item: unknown): number {
  if (!(item instanceof SPLPEItem)) return -1;
  const lpe = item.getCurrentLPE();
  if (!lpe) return -1;
  return lpetool_mode_to_index(lpe.effectType());
}

/**
 * Attempts to perform the construction of the given type (i.e., to apply the corresponding LPE) to
 * a single selected item. Returns whether we succeeded.
 */
export function lpetool_try_construction(desktop: SPDesktop, type: EffectType): boolean {
  const item = desktop.getSelection().singleItem();
  // TODO: should we check whether type represents a valid geometric construction?
  if (item instanceof SPLPEItem && Effect.acceptsNumClicks(type) === 0) {
    Effect.createAndApply(type, desktop.getDocument(), item);
    return true;
  }
  return false;
}

/** The corners of the limiting bounding box (document coordinates): the page by default. */
export function lpetool_get_limiting_bbox_corners(document: SPDocument): [Point, Point] {
  const { x: w, y: h } = document.getDimensions();
  const prefs = Preferences.get();
  const ulx = prefs.getDouble('/tools/lpetool/bbox_upperleftx', 0);
  const uly = prefs.getDouble('/tools/lpetool/bbox_upperlefty', 0);
  const lrx = prefs.getDouble('/tools/lpetool/bbox_lowerrightx', w);
  const lry = prefs.getDouble('/tools/lpetool/bbox_lowerrighty', h);
  return [new Point(ulx, uly), new Point(lrx, lry)];
}
