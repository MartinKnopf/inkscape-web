// SPDX-License-Identifier: LGPL-2.1-only OR MPL-1.1
// Upstream: src/3rdparty/2geom/include/2geom/numeric/fitting-tool.h, src/3rdparty/2geom/include/2geom/numeric/fitting-model.h
/*
 * Authors:
 *   Marco Cecchetti <mrcekets at gmail.com>
 *
 * Copyright 2008 Authors
 */

/**
 * The least squares solution x of rows * x = rhs (upstream: the pseudo-inverse of the matrix times
 * the vector), also the solution of a square system. It uses a QR decomposition (Householder
 * reflections) of the matrix with scaled columns. It throws a RangeError when the matrix has no
 * full rank, where upstream gives the minimum norm solution.
 */
export function solveLeastSquares(rows: readonly (readonly number[])[], rhs: readonly number[]): number[] {
  const m = rows.length;
  const n = rows[0]?.length ?? 0;
  if (m < n) throw new RangeError('too few equations');
  // Scale the columns to norm 1: the columns of a conic fit differ by many orders of magnitude.
  const norms = Array.from({ length: n }, (_, j) => Math.hypot(...rows.map((row) => row[j] as number)));
  if (norms.some((v) => v === 0 || !Number.isFinite(v))) throw new RangeError('singular matrix');
  // The augmented matrix [A | b] in place.
  const a: number[][] = rows.map((row, i) => [
    ...row.map((v, j) => v / (norms[j] as number)),
    rhs[i] as number,
  ]);
  for (let k = 0; k < n; k++) {
    let sigma = 0;
    for (let i = k; i < m; i++) sigma += ((a[i] as number[])[k] as number) ** 2;
    const akk = (a[k] as number[])[k] as number;
    const norm = Math.sqrt(sigma);
    if (norm < 1e-12) throw new RangeError('singular matrix');
    const alpha = akk > 0 ? -norm : norm;
    // The Householder vector v = x - alpha e1; apply I - 2 v v^T / (v^T v) to the columns k..n.
    const v: number[] = [];
    for (let i = k; i < m; i++) v.push((a[i] as number[])[k] as number);
    v[0] = (v[0] as number) - alpha;
    const vv = v.reduce((s, x) => s + x * x, 0);
    if (vv > 0) {
      for (let j = k; j <= n; j++) {
        let dot = 0;
        for (let i = k; i < m; i++) dot += (v[i - k] as number) * ((a[i] as number[])[j] as number);
        const f = (2 * dot) / vv;
        for (let i = k; i < m; i++) {
          const row = a[i] as number[];
          row[j] = (row[j] as number) - f * (v[i - k] as number);
        }
      }
    }
  }
  // R x = Q^T b by back substitution.
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    const row = a[i] as number[];
    if (Math.abs(row[i] as number) < 1e-12) throw new RangeError('singular matrix');
    let sum = row[n] as number;
    for (let j = i + 1; j < n; j++) sum -= (row[j] as number) * (x[j] as number);
    x[i] = sum / (row[i] as number);
  }
  return x.map((v, j) => v / (norms[j] as number));
}
