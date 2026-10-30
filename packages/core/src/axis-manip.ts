// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/axis-manip.cpp, src/axis-manip.h
/*
 * Generic auxiliary routines for 3D axes
 *
 * Authors:
 *   Maximilian Albert <Anhalter42@gmx.de>
 *
 * Copyright (C) 2007 authors
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */

/** Upstream namespace Proj: the axes of projective 3-space. */
export namespace Proj {
  export enum VPState {
    VP_FINITE = 0, // perspective lines meet in the VP
    VP_INFINITE, // perspective lines are parallel
  }

  export enum Axis {
    X = 0,
    Y = 1,
    Z = 2,
    W = 3,
    NONE,
  }

  export const axes = [Axis.X, Axis.Y, Axis.Z, Axis.W] as const;

  export function string_from_axis(axis: Axis): string {
    return ['X', 'Y', 'Z', 'W', 'NONE'][axis] ?? '';
  }

  export function toAffine(axis: Axis): Box3D.Axis {
    switch (axis) {
      case Axis.X:
        return Box3D.Axis.X;
      case Axis.Y:
        return Box3D.Axis.Y;
      case Axis.Z:
        return Box3D.Axis.Z;
      default:
        return Box3D.Axis.NONE;
    }
  }
}

/** Upstream namespace Box3D: axis directions and planes as bit sets. */
export namespace Box3D {
  export const epsilon = 1e-6;

  // The X-/Y-/Z-axis corresponds to the first/second/third digit
  // in binary representation, respectively.
  export enum Axis {
    X = 1,
    Y = 2,
    Z = 4,
    XY = 3,
    XZ = 5,
    YZ = 6,
    XYZ = 7,
    NONE = 0,
  }

  // We use the fourth bit in binary representation
  // to indicate whether a face is front or rear.
  export enum FrontOrRear {
    FRONT = 0,
    REAR = 8,
  }

  export const axes = [Axis.X, Axis.Y, Axis.Z] as const;
  export const planes = [Axis.XY, Axis.XZ, Axis.YZ] as const;
  export const face_positions = [FrontOrRear.FRONT, FrontOrRear.REAR] as const;

  // converts X, Y, Z respectively to 0, 1, 2 (for use as array indices, e.g)
  export function axis_to_int(axis: Axis): number {
    switch (axis) {
      case Axis.X:
        return 0;
      case Axis.Y:
        return 1;
      case Axis.Z:
        return 2;
      default:
        return -1;
    }
  }

  export function toProj(axis: Axis): Proj.Axis {
    switch (axis) {
      case Axis.X:
        return Proj.Axis.X;
      case Axis.Y:
        return Proj.Axis.Y;
      case Axis.Z:
        return Proj.Axis.Z;
      default:
        return Proj.Axis.NONE;
    }
  }

  /*
   * Identify the axes X, Y, Z with the numbers 0, 1, 2.
   * A box's face is identified by the axis perpendicular to it.
   * For a rear face, add 3.
   *
   * Given a bit sequence that unambiguously specifies the face of a box,
   * return a number between 0 and 5 corresponding to that particular face
   * (which is normally used to index an array). Return -1 if the bit sequence
   * does not specify a face. A face can either be given by its plane (e.g, XY)
   * or by the axis that is orthogonal to it (e.g., Z).
   */
  const FACE_TO_INT: Record<number, number> = {
    1: 0,
    2: 1,
    4: 2,
    3: 2,
    5: 1,
    6: 0,
    9: 3,
    10: 4,
    12: 5,
    11: 5,
    13: 4,
    14: 3,
  };
  export function face_to_int(face_id: number): number {
    return FACE_TO_INT[face_id] ?? -1;
  }

  export function int_to_face(id: number): [Axis, FrontOrRear] {
    switch (id) {
      case 0:
        return [Axis.YZ, FrontOrRear.FRONT];
      case 1:
        return [Axis.XZ, FrontOrRear.FRONT];
      case 2:
        return [Axis.XY, FrontOrRear.FRONT];
      case 3:
        return [Axis.YZ, FrontOrRear.REAR];
      case 4:
        return [Axis.XZ, FrontOrRear.REAR];
      case 5:
        return [Axis.XY, FrontOrRear.REAR];
    }
    return [Axis.NONE, FrontOrRear.FRONT]; // should not be reached
  }

  export function is_face_id(face_id: number): boolean {
    return !((face_id & 0x7) === 0x7);
  }

  export function number_of_axis_directions(axis: Axis): number {
    let num = 0;
    if (axis & Axis.X) num++;
    if (axis & Axis.Y) num++;
    if (axis & Axis.Z) num++;
    return num;
  }

  export function is_plane(plane: Axis): boolean {
    return number_of_axis_directions(plane) === 2;
  }

  export function is_single_axis_direction(dir: Axis): boolean {
    // tests whether dir is nonzero and a power of 2
    return !(dir & (dir - 1)) && dir !== 0;
  }

  /** Given two axis directions out of {X, Y, Z} or the corresponding plane, return the remaining one. */
  export function third_axis_direction(dir1: Axis, dir2?: Axis): Axis {
    return dir2 === undefined ? ((dir1 ^ 0x7) as Axis) : (((dir1 + dir2) ^ 0x7) as Axis);
  }

  /* returns the first/second axis direction occurring in the (possibly compound) expression 'dirs' */
  export function extract_first_axis_direction(dirs: Axis): Axis {
    if (dirs & Axis.X) return Axis.X;
    if (dirs & Axis.Y) return Axis.Y;
    if (dirs & Axis.Z) return Axis.Z;
    return Axis.NONE;
  }

  export function extract_second_axis_direction(dirs: Axis): Axis {
    return extract_first_axis_direction((dirs ^ extract_first_axis_direction(dirs)) as Axis);
  }

  export function orth_plane_or_axis(axis: Axis): Axis {
    return (Axis.XYZ ^ axis) as Axis;
  }

  /* returns an axis direction perpendicular to the ones in 'dirs' (if one exists) */
  export function get_perpendicular_axis_direction(dirs: Axis): Axis {
    if (!(dirs & Axis.X)) return Axis.X;
    if (!(dirs & Axis.Y)) return Axis.Y;
    if (!(dirs & Axis.Z)) return Axis.Z;
    return Axis.NONE;
  }

  export function string_from_axes(axis: Axis): string {
    return (axis & Axis.X ? 'X' : '') + (axis & Axis.Y ? 'Y' : '') + (axis & Axis.Z ? 'Z' : '');
  }

  export function get_remaining_axes(axis: Axis): [Axis, Axis] {
    if (!is_single_axis_direction(axis)) return [Axis.NONE, Axis.NONE];
    const plane = orth_plane_or_axis(axis);
    return [extract_first_axis_direction(plane), extract_second_axis_direction(plane)];
  }
}
