// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/syseq.h
/*
 * Auxiliary routines to solve systems of linear equations in several variants and sizes.
 *
 * Authors:
 *   Maximilian Albert <Anhalter42@gmx.de>
 *
 * Copyright (C) 2007  Authors
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */

export enum SolutionKind {
  unique = 0,
  ambiguous,
  no_solution,
  solution_exists, // FIXME: remove this; does not yield enough information
}

/**
 * Find the element of maximal absolute value in row i that
 * does not lie in one of the columns given in avoid_cols.
 */
function find_pivot(A: number[][], i: number, avoid_cols: readonly number[]): number {
  if (i >= A.length) return -1;
  let pos = -1;
  let max = 0;
  const row = A[i]!;
  for (let j = 0; j < row.length; ++j) {
    if (avoid_cols.includes(j)) continue; // skip "forbidden" columns
    if (Math.abs(row[j]!) > max) {
      pos = j;
      max = Math.abs(row[j]!);
    }
  }
  return pos;
}

/** Performs a single 'exchange step' in the Gauss-Jordan algorithm (i.e., swapping variables in the two vectors). */
function gauss_jordan_step(A: number[][], row: number, col: number): void {
  const S = A.length;
  const T = A[0]!.length;
  const piv = A[row]![col]!; // pivot element
  /* adapt the entries of the matrix, first outside the pivot row/column */
  for (let k = 0; k < S; ++k) {
    if (k === row) continue;
    for (let l = 0; l < T; ++l) {
      if (l === col) continue;
      A[k]![l]! -= (A[k]![col]! * A[row]![l]!) / piv;
    }
  }
  /* now adapt the pivot column ... */
  for (let k = 0; k < S; ++k) {
    if (k === row) continue;
    A[k]![col]! /= piv;
  }
  /* and the pivot row */
  for (let l = 0; l < T; ++l) {
    if (l === col) continue;
    A[row]![l]! /= -piv;
  }
  /* finally, set the element at the pivot position itself */
  A[row]![col] = 1 / piv;
}

/** Perform Gauss-Jordan elimination on the matrix A, optionally avoiding a given column during pivot search */
function gauss_jordan(A: number[][], avoid_col = -1): number[] {
  const cols_used: number[] = [];
  if (avoid_col !== -1) cols_used.push(avoid_col);
  for (let i = 0; i < A.length; ++i) {
    /* for each row find a pivot element of maximal absolute value, skipping the columns that were used before */
    const col = find_pivot(A, i, cols_used);
    cols_used.push(col);
    // no non-zero elements in the row
    if (col === -1) return cols_used;
    /* if pivot search was successful we can perform a Gauss-Jordan step */
    gauss_jordan_step(A, i, col);
  }
  // since the columns that were used will be needed later on, we need to clean up the column vector
  if (avoid_col !== -1) cols_used.shift();
  return cols_used;
}

/* compute the modified value that x[index] needs to assume so that in the end we have x[index]/x[T-1] = val */
function projectify(cols: readonly number[], B: number[][], x: number[], index: number, val: number): number {
  const S = B.length;
  const T = x.length;
  if (index === -1) return val; // FIXME: Is this correct?
  let c = -1;
  for (let i = 0; i < S; ++i) {
    if (cols[i] === T - 1) {
      c = i;
      break;
    }
  }
  if (c === -1) {
    console.error('Something is wrong. Rethink!!');
    return SolutionKind.no_solution;
  }
  let sp = 0;
  for (let j = 0; j < T; ++j) {
    if (j === index) continue;
    sp += B[c]![j]! * x[j]!;
  }
  const mu = 1 - val * B[c]![index]!;
  if (Math.abs(mu) < 1e-6) {
    console.error('No solution since adapted value is too close to zero');
    return SolutionKind.no_solution;
  }
  return (sp * val) / mu;
}

/**
 * Solve the linear system of equations A * x = v where we additionally stipulate
 * x[index] = val if index is not -1 (Gauss-Jordan elimination, so that zero or infinitely many
 * solutions are handled gracefully). With proj, solve x[index]/x[T-1] = val instead (the
 * coordinate of the affine image). x receives the solution.
 */
export function gaussjord_solve(
  A: readonly (readonly number[])[],
  x: number[],
  v: readonly number[],
  index = -1,
  val = 0.0,
  proj = false,
): SolutionKind {
  const S = A.length;
  const T = x.length;
  const B = A.map((row) => [...row]);
  const cols = gauss_jordan(B, index);
  // pivot search failed for some row so the system is not solvable
  if (cols.includes(-1)) return SolutionKind.no_solution;

  /* the vector x is filled with the coefficients of the desired solution vector at appropriate places;
   * the other components are set to zero, and we additionally set x[index] = val if applicable
   */
  for (let j = 0; j < S; ++j) x[cols[j]!] = v[j]!;
  for (let j = 0; j < T; ++j) if (!cols.includes(j)) x[j] = 0;

  // we need to adapt the value if we are in the "projective case" (see above)
  const val_new = proj ? projectify(cols, B, x, index, val) : val;
  // we want the specified coefficient of the solution vector to have a given value
  if (index >= 0 && index < T) x[index] = val_new;

  /* the final solution vector is now obtained as the product B*x, where B is the matrix
   * obtained by Gauss-Jordan manipulation of A
   */
  const w = B.map((row) => row.reduce((sum, b, k) => sum + b * x[k]!, 0));
  for (let j = 0; j < S; ++j) x[cols[j]!] = w[j]!;

  return S + (index === -1 ? 0 : 1) === T ? SolutionKind.unique : SolutionKind.ambiguous;
}
