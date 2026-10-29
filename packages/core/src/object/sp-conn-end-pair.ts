// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-conn-end-pair.cpp, src/object/sp-conn-end-pair.h
/*
 * A class for handling connector endpoint movement and libavoid interaction.
 *
 * Authors:
 *   Peter Moulder <pmoulder@mail.csse.monash.edu.au>
 *   Michael Wybrow <mjwybrow@users.sourceforge.net>
 *   Abhishek Sharma
 *
 *    * Copyright (C) 2004-2005 Monash University
 */
import { type Path, PathBuilder, type PathVector, Point } from '@inkscape-web/geom';
import { SPAttr } from '../attributes.ts';
import { getRouter, new_avoid_id, set_conn_callback } from '../conn-avoid-ref.ts';
import { svgNumber } from '../svg/stringstream.ts';
import type { Node } from '../xml/node.ts';
import {
  SPConnEnd,
  sp_conn_end_detach,
  sp_conn_end_href_changed,
  sp_conn_redraw_path,
  sp_conn_reroute_path,
  sp_conn_reroute_path_immediate,
} from './sp-conn-end.ts';
import type { SPItem } from './sp-item.ts';
import { lpeItemClasses } from './sp-lpe-item.ts';
import type { SPPath } from './sp-path.ts';

export enum SPConnectorType {
  SP_CONNECTOR_NOAVOID, // Basic connector - a straight line.
  SP_CONNECTOR_POLYLINE, // Object avoiding polyline.
  SP_CONNECTOR_ORTHOGONAL, // Object avoiding orthogonal polyline (only horizontal and vertical segments).
}

export const SP_CONNECTOR_NOAVOID = SPConnectorType.SP_CONNECTOR_NOAVOID;
export const SP_CONNECTOR_POLYLINE = SPConnectorType.SP_CONNECTOR_POLYLINE;
export const SP_CONNECTOR_ORTHOGONAL = SPConnectorType.SP_CONNECTOR_ORTHOGONAL;

/**
 * The connector state of a path (upstream SPConnEndPair): the two ends with the objects they
 * are attached to (inkscape:connection-start/-end), the connector type and curvature, and the
 * libavoid connector that routes the path around the avoided shapes.
 */
export class SPConnEndPair {
  readonly #path: SPPath;
  /** libavoid's id of the connector, or null. */
  _connRef: number | null = null;
  _connType = SP_CONNECTOR_NOAVOID;
  _connCurvature = 0.0;
  readonly _connEnd: [SPConnEnd, SPConnEnd];
  #disconnect_transformed: (() => void) | null = null;

  constructor(owner: SPPath) {
    this.#path = owner;
    this._connEnd = [new SPConnEnd(owner), new SPConnEnd(owner)];
    this._connEnd.forEach((end, handle_ix) => {
      end.ref.changedSignal.connect(() => sp_conn_end_href_changed(end, owner, handle_ix));
    });
  }

  release(): void {
    for (const end of this._connEnd) {
      end._disconnect?.();
      end._disconnect = null;
      end.href = null;
      end.ref.detach();
    }
    this.#deleteConnector();
  }

  #deleteConnector(): void {
    if (this._connRef !== null) {
      getRouter(this.#path.document)?.deleteConnector(this._connRef);
      set_conn_callback(this.#path.document, this._connRef, null);
    }
    this._connRef = null;
    this.#disconnect_transformed?.();
    this.#disconnect_transformed = null;
  }

  setAttr(key: SPAttr, value: string | null): void {
    switch (key) {
      case SPAttr.CONNECTOR_TYPE:
        if (value === 'polyline' || value === 'orthogonal') {
          const new_conn_type = value === 'polyline' ? SP_CONNECTOR_POLYLINE : SP_CONNECTOR_ORTHOGONAL;
          const router = getRouter(this.#path.document);
          if (this._connRef === null) {
            this._connType = new_conn_type;
            if (!router) break;
            this._connRef = new_avoid_id(this.#path.document);
            router.addConnector(this._connRef, new_conn_type === SP_CONNECTOR_ORTHOGONAL);
            this.#disconnect_transformed = this.#path.transformedSignal.connect(() => {
              if (this.isAutoRoutingConn()) this.tellLibavoidNewEndpoints();
            });
          } else if (new_conn_type !== this._connType) {
            this._connType = new_conn_type;
            router?.setRoutingType(this._connRef, new_conn_type === SP_CONNECTOR_ORTHOGONAL);
            sp_conn_reroute_path(this.#path);
          }
        } else {
          this._connType = SP_CONNECTOR_NOAVOID;
          this.#deleteConnector();
        }
        break;
      case SPAttr.CONNECTOR_CURVATURE:
        if (value) {
          this._connCurvature = Number.parseFloat(value) || 0;
          // Redraw the connector, but only if it has been initialised.
          if (this._connRef !== null && getRouter(this.#path.document)?.isInitialised(this._connRef)) {
            sp_conn_reroute_path(this.#path);
          }
        }
        break;
      case SPAttr.CONNECTION_START:
        this._connEnd[0].setAttacherHref(value);
        break;
      case SPAttr.CONNECTION_START_POINT:
        this._connEnd[0].setAttacherSubHref(value);
        break;
      case SPAttr.CONNECTION_END:
        this._connEnd[1].setAttacherHref(value);
        break;
      case SPAttr.CONNECTION_END_POINT:
        this._connEnd[1].setAttacherSubHref(value);
        break;
    }
  }

  writeRepr(repr: Node): void {
    const attrs = ['inkscape:connection-start', 'inkscape:connection-end'];
    const point_attrs = ['inkscape:connection-start-point', 'inkscape:connection-end-point'];
    this._connEnd.forEach((end, h) => {
      const u = end.ref.getURI();
      if (u) repr.setAttribute(attrs[h]!, u);
      const p = end.sub_ref.getURI();
      if (p) repr.setAttribute(point_attrs[h]!, p);
    });
    if (this._connType === SP_CONNECTOR_POLYLINE || this._connType === SP_CONNECTOR_ORTHOGONAL) {
      repr.setAttribute('inkscape:connector-curvature', svgNumber(this._connCurvature));
      repr.setAttribute(
        'inkscape:connector-type',
        this._connType === SP_CONNECTOR_POLYLINE ? 'polyline' : 'orthogonal',
      );
    }
  }

  /** The items the two ends are attached to (upstream getAttachedItems). */
  getAttachedItems(): [SPItem | null, SPItem | null] {
    const out: [SPItem | null, SPItem | null] = [null, null];
    for (let h = 0; h < 2; h++) {
      const end = this._connEnd[h]!;
      // TODO: sub objects (connection points inside a symbol or clone).
      let item = end.ref.getObject();
      // Deal with the case of the attached object being an empty group.
      // A group containing no items does not have a valid bbox, so
      // causes problems for the auto-routing code.  Also, since such a
      // group no longer has an onscreen representation and can only be
      // selected through the XML editor, it makes sense just to detach
      // connectors from them.
      const { SPGroup } = lpeItemClasses;
      if (SPGroup && item instanceof SPGroup && item.getItemCount() === 0) {
        // This group is empty, so detach.
        sp_conn_end_detach(this.#path, h);
        item = null;
      }
      out[h] = item;
    }
    return out;
  }

  /** The two endpoints in document coordinates: the attached items' centers, or the path's ends. */
  getEndpoints(): [Point, Point] {
    const curve = this.#path.curveForEdit();
    const attached = this.getAttachedItems();
    const i2d = this.#path.i2docAffine();
    const ends: [Point, Point] = [new Point(0, 0), new Point(0, 0)];
    for (let h = 0; h < 2; h++) {
      const item = attached[h];
      const path = h === 0 ? curve?.[0] : curve?.at(-1);
      if (item) ends[h] = item.getAvoidRef().getConnectionPointPos();
      else if (path && !path.empty())
        ends[h] = (h === 0 ? path.initialPoint() : path.finalPoint()).transformed(i2d);
      else if (path) ends[h] = path.initialPoint().transformed(i2d);
    }
    return ends;
  }

  getCurvature(): number {
    return this._connCurvature;
  }

  getConnEnds(): [SPConnEnd, SPConnEnd] {
    return this._connEnd;
  }

  isOrthogonal(): boolean {
    return this._connType === SP_CONNECTOR_ORTHOGONAL;
  }

  rerouteFromManipulation(): void {
    sp_conn_reroute_path_immediate(this.#path);
  }

  /** Called from SPPath.update to initialise the endpoints. */
  update(): void {
    if (this._connType === SP_CONNECTOR_NOAVOID || this._connRef === null) return;
    const router = getRouter(this.#path.document);
    if (router && !router.isInitialised(this._connRef)) {
      this.#updateEndPoints();
      const path = this.#path;
      set_conn_callback(path.document, this._connRef, () => sp_conn_redraw_path(path));
    }
  }

  #updateEndPoints(): void {
    if (this._connRef === null) return;
    const [src, dst] = this.getEndpoints();
    getRouter(this.#path.document)?.setEndpoints(this._connRef, src.x, src.y, dst.x, dst.y);
  }

  isAutoRoutingConn(): boolean {
    return this._connType !== SP_CONNECTOR_NOAVOID;
  }

  makePathInvalid(): void {
    if (this._connRef !== null) getRouter(this.#path.document)?.makePathInvalid(this._connRef);
  }

  /** Redraws the curve along the recalculated route, straight or curved (upstream createCurve). */
  createCurve(curvature: number): PathVector {
    const router = getRouter(this.#path.document);
    if (!router || this._connRef === null) return [];
    return SPConnEndPair.curveFromRoute(router.route(this._connRef, curvature), curvature);
  }

  /** The path of a libavoid route: 'M', 'L' and 'C' commands per point (see AvoidRouter.route). */
  static curveFromRoute(route: { points: number[]; types: string }, curvature: number): PathVector {
    const straight = curvature < 1e-3;
    const { points, types } = route;
    const pt = (i: number) => new Point(points[2 * i]!, points[2 * i + 1]!);
    const pn = types.length;
    if (!pn) return [];
    const curve = new PathBuilder();
    curve.moveTo(pt(0));
    for (let i = 1; i < pn; ++i) {
      if (straight) {
        curve.lineTo(pt(i));
        continue;
      }
      switch (types[i]) {
        case 'M':
          curve.moveTo(pt(i));
          break;
        case 'L':
          curve.lineTo(pt(i));
          break;
        case 'C':
          if (i + 2 < pn) curve.curveTo(pt(i), pt(i + 1), pt(i + 2));
          i += 2;
          break;
      }
    }
    curve.flush();
    return curve.peek();
  }

  /** Give libavoid the new endpoints; with processTransaction route at once. */
  tellLibavoidNewEndpoints(processTransaction = false): void {
    if (this._connRef === null || !this.isAutoRoutingConn()) return;
    this.makePathInvalid();
    this.#updateEndPoints();
    if (processTransaction) getRouter(this.#path.document)?.processTransaction();
  }

  /** Set the path to the route of libavoid. Returns false if this is not a routed connector. */
  reroutePathFromLibavoid(): boolean {
    if (this._connRef === null || !this.isAutoRoutingConn()) return false;
    const curve = this.createCurve(this._connCurvature);
    const doc2item = this.#path.i2docAffine().inverse();
    this.#path.setCurve(curve.map((p: Path) => p.transformed(doc2item)));
    return true;
  }
}

/** Read the connector attributes (upstream sp_conn_end_pair_build). */
export function sp_conn_end_pair_build(object: SPPath): void {
  object.readAttr(SPAttr.CONNECTOR_TYPE);
  object.readAttr(SPAttr.CONNECTION_START);
  object.readAttr(SPAttr.CONNECTION_START_POINT);
  object.readAttr(SPAttr.CONNECTION_END);
  object.readAttr(SPAttr.CONNECTION_END_POINT);
  object.readAttr(SPAttr.CONNECTOR_CURVATURE);
}
