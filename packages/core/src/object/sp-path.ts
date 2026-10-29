// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-path.cpp, src/object/sp-path.h
/*
 * SVG <path> implementation
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   David Turner <novalis@gnu.org>
 *   Abhishek Sharma
 *   Johan Engelen
 *
 * Copyright (C) 2004 David Turner
 * Copyright (C) 1999-2002 Lauris Kaplinski
 * Copyright (C) 2000-2001 Ximian, Inc.
 * Copyright (C) 1999-2012 Authors
 */
import { Affine, PathVector } from '@inkscape-web/geom';
import { SPAttr } from '../attributes.ts';
import type { SPDocument } from '../document.ts';
import { _, ngettext } from '../i18n.ts';
import { node_count } from '../path/path-curve.ts';
import { SPStyleSrc } from '../style-internal.ts';
import { sp_svg_read_pathv, sp_svg_write_path } from '../svg/svg-path.ts';
import type { XmlDocument } from '../xml/document.ts';
import type { Node } from '../xml/node.ts';
import { spReprCssAttr, spReprCssSet, spReprCssUnsetProperty } from '../xml/repr-css.ts';
import { lpeItemClasses, sp_lpe_item_update_patheffect } from './sp-lpe-item.ts';
import {
  SP_OBJECT_MODIFIED_FLAG,
  SP_OBJECT_STYLE_MODIFIED_FLAG,
  SP_OBJECT_USER_MODIFIED_FLAG_B,
  SP_OBJECT_VIEWPORT_MODIFIED_FLAG,
  SP_OBJECT_WRITE_BUILD,
  SP_OBJECT_WRITE_EXT,
  type SPCtx,
} from './sp-object.ts';
import { SPShape } from './sp-shape.ts';

/**
 * svg:path (upstream SPPath).
 * With a path effect, inkscape:original-d is the path before the effects (curveBeforeLPE()).
 * TODO: markers, connectors (connEndPair), convert_to_guides, removeTransformsRecursively.
 */
export class SPPath extends SPShape {
  nodesInPath(): number {
    return this._curve ? node_count(this._curve) : 0;
  }

  override typeName(): string {
    return 'path';
  }
  override displayName(): string {
    return _('Path');
  }
  override description(): string {
    const count = this.nodesInPath();
    let lpe_desc = '';
    if (this.hasPathEffect()) {
      const names: string[] = [];
      for (const it of this.getEffectList()) {
        const lpe = it.lpeobject?.get_lpe();
        if (!lpe) break;
        names.push(lpe.getName());
      }
      lpe_desc = _(', path effect: %s').replace('%s', names.join(', '));
    }
    return ngettext('%i node%s', '%i nodes%s', count).replace('%i', String(count)).replace('%s', lpe_desc);
  }

  protected override build(document: SPDocument, repr: Node): void {
    super.build(document, repr);
    // Our code depends on 'd' being an attribute (LPE's, etc.). To support 'd' as a property, we
    // check it here (after the style property has been evaluated, this allows us to properly
    // handled precedence of property vs attribute). If we read in a 'd' set by styling, convert it
    // to an attribute. We'll convert it back on output.
    const dSource = this.style.d.style_src;
    if (this.style.d.set && (dSource === SPStyleSrc.STYLE_PROP || dSource === SPStyleSrc.STYLE_SHEET)) {
      const dVal = this.style.d.value();
      // Chrome shipped with a different syntax for property vs attribute.
      // The property syntax wraps the path data with "path(...)". We must strip that!
      const match = dVal ? /path\("(.*)"\)/.exec(dVal) : null;
      if (match) {
        const value = match[1] ?? '';
        this.setCurveInsync(sp_svg_read_pathv(value));
        // Convert from property to attribute (convert back on write)
        this.setAttributeOrRemoveIfEmpty('d', value);
        const css = spReprCssAttr(this.repr, 'style');
        spReprCssUnsetProperty(css, 'd');
        spReprCssSet(this.repr, css, 'style');
        this.style.d.style_src = SPStyleSrc.ATTRIBUTE;
      }
    }

    this.readAttr(SPAttr.INKSCAPE_ORIGINAL_D);
    this.readAttr(SPAttr.D);

    /* d is a required attribute */
    if (this.getAttribute('d') === null) {
      // First see if calculating the path effect will generate "d":
      this.update_patheffect(true);
      // I guess that didn't work, now we have nothing useful to write ("")
      if (this.getAttribute('d') === null) this.setKeyValue(SPAttr.D, '');
    }
  }

  override set(key: SPAttr, value: string | null): void {
    switch (key) {
      case SPAttr.INKSCAPE_ORIGINAL_D:
        this.setCurveBeforeLPE(value !== null ? sp_svg_read_pathv(value) : null);
        break;
      case SPAttr.D:
        this.setCurve(value !== null ? sp_svg_read_pathv(value) : null);
        break;
      default:
        super.set(key, value);
        break;
    }
  }

  override write(xmlDoc: XmlDocument, repr: Node | null, flags: number): Node | null {
    if (flags & SP_OBJECT_WRITE_BUILD && !repr) repr = xmlDoc.createElement('svg:path');
    if (repr) {
      if (this._curve) repr.setAttribute('d', sp_svg_write_path(this._curve));
      else repr.removeAttribute('d');
      if (flags & SP_OBJECT_WRITE_EXT) {
        if (this._curve_before_lpe)
          repr.setAttribute('inkscape:original-d', sp_svg_write_path(this._curve_before_lpe));
        else repr.removeAttribute('inkscape:original-d');
      }
    }
    return super.write(xmlDoc, repr, flags);
  }

  protected override update(ctx: SPCtx, flags: number): void {
    if (
      flags &
      (SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_STYLE_MODIFIED_FLAG | SP_OBJECT_VIEWPORT_MODIFIED_FLAG)
    ) {
      flags &= ~SP_OBJECT_USER_MODIFIED_FLAG_B; // since we change the description, it's not a "just translation" anymore
    }
    super.update(ctx, flags);
  }

  /** Bake the transform into the path data; the stroke width is scaled with it. */
  override setTransform(transform: Affine): Affine {
    if (!this._curve) return Affine.identity(); // 0 nodes, nothing to transform
    if (this.pathEffectsEnabled() && !this.optimizeTransforms()) return transform;
    if (this.hasPathEffectRecursive() && this.pathEffectsEnabled()) {
      if (!this._curve_before_lpe) {
        // we are inside a LPE group creating a new element
        // and the original-d curve is not defined,
        // This fix a issue with calligrapic tool that make a transform just when draw
        this.setCurveBeforeLPE(this._curve);
      }
      this.setCurveBeforeLPE(PathVector.transformed(this._curve_before_lpe ?? this._curve, transform));
      // fix issue https://gitlab.com/inkscape/inbox/-/issues/5460
      sp_lpe_item_update_patheffect(this, false, false);
    } else {
      this.setCurve(PathVector.transformed(this._curve, transform));
    }
    // Adjust stroke
    this.adjustStroke(transform.descrim());
    // TODO: adjust pattern and gradient fill.

    // nothing remains - we've written all of the transform, so return identity
    return Affine.identity();
  }
}

lpeItemClasses.SPPath = SPPath;
