// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-item.cpp, src/object/sp-item.h
/*
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   bulia byak <buliabyak@users.sf.net>
 *   Johan Engelen <j.b.c.engelen@ewi.utwente.nl>
 *   Abhishek Sharma
 *
 * Copyright (C) 1999-2006 authors
 * Copyright (C) 2001-2002 Ximian, Inc.
 * Copyright (C) 2004 Monash University
 */
import { Affine } from '@inkscape-web/geom';
import { type SPCtx, SPObject } from './sp-object.ts';

/** Update context of items (upstream SPItemCtx). */
export interface SPItemCtx extends SPCtx {
  /** Item to document transformation. */
  i2doc: Affine;
  /** Item to viewport transformation. */
  i2vp: Affine;
}

/**
 * Base class of visible objects (upstream SPItem).
 * TODO: transform attribute, bounding boxes, views (show/hide), sensitivity.
 */
export class SPItem extends SPObject {
  transform: Affine = Affine.identity();
}
