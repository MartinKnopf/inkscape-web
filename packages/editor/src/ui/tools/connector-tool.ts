// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tools/connector-tool.cpp, src/ui/tools/connector-tool.h
/*
 * Connector creation tool
 *
 * Authors:
 *   Michael Wybrow <mjwybrow@users.sourceforge.net>
 *   Abhishek Sharma
 *   Jon A. Cruz <jon@joncruz.org>
 *   Martin Owens <doctormo@gmail.com>
 *
 * Copyright (C) 2005-2008  Michael Wybrow
 * Copyright (C) 2009  Monash University
 * Copyright (C) 2012  Authors
 */
import {
  C_,
  DocumentUndo,
  getRouter,
  is_closed,
  new_avoid_id,
  Preferences,
  type Selection,
  SnapSourceType,
  SPConnEndPair,
  SPFlowtext,
  type SPItem,
  SPPath,
  SPText,
  sp_conn_end_detach,
  sp_conn_reroute_path_immediate,
  sp_svg_write_path,
} from '@inkscape-web/core';
import { L2, LineSegment, Path, type PathVector, Point, PathVector as PV } from '@inkscape-web/geom';
import { have_viable_layer } from '../../context-fns.ts';
import type { SPDesktop } from '../../desktop.ts';
import { CanvasItemBpath } from '../../display/control/canvas-item-bpath.ts';
import { CanvasItemCtrl, CanvasItemCtrlType, HandleSize } from '../../display/control/canvas-item-ctrl.ts';
import { mod_alt, mod_select_add_to, ToolBase } from './tool-base.ts';

export enum ConnectorState {
  SP_CONNECTOR_CONTEXT_IDLE,
  SP_CONNECTOR_CONTEXT_DRAGGING,
  SP_CONNECTOR_CONTEXT_CLOSE,
  SP_CONNECTOR_CONTEXT_STOP,
  SP_CONNECTOR_CONTEXT_REROUTING,
  SP_CONNECTOR_CONTEXT_NEWCONNPOINT,
}
const S = ConnectorState;

/**
 * A handle of the connector tool: a connection point of the active shape or an endpoint of the
 * active connector. Upstream uses SPKnots with their own event handler; these handles only
 * report hover, so a press reaches the tool (connection points) or starts a reroute (endpoints).
 */
class ConnHandle {
  readonly ctrl: CanvasItemCtrl;
  owner: SPItem | null = null;
  pos = new Point(0, 0);

  constructor(tool: ConnectorTool, size: HandleSize) {
    this.ctrl = new CanvasItemCtrl(
      tool._desktop.getCanvasControls(),
      CanvasItemCtrlType.CANVAS_ITEM_CTRL_TYPE_SHAPER,
    );
    this.ctrl.set_size(size);
    this.ctrl.set_visible(false);
    const el = this.ctrl.element;
    el.addEventListener('pointerenter', () => {
      this.ctrl.set_hover(true);
      tool.active_handle = this;
    });
    el.addEventListener('pointerleave', () => {
      this.ctrl.set_hover(false);
      if (tool.active_handle === this) tool.active_handle = null;
    });
  }

  setPosition(p: Point): void {
    this.pos = p;
    this.ctrl.set_position(p);
  }
  show(): void {
    this.ctrl.set_visible(true);
  }
  hide(): void {
    this.ctrl.set_visible(false);
    this.ctrl.set_hover(false);
  }
  destroy(): void {
    this.ctrl.unlink();
  }
}

/**
 * The connector tool (upstream ConnectorTool): drag (or click twice) between shapes to draw a
 * connector; the ends attach to the shape whose connection point (its center) is under the
 * pointer. The connector follows the attached shapes and routes around the shapes that
 * connectors avoid (orthogonal or polyline, with curvature). Drag an endpoint of the selected
 * connector to reroute it. Enter finishes, Escape cancels.
 * TODO: connection points inside symbols and clones (sub_ref), new connection points,
 * the status bar messages, cursors.
 */
export class ConnectorTool extends ToolBase {
  readonly selection: Selection;
  p: Point[] = [0, 1, 2, 3, 4].map(() => new Point(0, 0));
  /** \invar npoints in {0, 2}. */
  npoints = 0;
  state = S.SP_CONNECTOR_CONTEXT_IDLE;

  // Red curve
  readonly red_bpath: CanvasItemBpath;
  red_curve: PathVector = [];
  red_color = 0xff00007f;
  // Green curve
  green_curve: PathVector = [];
  // The new connector
  newconn: SPItem | null = null;
  #newConnRef: number | null = null;
  curvature = 0.0;
  isOrthogonal = false;

  // The active shape
  active_shape: SPItem | null = null;
  // Same as above, but for the active connector
  active_conn: SPPath | null = null;
  #disconnect_active_shape: (() => void) | null = null;
  #disconnect_active_conn: (() => void) | null = null;

  // The activehandle
  active_handle: ConnHandle | null = null;
  clickeditem: SPPath | null = null;
  clickedhandle: ConnHandle | null = null;
  /** The connection points of the active shape (its center). */
  knots: ConnHandle[] = [];
  endpt_handle: [ConnHandle | null, ConnHandle | null] = [null, null];
  shref: string | null = null;
  ehref: string | null = null;

  readonly #disconnect_sel: () => void;

  constructor(desktop: SPDesktop) {
    super(desktop, '/tools/connector');
    this.selection = desktop.getSelection();
    this.#disconnect_sel = this.selection.connectChanged((s) => this.#selectionChanged(s));

    /* Create red bpath */
    this.red_bpath = new CanvasItemBpath(desktop.getCanvasControls());
    this.red_bpath.set_stroke(this.red_color);
    this.red_bpath.set_fill(0x0);

    // Notice the initial selection.
    this.#selectionChanged(this.selection);
    this.within_tolerance = false;

    this.sp_event_context_read('curvature');
    this.sp_event_context_read('orthogonal');
    if (Preferences.get().getBool('/tools/connector/selcue', false)) this.enableSelectionCue();
  }

  override destroy(): void {
    this.#finish();
    this.state = S.SP_CONNECTOR_CONTEXT_IDLE;
    this.cc_clear_active_shape();
    this.cc_clear_active_conn();
    this.#disconnect_sel();
    for (const h of [...this.knots, ...this.endpt_handle]) h?.destroy();
    this.knots = [];
    this.endpt_handle = [null, null];
    this.red_bpath.unlink();
    this.ungrabCanvasEvents();
    super.destroy();
  }

  override set(name: string): void {
    const prefs = Preferences.get();
    if (name === 'curvature') {
      const v = prefs.getDouble('/tools/connector/curvature', 0);
      this.curvature = Number.isFinite(v) ? v : 0; // prevents NaN and +/-Inf from messing up
    } else if (name === 'orthogonal') {
      this.isOrthogonal = prefs.getBool('/tools/connector/orthogonal', false);
    }
  }

  //-----------------------------------------------------------------------------

  cc_clear_active_shape(): void {
    if (!this.active_shape) return;
    this.active_shape = null;
    this.#disconnect_active_shape?.();
    this.#disconnect_active_shape = null;
    // Hide the connection points if they exist.
    for (const k of this.knots) k.hide();
  }

  cc_clear_active_conn(): void {
    if (!this.active_conn) return;
    this.active_conn = null;
    this.#disconnect_active_conn?.();
    this.#disconnect_active_conn = null;
    // Hide the endpoint handles.
    for (const h of this.endpt_handle) h?.hide();
  }

  /** The connection point under the pointer: its position and the "#id" of its shape. */
  #ptHandleTest(): { p: Point; href: string } | null {
    const h = this.active_handle;
    if (!h || !this.knots.includes(h) || !h.owner?.getId()) return null;
    return { p: h.pos, href: `#${h.owner.getId()}` };
  }

  override root_handler(event: Event): boolean {
    let ret = false;
    switch (event.type) {
      case 'pointerdown':
        ret = this.#handleButtonPress(event as PointerEvent);
        break;
      case 'pointermove':
        ret = this.#handleMotionNotify(event as PointerEvent);
        break;
      case 'pointerup':
        ret = this.#handleButtonRelease(event as PointerEvent);
        break;
      case 'keydown':
        ret = this.#handleKeyPress(event as KeyboardEvent);
        break;
    }
    return ret || super.root_handler(event);
  }

  #snap(p: Point): Point {
    const m = this._desktop.getSnapManager();
    m.setup(this._desktop);
    const r = m.freeSnapReturnByRef(p, SnapSourceType.SNAPSOURCE_OTHER_HANDLE);
    m.unSetup();
    return r;
  }

  #handleButtonPress(e: PointerEvent): boolean {
    const event_w = this._windowPoint(e);
    let p = this._desktopPoint(event_w);
    if (e.button === 0) {
      if (!have_viable_layer(this._desktop)) return true;
      this.saveDragOrigin(event_w);
      this.grabCanvasEvents(e);
      switch (this.state) {
        case S.SP_CONNECTOR_CONTEXT_STOP:
        /* This is allowed, if we just canceled curve */
        case S.SP_CONNECTOR_CONTEXT_IDLE:
          if (this.npoints === 0) {
            this.cc_clear_active_conn();
            // Test whether we clicked on a connection point
            const found = this.#ptHandleTest();
            this.shref = found?.href ?? null;
            // This is the first point, so just snap it to the grid
            // as there's no other points to go off.
            p = found ? found.p : this.#snap(p);
            this.#setInitialPoint(p);
          }
          this.state = S.SP_CONNECTOR_CONTEXT_DRAGGING;
          return true;
        case S.SP_CONNECTOR_CONTEXT_DRAGGING: {
          // This is the second click of a connector creation.
          p = this.#snap(p);
          this.#setSubsequentPoint(p);
          this.#finishSegment();
          this.ehref = this.#ptHandleTest()?.href ?? null;
          if (this.npoints !== 0) this.#finish();
          if (this.newconn instanceof SPPath) this.cc_set_active_conn(this.newconn);
          this.state = S.SP_CONNECTOR_CONTEXT_IDLE;
          return true;
        }
        default:
          return false;
      }
    }
    if (e.button === 2) {
      if (this.state === S.SP_CONNECTOR_CONTEXT_REROUTING) {
        this.#reroutingFinish(p);
        this.state = S.SP_CONNECTOR_CONTEXT_IDLE;
      } else if (this.npoints !== 0) {
        this.#finish();
        this.state = S.SP_CONNECTOR_CONTEXT_IDLE;
        return true;
      }
    }
    return false;
  }

  #handleMotionNotify(e: PointerEvent): boolean {
    // allow middle-button scrolling
    if (e.buttons & 6) return false;
    const event_w = this._windowPoint(e);

    // Upstream item_handler: show the connection points of the shape under the pointer.
    if (this.state === S.SP_CONNECTOR_CONTEXT_IDLE || this.state === S.SP_CONNECTOR_CONTEXT_DRAGGING) {
      const item = this._desktop.getItemAtPoint(event_w, false);
      if (item && cc_item_is_shape(item)) this.#setActiveShape(item);
    }
    // While the canvas has the pointer capture (dragging), the handles get no pointerenter:
    // a connection point within a few screen px counts as hovered (upstream: all enter events).
    if (e.buttons & 1) {
      const p_dt = this._desktopPoint(event_w);
      const near = this.knots.find(
        (k) => k.ctrl.is_visible() && L2(this._desktop.d2w(k.pos).sub(this._desktop.d2w(p_dt))) < 8,
      );
      this.active_handle = near ?? null;
    }

    if (!this.checkDragMoved(event_w)) return false;
    let p = this._desktopPoint(event_w);
    switch (this.state) {
      case S.SP_CONNECTOR_CONTEXT_DRAGGING:
        // This is movement during a connector creation.
        if (this.npoints > 0) {
          p = this.#ptHandleTest()?.p ?? this.#snap(p);
          this.selection.clear();
          this.#setSubsequentPoint(p);
          return true;
        }
        return false;
      case S.SP_CONNECTOR_CONTEXT_REROUTING: {
        const path = this.clickeditem;
        if (!path) return false;
        p = this.#snap(p);
        // Update the hidden path
        const i2d = path.i2dtAffine();
        const d2i = i2d.inverse();
        const other = this.endpt_handle[this.clickedhandle === this.endpt_handle[0] ? 1 : 0]!.pos;
        const [a, b] = this.clickedhandle === this.endpt_handle[0] ? [p, other] : [other, p];
        // Upstream stretch_endpoints() keeps the shape of the path; only the ends matter for the route.
        const line = new Path(a.transformed(d2i));
        line.appendCurve(new LineSegment(a.transformed(d2i), b.transformed(d2i)));
        path.setCurve([line]);
        sp_conn_reroute_path_immediate(path);
        // Copy this to the temporary visible path
        this.red_curve = PV.transformed(path.curveForEdit() ?? [], i2d);
        this.red_bpath.set_bpath(this.red_curve);
        return true;
      }
      default:
        return false;
    }
  }

  #handleButtonRelease(e: PointerEvent): boolean {
    if (e.button !== 0) return false;
    const doc = this._desktop.getDocument();
    const p = this.#snap(this._desktopPoint(this._windowPoint(e)));
    this.ungrabCanvasEvents(e);
    switch (this.state) {
      case S.SP_CONNECTOR_CONTEXT_DRAGGING: {
        if (this.within_tolerance) {
          // A click on an object selects it (upstream item_handler), else it starts a
          // click-click connector.
          const item = this._desktop.getItemAtPoint(this._windowPoint(e), mod_alt(e));
          if (item) {
            this.#resetColors();
            this.state = S.SP_CONNECTOR_CONTEXT_IDLE;
            if (mod_select_add_to(e)) this.selection.toggle(item);
            else this.selection.set(item);
            return true;
          }
          this.#finishSegment();
          return true;
        }
        // Connector has been created via a drag, end it now.
        const found = this.#ptHandleTest();
        this.#setSubsequentPoint(found?.p ?? p);
        this.#finishSegment();
        // Test whether we clicked on a connection point
        this.ehref = found?.href ?? null;
        if (this.npoints !== 0) this.#finish();
        if (this.newconn instanceof SPPath) this.cc_set_active_conn(this.newconn);
        this.state = S.SP_CONNECTOR_CONTEXT_IDLE;
        break;
      }
      case S.SP_CONNECTOR_CONTEXT_REROUTING:
        this.#reroutingFinish(p);
        doc.ensureUpToDate();
        this.state = S.SP_CONNECTOR_CONTEXT_IDLE;
        return true;
      default:
        break;
    }
    return true;
  }

  #handleKeyPress(e: KeyboardEvent): boolean {
    switch (e.key) {
      case 'Enter':
        if (this.npoints !== 0) {
          this.#finish();
          this.state = S.SP_CONNECTOR_CONTEXT_IDLE;
          return true;
        }
        return false;
      case 'Escape':
        if (this.state === S.SP_CONNECTOR_CONTEXT_REROUTING) {
          const doc = this._desktop.getDocument();
          this.#reroutingFinish(null);
          DocumentUndo.undo(doc);
          this.state = S.SP_CONNECTOR_CONTEXT_IDLE;
          return true;
        }
        if (this.npoints !== 0) {
          // if drawing, cancel, otherwise pass it up for deselecting
          this.state = S.SP_CONNECTOR_CONTEXT_STOP;
          this.#resetColors();
          return true;
        }
        return false;
      default:
        return false;
    }
  }

  #reroutingFinish(p: Point | null): void {
    const doc = this._desktop.getDocument();
    const item = this.clickeditem;
    // Clear the temporary path:
    this.red_curve = [];
    this.red_bpath.set_bpath([]);
    if (!item) return;
    if (p) {
      // Test whether we clicked on a connection point
      const found = this.#ptHandleTest();
      if (found) {
        const start = this.clickedhandle === this.endpt_handle[0];
        item.setAttribute(start ? 'inkscape:connection-start' : 'inkscape:connection-end', found.href);
      }
    }
    item.setHidden(false);
    sp_conn_reroute_path_immediate(item);
    item.updateRepr();
    DocumentUndo.done(doc, C_('Undo', 'Reroute connector'), 'draw-connector');
    this.cc_set_active_conn(item);
  }

  #resetColors(): void {
    this.red_curve = [];
    this.red_bpath.set_bpath([]);
    this.green_curve = [];
    this.npoints = 0;
  }

  #setInitialPoint(p: Point): void {
    this.p[0] = p;
    this.p[1] = p;
    this.npoints = 2;
    this.red_bpath.set_bpath([]);
  }

  #setSubsequentPoint(p: Point): void {
    const doc = this._desktop.getDocument();
    const router = getRouter(doc);
    const o = this.p[0]!.transformed(this._desktop.dt2doc());
    const d = p.transformed(this._desktop.dt2doc());
    this.p[3] = this.p[0]!;
    this.p[4] = p;
    if (!router) {
      // Without libavoid: a straight line.
      const line = new Path(o);
      line.appendCurve(new LineSegment(o, d));
      this.red_curve = PV.transformed([line], this._desktop.doc2dt());
    } else {
      if (this.#newConnRef === null) {
        this.#newConnRef = new_avoid_id(doc);
        router.addConnector(this.#newConnRef, this.isOrthogonal);
      }
      // Set new endpoint.
      router.setEndpoints(this.#newConnRef, o.x, o.y, d.x, d.y);
      // Immediately generate new routes for connector.
      router.makePathInvalid(this.#newConnRef);
      router.processTransaction();
      router.takeChanged();
      // Recreate curve from libavoid route.
      this.red_curve = PV.transformed(
        createCurve(router.route(this.#newConnRef, this.curvature), this.curvature),
        this._desktop.doc2dt(),
      );
    }
    this.red_bpath.set_bpath(this.red_curve, true);
  }

  /** Concats red and green and writes the result to a new path (upstream _concatColorsAndFlush). */
  #concatColorsAndFlush(): void {
    const c = this.green_curve;
    this.green_curve = [];
    this.red_curve = [];
    this.red_bpath.set_bpath([]);
    if (!c.length) return;
    this.#flushWhite(c);
  }

  #flushWhite(c: PathVector): void {
    /* Now we have to go back to item coordinates at last */
    c = PV.transformed(c, this._desktop.dt2doc());
    const doc = this._desktop.getDocument();
    const layer = this.currentLayer();
    if (c.length && layer) {
      /* We actually have something to write */
      const repr = doc.getReprDoc().createElement('svg:path');
      /* Set style */
      this._desktop.applyCurrentOrToolStyle(repr, '/tools/connector', false);
      repr.setAttribute('d', sp_svg_write_path(PV.transformed(c, layer.i2docAffine().inverse())));
      repr.setAttribute('inkscape:connector-type', this.isOrthogonal ? 'orthogonal' : 'polyline');
      repr.setAttribute('inkscape:connector-curvature', String(this.curvature));
      if (this.shref) repr.setAttribute('inkscape:connection-start', this.shref);
      if (this.ehref) repr.setAttribute('inkscape:connection-end', this.ehref);
      const connection = !!(this.shref || this.ehref);
      /* Attach repr */
      this.newconn = layer.appendChildRepr(repr) as SPItem;
      // Process pending updates.
      doc.ensureUpToDate();
      if (connection && this.newconn instanceof SPPath) {
        // Adjust endpoints to shape edge.
        sp_conn_reroute_path_immediate(this.newconn);
        this.newconn.updateRepr();
      }
      // Only set the selection after we are finished with creating the attributes of
      // the connector.
      this.selection.set(this.newconn);
    }
    DocumentUndo.done(doc, C_('Undo', 'Create connector'), 'draw-connector');
  }

  #finishSegment(): void {
    if (this.red_curve.length) {
      this.green_curve = [...this.green_curve, ...this.red_curve];
      this.p[0] = this.p[3]!;
      this.p[1] = this.p[4]!;
      this.npoints = 2;
      this.red_curve = [];
    }
  }

  #finish(): void {
    this.red_curve = [];
    this.#concatColorsAndFlush();
    this.npoints = 0;
    this.shref = this.ehref = null;
    if (this.#newConnRef !== null) {
      getRouter(this._desktop.getDocument())?.deleteConnector(this.#newConnRef);
      this.#newConnRef = null;
    }
  }

  /** Show the connection point (the center) of item (upstream _setActiveShape). */
  #setActiveShape(item: SPItem): void {
    if (this.active_shape === item) return;
    // The active shape has changed
    this.cc_clear_active_shape();
    this.active_shape = item;
    // Listen in case the active shape changes or is deleted.
    const offs = [
      item.modifiedSignal.connect(() => this.cc_clear_active_shape()),
      item.deleteSignal.connect(() => this.cc_clear_active_shape()),
    ];
    this.#disconnect_active_shape = () => {
      for (const f of offs) f();
    };
    // Center point to any object
    const knot = this.knots[0] ?? new ConnHandle(this, HandleSize.NORMAL);
    this.knots = [knot];
    knot.owner = item;
    // Set the point to the middle of the object
    knot.setPosition(item.getAvoidRef().getConnectionPointPos().transformed(this._desktop.doc2dt()));
    knot.show();
  }

  /** Show the endpoint handles of a connector (upstream cc_set_active_conn). */
  cc_set_active_conn(item: SPPath): void {
    if (!item.curveForEdit()) return;
    if (this.active_conn !== item) {
      this.cc_clear_active_conn();
      this.active_conn = item;
      // Listen in case the active conn changes
      const offs = [
        item.modifiedSignal.connect(() => {
          if (this.active_conn === item) this.#placeEndpoints(item);
        }),
        item.deleteSignal.connect(() => this.cc_clear_active_conn()),
      ];
      this.#disconnect_active_conn = () => {
        for (const f of offs) f();
      };
      for (let i = 0; i < 2; i++) {
        // Create the handle if it doesn't exist
        if (!this.endpt_handle[i]) {
          const h = new ConnHandle(this, HandleSize.SMALL);
          h.ctrl.element.addEventListener('pointerdown', (e) => this.#endptPress(e, h));
          this.endpt_handle[i] = h;
        }
      }
    }
    this.#placeEndpoints(item);
  }

  #placeEndpoints(item: SPPath): void {
    const curve = item.curveForEdit();
    const path = curve?.[0];
    if (!path || path.empty()) {
      // Connector is invisible because it is clipped to the boundary of
      // two overlapping shapes.
      for (const h of this.endpt_handle) h?.hide();
      return;
    }
    const i2dt = item.i2dtAffine();
    this.endpt_handle[0]?.setPosition(path.initialPoint().transformed(i2dt));
    this.endpt_handle[1]?.setPosition((curve.at(-1) ?? path).finalPoint().transformed(i2dt));
    for (const h of this.endpt_handle) h?.show();
  }

  /** A press on an endpoint handle starts rerouting (upstream endpt_handler). */
  #endptPress(e: PointerEvent, handle: ConnHandle): void {
    if (e.button !== 0 || this.state !== S.SP_CONNECTOR_CONTEXT_IDLE || !this.active_conn) return;
    e.stopPropagation();
    const item = this.active_conn;
    this.clickeditem = item;
    this.clickedhandle = handle;
    const other = this.endpt_handle[handle === this.endpt_handle[0] ? 1 : 0]!;
    // Keep the positions: clearing hides the handles.
    const origin = other.pos;
    this.cc_clear_active_conn();
    other.pos = origin;
    this.state = S.SP_CONNECTOR_CONTEXT_REROUTING;
    // Disconnect from attached shape
    sp_conn_end_detach(item, handle === this.endpt_handle[0] ? 0 : 1);
    // Show the red path for dragging.
    this.red_curve = PV.transformed(item.curveForEdit() ?? [], item.i2dtAffine());
    this.red_bpath.set_bpath(this.red_curve, true);
    item.setHidden(true);
    this.saveDragOrigin(this._windowPoint(e));
    this.within_tolerance = false;
    this._element.setPointerCapture?.(e.pointerId);
  }

  #selectionChanged(selection: Selection): void {
    const item = selection.singleItem();
    if (this.active_conn === item) return; // Nothing to change.
    if (!item) {
      this.cc_clear_active_conn();
      return;
    }
    if (cc_item_is_connector(item)) this.cc_set_active_conn(item as SPPath);
  }
}

/** The curve of a libavoid route of a connector that has no path yet (upstream SPConnEndPair::createCurve). */
function createCurve(route: { points: number[]; types: string }, curvature: number): PathVector {
  return SPConnEndPair.curveFromRoute(route, curvature);
}

/** Whether connectors can attach to item: not open paths (connectors) and, by default, not text. */
export function cc_item_is_shape(item: SPItem): boolean {
  if (item instanceof SPPath) {
    const curve = item.curve();
    // Open paths are connectors.
    if (curve && !is_closed(curve)) return false;
  } else if (item instanceof SPText || item instanceof SPFlowtext) {
    // Don't count text as a shape we can connect connector to.
    if (Preferences.get().getBool('/tools/connector/ignoretext', true)) return false;
  }
  return true;
}

/** To be a connector, an item must be an open path marked with inkscape:connector-type. */
export function cc_item_is_connector(item: SPItem): boolean {
  if (!(item instanceof SPPath)) return false;
  const curve = item.curveForEdit();
  return !!curve && item.connEndPair.isAutoRoutingConn() && !is_closed(curve);
}

/**
 * Make connectors avoid (or ignore) the selected shapes (upstream cc_selection_set_avoid).
 * Returns false if no shape is selected.
 */
export function cc_selection_set_avoid(desktop: SPDesktop, set_avoid: boolean): boolean {
  const document = desktop.getDocument();
  let changes = 0;
  for (const item of desktop.getSelection().items()) {
    if (!cc_item_is_shape(item)) continue;
    item.setAttribute('inkscape:connector-avoid', set_avoid ? 'true' : null);
    item.getAvoidRef().handleSettingChange();
    changes++;
  }
  if (changes === 0) return false;
  DocumentUndo.done(
    document,
    set_avoid
      ? C_('Undo', 'Make connectors avoid selected objects')
      : C_('Undo', 'Make connectors ignore selected objects'),
    'draw-connector',
  );
  return true;
}
