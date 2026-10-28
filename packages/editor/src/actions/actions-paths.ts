// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-paths.cpp, src/actions/actions-paths.h
/*
 * Gio::Actions for Path Actions
 *
 * Copyright (C) 2021 Sushant A.A.
 */
import {
  breakApart,
  combine,
  type ObjectSet,
  pathCut,
  pathDiff,
  pathIntersect,
  pathSlice,
  pathSymDiff,
  pathUnion,
} from '@inkscape-web/core';

/**
 * The app.path-* actions by name, without the "app." prefix. They work on
 * the selection and need the path boolop backend (setPathBoolopBackend).
 * TODO: removeLPESRecursive and unlinkRecursive before the operations,
 * the other path actions (fracture, flatten, simplify, offsets, ...).
 */
export const path_actions: Readonly<Record<string, (selection: ObjectSet) => void>> = {
  'path-union': (s) => pathUnion(s),
  'path-difference': (s) => pathDiff(s),
  'path-intersection': (s) => pathIntersect(s),
  'path-exclusion': (s) => pathSymDiff(s),
  'path-division': (s) => pathCut(s),
  'path-cut': (s) => pathSlice(s),
  'path-combine': (s) => combine(s),
  'path-break-apart': (s) => breakApart(s),
  'path-split': (s) => breakApart(s, false, false),
};
