// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/helper/geom-nodesatellite.cpp, src/helper/geom-nodesatellite.h
/**
 * \file
 * NodeSatellite a per node holder of data.
 */
/*
 * Authors:
 *   Jabiertxo Arraiza Cenoz <jabier.arraiza@marker.es>
 *
 * Copyright (C) 2015 Authors
 */
import { BezierCurve, type Curve, nearest_time, Path, type Point, write_svg_path } from '@inkscape-web/geom';
import { pathBoolopBackend } from '../path/path-boolop.ts';

/** The type of a node satellite (the corner of the Corners effect). */
export enum NodeSatelliteType {
  FILLET = 0, // Fillet
  INVERSE_FILLET, // Inverse Fillet
  CHAMFER, // Chamfer
  INVERSE_CHAMFER, // Inverse Chamfer
  INVALID_SATELLITE, // Invalid NodeSatellite
}

const TYPE_KEYS: Record<NodeSatelliteType, string> = {
  [NodeSatelliteType.FILLET]: 'F',
  [NodeSatelliteType.INVERSE_FILLET]: 'IF',
  [NodeSatelliteType.CHAMFER]: 'C',
  [NodeSatelliteType.INVERSE_CHAMFER]: 'IC',
  [NodeSatelliteType.INVALID_SATELLITE]: 'KO',
};

/** The type of a key ("F", "IF", "C", "IC", "KO"), or null for an unknown key. */
export function nodeSatelliteTypeFromKey(key: string): NodeSatelliteType | null {
  for (const [t, k] of Object.entries(TYPE_KEYS)) if (k === key) return Number(t) as NodeSatelliteType;
  return null;
}

/** Path data of a single curve, for the arc length functions in WASM. */
function curveData(c: Curve): string {
  const p = new Path(c.initialPoint());
  p.appendCurve(c);
  return write_svg_path([p]);
}

/** The arc length of c (upstream Curve::length with the default tolerance). */
export function curveLength(c: Curve): number {
  return c instanceof BezierCurve ? c.length(0.01) : 0;
}

/** The time on curve_in at arc length A (2geom arc length in WASM). */
export function timeAtArcLength(A: number, curve_in: Curve): number {
  if (A === 0 || curve_in.isDegenerate()) return 0;
  return pathBoolopBackend().nodesatTimeAtArcLength(curveData(curve_in), A);
}

/** The arc length of curve_in at time A. */
export function arcLengthAt(A: number, curve_in: Curve): number {
  if (A === 0 || curve_in.isDegenerate()) return 0;
  return pathBoolopBackend().nodesatArcLengthAt(curveData(curve_in), A);
}

/**
 * The data of the corner at a node (upstream NodeSatellite): type, amount (an arc length, or a
 * time with is_time) and the chamfer steps and scale.
 */
export class NodeSatellite {
  nodesatellite_type: NodeSatelliteType;
  is_time = false;
  selected = false;
  has_mirror = false;
  hidden = true;
  amount = 0.0;
  angle = 0.0;
  steps = 0;

  constructor(nodesatellite_type = NodeSatelliteType.FILLET) {
    this.nodesatellite_type = nodesatellite_type;
  }

  clone(): NodeSatellite {
    return Object.assign(new NodeSatellite(this.nodesatellite_type), this);
  }

  setIsTime(set_is_time: boolean): void {
    this.is_time = set_is_time;
  }
  setSelected(set_selected: boolean): void {
    this.selected = set_selected;
  }
  setHasMirror(set_has_mirror: boolean): void {
    this.has_mirror = set_has_mirror;
  }
  setHidden(set_hidden: boolean): void {
    this.hidden = set_hidden;
  }
  setAmount(set_amount: number): void {
    this.amount = set_amount;
  }
  setAngle(set_angle: number): void {
    this.angle = set_angle;
  }
  setSteps(set_steps: number): void {
    this.steps = set_steps;
  }

  /** The knot distance of a fillet with radius A (in WASM). */
  radToLen(A: number, curve_in: Curve, curve_out: Curve): number {
    return pathBoolopBackend().nodesatRadToLen(A, curveData(curve_in), curveData(curve_out));
  }

  /** The radius of a fillet with knot distance A (in WASM). */
  lenToRad(A: number, curve_in: Curve, curve_out: Curve, _previousNodeSatellite: NodeSatellite): number {
    return pathBoolopBackend().nodesatLenToRad(A, curveData(curve_in), curveData(curve_out));
  }

  /** The time of the satellite on curve_in (from its end with inverse). */
  time(curve_in: Curve, inverse = false): number {
    let t = this.amount;
    if (!this.is_time) t = this.timeAt(t, inverse, curve_in);
    else if (inverse) t = 1 - t;
    if (t > 1) t = 1;
    return t;
  }

  /** Upstream time(double A, bool inverse, Curve): the time at arc length A. */
  timeAt(A: number, inverse: boolean, curve_in: Curve): number {
    if (A === 0 && inverse) return 1;
    if (A === 0 && !inverse) return 0;
    if (!inverse) return timeAtArcLength(A, curve_in);
    const length_part = curveLength(curve_in);
    return timeAtArcLength(length_part - A, curve_in);
  }

  arcDistance(curve_in: Curve): number {
    let s = this.amount;
    if (this.is_time) s = arcLengthAt(s, curve_in);
    return s;
  }

  getPosition(curve_in: Curve, inverse = false): Point {
    return curve_in.pointAt(this.time(curve_in, inverse));
  }

  setPosition(p: Point, curve_in: Curve, inverse = false): void {
    const curve = inverse ? curve_in.reverse() : curve_in;
    let A = curve instanceof BezierCurve ? nearest_time(p, curve) : 0;
    if (!this.is_time) A = arcLengthAt(A, curve);
    this.amount = A;
  }

  setNodeSatellitesType(A: string): void {
    const t = nodeSatelliteTypeFromKey(A);
    if (t !== null) this.nodesatellite_type = t;
  }

  getNodeSatellitesTypeGchar(): string {
    return TYPE_KEYS[this.nodesatellite_type];
  }
}

export type NodeSatellites = NodeSatellite[][];
