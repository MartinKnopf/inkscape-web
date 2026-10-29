// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-conn-end.cpp, src/object/sp-conn-end.h
/*
 * The ends of a connector: the objects a connector path is attached to.
 *
 * Authors:
 *   Michael Wybrow <mjwybrow@users.sourceforge.net>
 *
 * Copyright (C) 2005 Michael Wybrow
 */
import { type Affine, type Path, write_svg_path } from '@inkscape-web/geom';
import { pathBoolopBackendOrNull } from '../path/path-boolop.ts';
import { i2anc_affine, type SPItem } from './sp-item.ts';
import { lpeItemClasses } from './sp-lpe-item.ts';
import { SP_OBJECT_MODIFIED_FLAG, type SPObject } from './sp-object.ts';
import type { SPPath } from './sp-path.ts';
import { SPUseReference } from './sp-use-reference.ts';

/**
 * One end of a connector (upstream SPConnEnd): ref is the object the end is attached to;
 * sub_ref is an optional sub-object inside a symbol or clone.
 */
export class SPConnEnd {
  readonly ref: SPUseReference;
  readonly sub_ref: SPUseReference;
  href: string | null = null;
  sub_href: string | null = null;
  /** Disconnects the delete and modified signals of the attached object. */
  _disconnect: (() => void) | null = null;

  constructor(owner: SPObject) {
    this.ref = new SPUseReference(owner);
    this.sub_ref = new SPUseReference(owner);
  }

  setAttacherHref(value: string | null): void {
    if (value === this.href) return;
    this.href = value;
    if (!this.ref.try_attach(value)) this.href = null;
  }

  setAttacherSubHref(value: string | null): void {
    // TODO This could check the URI object is actually a sub-object
    // of the set href. It should be done here and in setAttacherHref
    if (value === this.sub_href) return;
    this.sub_href = value;
    if (!this.sub_ref.try_attach(value)) this.sub_href = null;
  }
}

function get_nearest_common_ancestor(obj: SPObject, objs: readonly (SPItem | null)[]): SPObject {
  let anc_sofar: SPObject = obj;
  for (const o of objs) if (o) anc_sofar = anc_sofar.nearestCommonAncestor(o) ?? anc_sofar;
  return anc_sofar;
}

/**
 * The outermost crossing time on conn_path of item (a shape, or the shapes of a group), with
 * both in ancestor coordinates; null without a crossing (upstream
 * try_get_intersect_point_with_item_recursive). Needs the crossings of the WASM backend.
 */
function intersect_with_item(conn_path: Path, item: SPItem, item_transform: Affine): number | null {
  const backend = pathBoolopBackendOrNull();
  const { SPGroup, SPShape } = lpeItemClasses;
  if (!backend) return null;
  if (SPGroup && item instanceof SPGroup) {
    // consider all first-order children
    let pos: number | null = null;
    for (const child of item.item_list()) {
      const p = intersect_with_item(conn_path, child, child.transform.multiply(item_transform));
      if (p !== null && (pos === null || p > pos)) pos = p;
    }
    return pos;
  }
  // if this is not a shape, nothing to be done
  if (!(SPShape && item instanceof SPShape)) return null;
  const curve = item.curve();
  // make sure it has an associated curve
  if (!curve?.length) return null;
  const a = write_svg_path([conn_path]);
  let pos: number | null = null;
  for (const p of curve) {
    const flat = backend.pathCrossings(a, write_svg_path([p.transformed(item_transform)]));
    for (let i = 0; i < flat.length; i += 2) {
      const ta = flat[i]!;
      if (pos === null || ta > pos) pos = ta;
    }
  }
  return pos;
}

/** Cut the connector curve to [endPos[0], endPos[1]] (upstream change_endpts). */
function change_endpts(path: SPPath, endPos: [number, number]): void {
  // Use Geom::Path::portion to cut the curve at the end positions
  if (endPos[0] > endPos[1]) {
    // Path is "negative", reset the curve and return
    path.setCurve([]);
    return;
  }
  const old_path = path.curve()?.[0];
  if (!old_path) return;
  path.setCurve([old_path.portion(endPos[0], endPos[1])]);
}

/**
 * Get the new route around obstacles and cut it at the outlines of the attached items
 * (upstream sp_conn_get_route_and_redraw).
 */
function sp_conn_get_route_and_redraw(path: SPPath, updatePathRepr = true): void {
  // Get the new route around obstacles.
  if (!path.connEndPair.reroutePathFromLibavoid()) return;

  const h2attItem = path.connEndPair.getAttachedItems();
  const ancestor = get_nearest_common_ancestor(path, h2attItem);
  const path2anc = i2anc_affine(path, ancestor);

  // Set sensible values in case there the connector ends are not
  // attached to any shapes.
  const conn = path.curve()?.[0];
  if (!conn) return;
  const endPos: [number, number] = [0.0, conn.size()];
  const conn_anc = conn.transformed(path2anc);
  for (let h = 0; h < 2; h++) {
    const item = h2attItem[h];
    // Assume center point for all
    if (!item) continue;
    // If this is not the starting point, reverse the path
    const p = h === 0 ? conn_anc : conn_anc.reversed();
    const pos = intersect_with_item(p, item, i2anc_affine(item, ancestor)) ?? 0;
    // If not at the starting point, recompute position with respect to original path
    endPos[h] = h === 0 ? pos : conn.size() - pos;
  }
  change_endpts(path, endPos);
  if (updatePathRepr) {
    path.updateRepr();
    path.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
  }
}

function sp_conn_end_shape_modified(path: SPPath): void {
  if (path.connEndPair.isAutoRoutingConn()) path.connEndPair.tellLibavoidNewEndpoints();
}

export function sp_conn_reroute_path(path: SPPath): void {
  if (path.connEndPair.isAutoRoutingConn()) path.connEndPair.tellLibavoidNewEndpoints();
}

/** Reroute now, without writing the repr (for dragging, see upstream). */
export function sp_conn_reroute_path_immediate(path: SPPath): void {
  if (path.connEndPair.isAutoRoutingConn()) path.connEndPair.tellLibavoidNewEndpoints(true);
  // Don't update the path repr or else connector dragging is slowed by
  // constant update of values to the xml editor, and each step is also
  // needlessly remembered by undo/redo.
  sp_conn_get_route_and_redraw(path, false);
}

export function sp_conn_redraw_path(path: SPPath): void {
  sp_conn_get_route_and_redraw(path);
}

const attrs = ['inkscape:connection-start', 'inkscape:connection-end'] as const;
const point_attrs = ['inkscape:connection-start-point', 'inkscape:connection-end-point'] as const;

function sp_conn_end_deleted(owner: SPObject, handle_ix: number): void {
  owner.removeAttribute(attrs[handle_ix]!);
  owner.removeAttribute(point_attrs[handle_ix]!);
  /* I believe this will trigger sp_conn_end_href_changed. */
}

export function sp_conn_end_detach(owner: SPObject, handle_ix: number): void {
  sp_conn_end_deleted(owner, handle_ix);
}

/** Follow the attached object: detach when it is deleted, reroute when it changes. */
export function sp_conn_end_href_changed(connEnd: SPConnEnd, path: SPPath, handle_ix: number): void {
  connEnd._disconnect?.();
  connEnd._disconnect = null;
  const refobj = connEnd.href ? connEnd.ref.getObject() : null;
  if (!refobj) return;
  const offs = [
    refobj.deleteSignal.connect(() => sp_conn_end_deleted(path, handle_ix)),
    refobj.modifiedSignal.connect(() => sp_conn_end_shape_modified(path)),
  ];
  connEnd._disconnect = () => {
    for (const f of offs) f();
  };
}
