// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/helper/geom-pathvector_nodesatellites.cpp, src/helper/geom-pathvector_nodesatellites.h
/** @file
 * PathVectorNodeSatellites a class to manage nodesatellites -per node extra data- in a pathvector
 */
/*
 * Authors: see git history
 * Jabiertxof
 * Nathan Hurst
 * Johan Engelen
 * Josh Andler
 * suv
 * Mc-
 * Liam P. White
 * Krzysztof Kosiński
 * This code is in public domain
 *
 * Copyright (C) 2018 Authors
 */
import { are_near, type Curve, type Path, type PathVector } from '@inkscape-web/geom';
import { convertUnit as convertUnitValue } from '../svg/svg-length.ts';
import { count_path_curves, count_path_nodes } from './geom.ts';
import type { NodeSatellite, NodeSatellites, NodeSatelliteType } from './geom-nodesatellite.ts';

/** Curve j of path, with the closing segment as the last curve (upstream Path::operator[]). */
export function curveOf(path: Path, j: number): Curve {
  return path.curves()[j] ?? path.closingSegment();
}

/** The node satellites of a path vector, one per curve and one more at the end of open paths. */
export class PathVectorNodeSatellites {
  _pathvector: PathVector = [];
  _nodesatellites: NodeSatellites = [];

  getPathVector(): PathVector {
    return this._pathvector;
  }
  setPathVector(pathv: PathVector): void {
    this._pathvector = pathv;
  }
  /** A copy of the satellites. */
  getNodeSatellites(): NodeSatellites {
    return this._nodesatellites.map((v) => v.map((s) => s.clone()));
  }
  setNodeSatellites(nodesatellites: NodeSatellites): void {
    this._nodesatellites = nodesatellites;
  }
  getTotalNodeSatellites(): number {
    return this._nodesatellites.reduce((n, v) => n + v.length, 0);
  }
  /** The path and node index of satellite number index. */
  getIndexData(index: number): [number, number] {
    let counter = 0;
    for (let i = 0; i < this._nodesatellites.length; ++i) {
      for (let j = 0; j < (this._nodesatellites[i] as NodeSatellite[]).length; ++j) {
        if (index === counter) return [i, j];
        counter++;
      }
    }
    return [0, 0];
  }
  setSelected(selected: number[]): void {
    let counter = 0;
    for (const v of this._nodesatellites) {
      for (const j of v) {
        j.setSelected(selected.includes(counter));
        counter++;
      }
    }
  }

  #applies(s: NodeSatellite, apply_no_radius: boolean, apply_with_radius: boolean): boolean {
    return !((!apply_no_radius && s.amount === 0) || (!apply_with_radius && s.amount !== 0));
  }

  updateSteps(
    steps: number,
    apply_no_radius: boolean,
    apply_with_radius: boolean,
    only_selected: boolean,
  ): void {
    for (const v of this._nodesatellites) {
      for (const j of v) {
        if (!this.#applies(j, apply_no_radius, apply_with_radius)) continue;
        if (!only_selected || j.selected) j.steps = steps;
      }
    }
  }

  updateAngle(
    angle: number,
    apply_no_radius: boolean,
    apply_with_radius: boolean,
    only_selected: boolean,
  ): void {
    for (const v of this._nodesatellites) {
      for (const j of v) {
        if (!this.#applies(j, apply_no_radius, apply_with_radius)) continue;
        if (!only_selected || j.selected) j.angle = angle;
      }
    }
  }

  updateAmount(
    radius: number,
    apply_no_radius: boolean,
    apply_with_radius: boolean,
    only_selected: boolean,
    use_knot_distance: boolean,
    flexible: boolean,
  ): void {
    const power = flexible ? radius / 100 : radius;
    for (let i = 0; i < this._nodesatellites.length; ++i) {
      const path = this._pathvector[i] as Path;
      const sats = this._nodesatellites[i] as NodeSatellite[];
      for (let j = 0; j < sats.length; ++j) {
        const s = sats[j] as NodeSatellite;
        let previous_index: number | null = null;
        if (j === 0 && path.closed()) previous_index = count_path_nodes(path) - 1;
        else if (!path.closed() || j !== 0) previous_index = j - 1;
        if (!path.closed() && j === 0) {
          s.amount = 0;
          continue;
        }
        if (count_path_nodes(path) === j) continue;
        if (!this.#applies(s, apply_no_radius, apply_with_radius)) continue;
        if (s.selected || !only_selected) {
          if (!use_knot_distance && !flexible) {
            if (previous_index !== null) {
              s.amount = s.radToLen(power, curveOf(path, previous_index), curveOf(path, j));
              if (power && !s.amount) console.warn('Seems a too high radius value');
            } else {
              s.amount = 0.0;
            }
          } else {
            s.amount = power;
          }
        }
      }
    }
  }

  convertUnit(inUnit: string, to: string, apply_no_radius: boolean, apply_with_radius: boolean): void {
    for (let i = 0; i < this._nodesatellites.length; ++i) {
      const path = this._pathvector[i] as Path;
      const sats = this._nodesatellites[i] as NodeSatellite[];
      for (let j = 0; j < sats.length; ++j) {
        const s = sats[j] as NodeSatellite;
        if (!path.closed() && j === 0) {
          s.amount = 0;
          continue;
        }
        if (count_path_nodes(path) === j) continue;
        if (!this.#applies(s, apply_no_radius, apply_with_radius)) continue;
        s.amount = convertUnitValue(s.amount, inUnit, to);
      }
    }
  }

  updateNodeSatelliteType(
    nodesatellitetype: NodeSatelliteType,
    apply_no_radius: boolean,
    apply_with_radius: boolean,
    only_selected: boolean,
  ): void {
    for (let i = 0; i < this._nodesatellites.length; ++i) {
      const path = this._pathvector[i] as Path;
      const sats = this._nodesatellites[i] as NodeSatellite[];
      for (let j = 0; j < sats.length; ++j) {
        const s = sats[j] as NodeSatellite;
        if (!this.#applies(s, apply_no_radius, apply_with_radius)) continue;
        if (count_path_nodes(path) === j) {
          if (!only_selected) s.nodesatellite_type = nodesatellitetype;
          continue;
        }
        if (!only_selected || s.selected) s.nodesatellite_type = nodesatellitetype;
      }
    }
  }

  /** Map the satellites to a new path vector: nodes at the same place keep their satellite. */
  recalculateForNewPathVector(new_pathvector: PathVector, S: NodeSatellite): void {
    const new_nodesatellites: NodeSatellites = [];
    for (let i_np = 0; i_np < new_pathvector.length; ++i_np) {
      const new_path = new_pathvector[i_np] as Path;
      const new_nodesatellite_vector: NodeSatellite[] = [];
      const new_curves_size = count_path_curves(new_path);
      for (let i_nc = 0; i_nc < new_curves_size; ++i_nc) {
        let found = false;
        for (let i_op = 0; i_op < this._pathvector.length; ++i_op) {
          if (i_op >= this._nodesatellites.length) break;
          const old_path = this._pathvector[i_op] as Path;
          const old_sats = this._nodesatellites[i_op] as NodeSatellite[];
          const old_curves_size = count_path_curves(old_path);
          for (let i_oc = 0; i_oc < old_curves_size; ++i_oc) {
            if (i_oc >= old_sats.length) break;
            if (
              are_near(curveOf(old_path, i_oc).initialPoint(), curveOf(new_path, i_nc).initialPoint(), 0.001)
            ) {
              new_nodesatellite_vector.push((old_sats[i_oc] as NodeSatellite).clone());
              found = true;
              break;
            }
          }
          if (found) break;
        }
        if (!found) {
          const old = this._nodesatellites[i_np]?.[i_nc];
          const push_satellite = this._pathvector.length === 0 && old !== undefined;
          new_nodesatellite_vector.push(push_satellite && old ? old.clone() : S.clone());
        }
      }
      if (!new_path.empty() && !new_path.closed()) new_nodesatellite_vector.push(S.clone());
      new_nodesatellites.push(new_nodesatellite_vector);
    }
    this.setPathVector(new_pathvector);
    this.setNodeSatellites(new_nodesatellites);
  }
}
