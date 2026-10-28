// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-paint-server-reference.h
/*
 * Reference class for gradients and patterns.
 *
 * Author:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   Jon A. Cruz <jon@joncruz.org>
 *
 * Copyright (C) 1999-2002 Lauris Kaplinski
 * Copyright (C) 2000-2001 Ximian, Inc.
 * Copyright (C) 2010 Authors
 */
import type { SPObject } from './sp-object.ts';
import type { SPPaintServer } from './sp-paint-server.ts';
import { URIReference } from './uri-references.ts';

/** The reference of a fill or stroke url() to a paint server (gradient, pattern, ...). */
export class SPPaintServerReference extends URIReference {
  /**
   * Tells paint servers from other objects. Set by sp-paint-server.ts; this module cannot import
   * it (import cycle: style-internal.ts → here → sp-paint-server.ts → sp-object.ts → style.ts).
   */
  static isPaintServer: (obj: SPObject) => obj is SPPaintServer = (_obj): _obj is SPPaintServer => false;

  /** Shares of the reference by SPIPaint.assign() (upstream: the shared_ptr use count). */
  _shares = 1;

  override getObject(): SPPaintServer | null {
    return super.getObject() as SPPaintServer | null;
  }

  protected override _acceptObject(obj: SPObject): boolean {
    return SPPaintServerReference.isPaintServer(obj) && super._acceptObject(obj);
  }
}
