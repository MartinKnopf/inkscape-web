// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tools/node-tool.cpp, src/ui/tools/node-tool.h
/**
 * New node tool - implementation.
 */
/* Authors:
 *   Krzysztof Kosiński <tweenk@gmail.com>
 *   Abhishek Sharma
 *
 * Copyright (C) 2009 Authors
 */
import { Preferences, type Selection, type SPItem, SPLPEItem } from '@inkscape-web/core';
import { Affine, type PathVector, type Rect } from '@inkscape-web/geom';
import type { SPDesktop } from '../../desktop.ts';
import { CanvasItemGroup } from '../../display/control/canvas-item.ts';
import { CanvasItemBpath } from '../../display/control/canvas-item-bpath.ts';
import { Rubberband, RubberbandOperation } from '../../rubberband.ts';
import { ShapeEditor } from '../shape-editor.ts';
import { ControlPoint } from '../tool/control-point.ts';
import { ControlPointSelection } from '../tool/control-point-selection.ts';
import { MultiPathManipulator, type PathSharedData } from '../tool/multi-path-manipulator.ts';
import { NodeDeleteMode } from '../tool/path-manipulator.ts';
import { type ShapeRecord, ShapeRole } from '../tool/shape-record.ts';
import { type ModifierState, mod_alt, mod_ctrl, mod_ctrl_only, mod_shift, ToolBase } from './tool-base.ts';

// Modifiers of the node tool (upstream Modifiers::Modifier defaults in src/ui/modifiers.cpp).
/** select-add-to: Shift */
const mod_select_add_to = (s: ModifierState) => mod_shift(s);
/** node-invert: Ctrl */
const mod_node_invert = (s: ModifierState) => mod_ctrl(s);
/** node-remove-from: Shift+Ctrl */
const mod_node_remove_from = (s: ModifierState) => mod_shift(s) && mod_ctrl(s);

/** A new group for control items above the other groups of the desktop controls. */
function create_control_group(desktop: SPDesktop, name: string): CanvasItemGroup {
  const parent = desktop.getCanvasControls().element;
  const g = parent.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'g') as SVGGElement;
  g.setAttribute('class', name);
  parent.append(g);
  return new CanvasItemGroup(g, desktop.getCanvas());
}

/**
 * The node tool (upstream NodeTool): edit the nodes and handles of the
 * selected paths.
 *
 * Architectural overview of the tool:
 * - Handle: shows a handle and keeps the node type constraint (smooth / symmetric) by updating
 *   the other handle's position when dragged. Its move() method cannot violate the constraints.
 * - Node: keeps node type constraints for auto nodes and smooth nodes at ends of linear segments.
 *   Its move() method cannot violate constraints. Keeps a reference to its NodeList.
 * - NodeList: exposes an iterator-based interface to nodes. It is possible to obtain an iterator
 *   to a node from the node. Keeps a reference to its SubpathList.
 * - SubpathList: list of NodeLists that represents an editable pathvector. Keeps a reference
 *   to its PathManipulator.
 * - PathManipulator: performs most of the single-path actions like reverse subpaths,
 *   delete segment, shift selection, etc. Keeps a reference to MultiPathManipulator.
 * - MultiPathManipulator: performs additional operations for actions that are not per-path,
 *   for example node joins and segment joins. Handles XML commit of actions that affect all paths
 *   or the node selection and removes PathManipulators that have no nodes left after e.g. node
 *   deletes.
 * - ControlPointSelection: keeps track of node selection and a set of nodes that can potentially
 *   be selected. Performs actions that require no knowledge about the path, only about the nodes,
 *   like dragging and transforms.
 * - SelectableControlPoint: base for any type of selectable point. It can belong to only one
 *   selection.
 *
 * The shape editors show the knots of the current path effect of the selected items, and the
 * effect's helper paths are drawn (sp_update_helperpath).
 *
 * TODO: shape editors for the knotholders of rect, ellipse, star, spiral under the node tool,
 * transform handles, clipping paths and masks, path flash, touch path
 * selection (Alt), status bar tips, cursors, gradient drag, snapping of segment drags.
 */
export class NodeTool extends ToolBase {
  readonly _path_data: PathSharedData;
  readonly _selected_nodes: ControlPointSelection;
  readonly _multipath: MultiPathManipulator;
  readonly #transform_handle_group: CanvasItemGroup;
  readonly #groups: CanvasItemGroup[];
  readonly #disconnects: (() => void)[] = [];
  /** The rubberband was started by this tool and the button is pressed. */
  #rubberbanding = false;
  /** The shape editors by item (upstream _shape_editors). */
  readonly _shape_editors = new Map<SPItem, ShapeEditor>();
  /** The helper paths of the path effects (upstream _helperpath_tmpitem). */
  _helperpath_tmpitem: CanvasItemBpath[] = [];

  show_handles = true;
  show_outline = false;
  live_outline = true;
  live_objects = true;
  show_path_direction = false;
  show_transform_handles = true;
  single_node_transform_handles = false;
  edit_clipping_paths = false;
  edit_masks = false;

  constructor(desktop: SPDesktop) {
    super(desktop, '/tools/nodes');

    // Prepare canvas groups for controls. This guarantees correct z-order, so that
    // for example a dragpoint won't obscure a node
    const outline_group = create_control_group(desktop, 'CanvasItemGroup:NodeTool');
    const handle_line_group = create_control_group(desktop, 'CanvasItemGroup:NodeTool:handle_line_group');
    const dragpoint_group = create_control_group(desktop, 'CanvasItemGroup:NodeTool');
    this.#transform_handle_group = create_control_group(desktop, 'CanvasItemGroup:NodeTool');
    const node_group = create_control_group(desktop, 'CanvasItemGroup:NodeTool');
    const handle_group = create_control_group(desktop, 'CanvasItemGroup:NodeTool');
    this.#groups = [
      outline_group,
      handle_line_group,
      dragpoint_group,
      this.#transform_handle_group,
      node_group,
      handle_group,
    ];

    this._selected_nodes = new ControlPointSelection(desktop);
    this._path_data = {
      node_data: { desktop, selection: this._selected_nodes, node_group, handle_group, handle_line_group },
      outline_group,
      dragpoint_group,
    };
    this._multipath = new MultiPathManipulator(this._path_data);

    const selection = desktop.getSelection();
    this.#disconnects.push(selection.connectChanged((sel) => this.selection_changed(sel)));

    // read prefs before adding items to selection to prevent momentarily showing the outline
    for (const name of [
      'show_handles',
      'show_outline',
      'live_outline',
      'live_objects',
      'show_path_direction',
      'show_transform_handles',
      'single_node_transform_handles',
      'edit_clipping_paths',
      'edit_masks',
    ]) {
      this.sp_event_context_read(name);
    }

    this.selection_changed(selection);

    if (Preferences.get().getBool('/tools/nodes/selcue')) this.enableSelectionCue();
    // TODO: gradient drag (/tools/nodes/gradientdrag).
  }

  override destroy(): void {
    for (const se of this._shape_editors.values()) se.unset_item();
    this._shape_editors.clear();
    for (const hp of this._helperpath_tmpitem) hp.unlink();
    this._helperpath_tmpitem = [];
    this._selected_nodes.clear();
    Rubberband.get(this._desktop).stop();
    for (const d of this.#disconnects) d();
    this._multipath.destroy();
    this._selected_nodes.destroy();
    for (const g of this.#groups) {
      g.destroy();
      g.element.remove();
    }
    super.destroy();
  }

  /** Delete the selected nodes with the default delete mode. */
  deleteSelected(): void {
    // This takes care of undo internally
    this._multipath.deleteNodes(
      Preferences.get().getInt('/tools/node/delete-mode-default', NodeDeleteMode.automatic),
    );
  }

  override set(name: string): void {
    const prefs = Preferences.get();
    const value = (def = false) => prefs.getBool(`${this.getPrefsPath()}/${name}`, def);
    switch (name) {
      case 'show_handles':
        this.show_handles = value(true);
        this._multipath?.showHandles(this.show_handles);
        break;
      case 'show_outline':
        this.show_outline = value();
        this._multipath?.showOutline(this.show_outline);
        break;
      case 'live_outline':
        this.live_outline = value();
        this._multipath?.setLiveOutline(this.live_outline);
        break;
      case 'live_objects':
        this.live_objects = value();
        this._multipath?.setLiveObjects(this.live_objects);
        break;
      case 'show_path_direction':
        this.show_path_direction = value();
        this._multipath?.showPathDirection(this.show_path_direction);
        break;
      case 'show_transform_handles':
        this.show_transform_handles = value(true);
        this._selected_nodes?.showTransformHandles(
          this.show_transform_handles,
          this.single_node_transform_handles,
        );
        break;
      case 'single_node_transform_handles':
        this.single_node_transform_handles = value();
        this._selected_nodes?.showTransformHandles(
          this.show_transform_handles,
          this.single_node_transform_handles,
        );
        break;
      case 'edit_clipping_paths':
        this.edit_clipping_paths = value();
        if (this._multipath) this.selection_changed(this._desktop.getSelection());
        break;
      case 'edit_masks':
        this.edit_masks = value();
        if (this._multipath) this.selection_changed(this._desktop.getSelection());
        break;
    }
  }

  /** Edit the paths of the selected items. TODO: clipping paths and masks (gather_items). */
  selection_changed(sel: Selection): void {
    const shapes: ShapeRecord[] = [];
    const items = sel.items();
    for (const item of items) {
      shapes.push({
        object: item,
        role: ShapeRole.SHAPE_ROLE_NORMAL,
        lpe_key: '',
        edit_transform: Affine.identity(),
      });
    }
    // use multiple ShapeEditors, one per shape. Shape editors of items that are no longer
    // selected are removed.
    for (const [item, se] of [...this._shape_editors]) {
      if (!items.includes(item)) {
        se.unset_item();
        this._shape_editors.delete(item);
      }
    }
    for (const item of items) {
      if (this._shape_editors.has(item)) continue;
      const si = new ShapeEditor(this._desktop);
      si.onItemChanged = () => sp_update_helperpath(this._desktop);
      si.set_item(item);
      this._shape_editors.set(item, si);
    }
    this._multipath.setItems(shapes);
    sp_update_helperpath(this._desktop);
  }

  /** Rebuild the shape editors (after the current path effect of an item changed). */
  update_shape_editors(): void {
    for (const se of this._shape_editors.values()) se.reset_item();
    sp_update_helperpath(this._desktop);
  }

  override root_handler(event: Event): boolean {
    /* things to handle here:
     * 1. selection of items
     * 2. passing events to manipulators
     * 3. some keybindings
     */
    const rubberband = Rubberband.get(this._desktop);

    // Escape cancels the drag of a control point.
    const grabbed = ControlPoint.grabbedPoint();
    if (grabbed && event.type === 'keydown' && grabbed._eventHandler(this, event)) {
      event.preventDefault();
      return true;
    }

    if (!rubberband.isStarted()) {
      if (this._multipath.event(this, event) || this._selected_nodes.event(this, event)) {
        if (event.type === 'keydown') event.preventDefault();
        return true;
      }
    }

    let ret = false;
    switch (event.type) {
      case 'pointermove': {
        const e = event as PointerEvent;
        if (this.#rubberbanding && e.buttons & 1) {
          if (rubberband.isStarted()) {
            rubberband.move(this._desktopPoint(this._windowPoint(e)));
            this.#updateSelectionColor(e);
          }
          ret = true;
        } else if (rubberband.isMoved()) {
          // Mouse button is up, but rubberband is still kicking.
          rubberband.stop();
        }
        // do not return true, because we need to pass this event to the parent context
        // otherwise some features cease to work
        break;
      }
      case 'keydown': {
        const e = event as KeyboardEvent;
        this.#updateSelectionColor(e);
        // Unconfigurable shortcuts
        switch (e.key) {
          case 'Escape': // deselect everything
            if (this._selected_nodes.empty()) this._desktop.getSelection().clear();
            else this._selected_nodes.clear();
            ret = true;
            break;
          case 'a':
          case 'A':
            if (mod_ctrl(e) && mod_alt(e)) {
              this._selected_nodes.selectAll();
              // Ctrl+A is handled in selection-chemistry.cpp via verb
              ret = true;
            }
            break;
          case 'h':
          case 'H':
            if (mod_ctrl_only(e)) {
              Preferences.get().setBool('/tools/nodes/show_handles', !this.show_handles);
              ret = true;
            }
            break;
          case 'Tab':
            this._multipath.shiftSelection(e.shiftKey ? -1 : 1);
            ret = true;
            break;
        }
        if (ret) e.preventDefault();
        break;
      }
      case 'keyup':
        this.#updateSelectionColor(event as KeyboardEvent);
        break;
      case 'pointerdown': {
        const e = event as PointerEvent;
        if (e.button !== 0) break;
        this.tolerance = Math.min(
          Math.max(Preferences.get().getInt('/options/dragtolerance/value', 4), 0),
          100,
        );
        rubberband.start(this._desktop, this._desktopPoint(this._windowPoint(e)), true);
        this.#rubberbanding = true;
        this.grabCanvasEvents(e);
        ret = true;
        break;
      }
      case 'pointerup': {
        const e = event as PointerEvent;
        if (e.button !== 0 || !this.#rubberbanding) break;
        this.#rubberbanding = false;
        const rect = rubberband.getRectangle();
        if (rubberband.isStarted() && rubberband.isMoved() && rect) this.select_area(rect, e);
        else this.select_point(e);
        rubberband.stop();
        this.ungrabCanvasEvents(e);
        ret = true;
        break;
      }
    }
    return ret || super.root_handler(event);
  }

  /** Select the nodes in the rubberband rectangle, or the items if no path is edited. TODO: touch path. */
  select_area(rect: Rect, event: ModifierState): void {
    if (this._multipath.empty()) {
      // if multipath is empty, select rubberbanded items rather than nodes
      const items = this._desktop
        .getDocument()
        .getItemsInBox(this._desktop.dkey, rect.transformed(this._desktop.dt2doc()));
      this._desktop.getSelection().setList(items);
      return;
    }
    const add_to = mod_select_add_to(event);
    const remove_from = mod_node_remove_from(event);
    const invert = mod_node_invert(event);
    if (remove_from) {
      // D. Shift+Ctrl pressed, removes nodes under box from existing selection.
      this._selected_nodes.selectArea(rect, true);
    } else {
      // A/C. No modifier, selects all nodes, or selects all other nodes.
      if (!add_to) this._selected_nodes.clear();
      // A/B/C. Adds nodes under box to existing selection.
      this._selected_nodes.selectArea(rect);
      // C. Selects the inverse of all nodes under the box.
      if (invert) this._selected_nodes.invertSelection();
    }
  }

  /** A click: select the item under the pointer, or clear the node or item selection. */
  select_point(event: PointerEvent): void {
    if (event.button !== 0) return;
    const selection = this._desktop.getSelection();
    // TODO: Alt (select-force-drag) selects under.
    const item_clicked = this._desktop.getItemAtPoint(this._windowPoint(event), true);
    if (!item_clicked) {
      // nothing under cursor
      // if no Shift, deselect
      // if there are nodes selected, the first click should deselect the nodes
      // and the second should deselect the items
      if (!mod_shift(event)) {
        if (this._selected_nodes.empty()) selection.clear();
        else this._selected_nodes.clear();
      }
    } else if (mod_shift(event)) {
      selection.toggle(item_clicked);
    } else if (!selection.includes(item_clicked)) {
      selection.set(item_clicked);
    }
  }

  #updateSelectionColor(event: ModifierState): void {
    const rubberband = Rubberband.get(this._desktop);
    if (mod_node_remove_from(event)) {
      // if Ctrl+Shift is pressed, change rubberband operation to remove
      rubberband.setOperation(RubberbandOperation.REMOVE);
    } else if (mod_node_invert(event)) {
      // Ctrl pressed, it's an invert option
      rubberband.setOperation(RubberbandOperation.INVERT);
    } else {
      // Nothing pressed, switch back to add
      rubberband.setOperation(RubberbandOperation.ADD);
    }
  }
}

/**
 * Draw the canvas indicators (helper paths) of the current path effect of the selected items
 * (upstream sp_update_helperpath).
 */
export function sp_update_helperpath(desktop: SPDesktop): void {
  const nt = desktop.getTool();
  if (!(nt instanceof NodeTool)) return;
  for (const hp of nt._helperpath_tmpitem) hp.unlink();
  nt._helperpath_tmpitem = [];
  for (const item of desktop.getSelection().items()) {
    if (!(item instanceof SPLPEItem) || !item.hasPathEffectRecursive()) continue;
    const lpe = item.getCurrentLPE();
    if (!lpe?.isVisible()) continue;
    const selectedNodesPositions = [...nt._selected_nodes.allPoints()]
      .filter((p) => p.selected())
      .map((p) => p.position());
    lpe.setSelectedNodePoints(selectedNodesPositions);
    lpe.setCurrentZoom(desktop.current_zoom());
    const c: PathVector = [];
    const dt2doc = desktop.getDocument().dt2doc();
    for (const p of lpe.getCanvasIndicators(item)) c.push(...p.map((path) => path.transformed(dt2doc)));
    if (c.length) {
      const helperpath = new CanvasItemBpath(desktop.getCanvasTemp(), c, true);
      helperpath.set_stroke(0x0000ff9a);
      helperpath.set_fill(0x0); // No fill
      nt._helperpath_tmpitem.push(helperpath);
    }
  }
}
