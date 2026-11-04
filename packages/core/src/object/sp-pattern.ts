// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-pattern.cpp, src/object/sp-pattern.h
/*
 * SVG <pattern> implementation
 *
 * Author:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   bulia byak <buliabyak@users.sf.net>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *
 * Copyright (C) 2002 Lauris Kaplinski
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { Affine, Rect } from '@inkscape-web/geom';
import { SPAttr } from '../attributes.ts';
import type { SPDocument } from '../document.ts';
import { sp_svg_transform_read, sp_svg_transform_write } from '../svg/svg-affine.ts';
import { SVGLength } from '../svg/svg-length.ts';
import type { XmlDocument } from '../xml/document.ts';
import { setHrefAttribute } from '../xml/href-attribute-helper.ts';
import type { Node } from '../xml/node.ts';
import {
  spReprCssAttrNew,
  spReprCssChange,
  spReprCssChangeRecursive,
  spReprCssSetProperty,
} from '../xml/repr-css.ts';
import { SPItem } from './sp-item.ts';
import {
  cascadeFlags,
  SP_OBJECT_CHILD_MODIFIED_FLAG,
  SP_OBJECT_MODIFIED_FLAG,
  SP_OBJECT_VIEWPORT_MODIFIED_FLAG,
  SP_OBJECT_WRITE_BUILD,
  type SPCtx,
  type SPObject,
} from './sp-object.ts';
import { SPPaintServer } from './sp-paint-server.ts';
import { PaintServerType } from './sp-paint-server-data.ts';
import { URIReference } from './uri-references.ts';
import { SPViewBox } from './viewbox.ts';

/** The href of a pattern to the pattern it inherits from (upstream SPPatternReference). */
export class SPPatternReference extends URIReference {
  override getObject(): SPPattern | null {
    return super.getObject() as SPPattern | null;
  }
  protected override _acceptObject(obj: SPObject): boolean {
    return obj instanceof SPPattern && super._acceptObject(obj);
  }
}

export enum PatternUnits {
  UNITS_USERSPACEONUSE,
  UNITS_OBJECTBOUNDINGBOX,
}

// do not remove identity transform in pattern elements; when patterns are referenced then linking
// pattern transform overrides root/referenced pattern transform; if it disappears then root transform
// takes over and that's not what we want
function write_transform(transform: Affine): string {
  if (transform.isIdentity()) return 'scale(1)';
  return sp_svg_transform_write(transform) ?? 'scale(1)';
}

/**
 * svg:pattern (upstream SPPattern). The attributes are looked up along the href chain: the
 * first pattern in the chain that sets an attribute gives it, and the first pattern with
 * children (rootPattern()) gives the content. The editor draws the content of the root
 * pattern as an svg:pattern (see DrawingPaintServers).
 */
export class SPPattern extends SPPaintServer {
  readonly vb = new SPViewBox();
  // Reference (href)
  href = '';
  readonly ref: SPPatternReference = new SPPatternReference(this);

  /* patternUnits and patternContentUnits attribute */
  #pattern_units = PatternUnits.UNITS_OBJECTBOUNDINGBOX;
  #pattern_units_set = false;
  #pattern_content_units = PatternUnits.UNITS_USERSPACEONUSE;
  #pattern_content_units_set = false;
  /* patternTransform attribute */
  #pattern_transform = Affine.identity();
  #pattern_transform_set = false;
  /* Tile rectangle */
  readonly #x = new SVGLength();
  readonly #y = new SVGLength();
  readonly #width = new SVGLength();
  readonly #height = new SVGLength();
  #modified_connection: (() => void) | null = null;

  constructor() {
    super();
    // Gets called when the pattern is reattached to another <pattern>
    this.ref.changedSignal.connect((_old, ref) => {
      this.#modified_connection?.();
      this.#modified_connection = null;
      // Gets called when the referenced <pattern> is changed
      if (ref instanceof SPPattern) {
        this.#modified_connection = ref.modifiedSignal.connect(() =>
          this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG),
        );
      }
      this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
    });
  }

  /**
   * Update the children (upstream update), so that their geometry exists for the renderers
   * that draw the pattern tile from the objects (PDF export). TODO: the views.
   */
  protected override update(ctx: SPCtx, flags: number): void {
    const cflags = cascadeFlags(flags);
    for (const c of this.childList()) {
      if (cflags || c.uflags & (SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_CHILD_MODIFIED_FLAG)) {
        c.updateDisplay(ctx, cflags);
      }
    }
  }

  protected override build(doc: SPDocument, repr: Node): void {
    super.build(doc, repr);
    for (const key of [
      SPAttr.PATTERNUNITS,
      SPAttr.PATTERNCONTENTUNITS,
      SPAttr.PATTERNTRANSFORM,
      SPAttr.X,
      SPAttr.Y,
      SPAttr.WIDTH,
      SPAttr.HEIGHT,
      SPAttr.VIEWBOX,
      SPAttr.PRESERVEASPECTRATIO,
      SPAttr.XLINK_HREF,
    ]) {
      this.readAttr(key);
    }
    // TODO: doc->addResource("pattern", this)
  }

  protected override release(): void {
    this.#modified_connection?.();
    this.#modified_connection = null;
    this.ref.detach();
    super.release();
  }

  override set(key: SPAttr, value: string | null): void {
    switch (key) {
      case SPAttr.PATTERNUNITS:
        this.#pattern_units = PatternUnits.UNITS_OBJECTBOUNDINGBOX;
        this.#pattern_units_set = value === 'userSpaceOnUse' || value === 'objectBoundingBox';
        if (value === 'userSpaceOnUse') this.#pattern_units = PatternUnits.UNITS_USERSPACEONUSE;
        break;
      case SPAttr.PATTERNCONTENTUNITS:
        this.#pattern_content_units = PatternUnits.UNITS_USERSPACEONUSE;
        this.#pattern_content_units_set = value === 'userSpaceOnUse' || value === 'objectBoundingBox';
        if (value === 'objectBoundingBox') this.#pattern_content_units = PatternUnits.UNITS_OBJECTBOUNDINGBOX;
        break;
      case SPAttr.PATTERNTRANSFORM: {
        const t = value ? sp_svg_transform_read(value) : null;
        this.#pattern_transform = t ?? Affine.identity();
        this.#pattern_transform_set = !!t;
        break;
      }
      case SPAttr.X:
        this.#x.readOrUnset(value);
        break;
      case SPAttr.Y:
        this.#y.readOrUnset(value);
        break;
      case SPAttr.WIDTH:
        this.#width.readOrUnset(value);
        break;
      case SPAttr.HEIGHT:
        this.#height.readOrUnset(value);
        break;
      case SPAttr.VIEWBOX:
        this.vb.set_viewBox(value);
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_VIEWPORT_MODIFIED_FLAG);
        return;
      case SPAttr.PRESERVEASPECTRATIO:
        this.vb.set_preserveAspectRatio(value);
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_VIEWPORT_MODIFIED_FLAG);
        return;
      case SPAttr.XLINK_HREF:
        if (!value) {
          if (!this.href) break;
          this.href = '';
          this.ref.detach();
        } else {
          if (this.href === value) break;
          this.href = value;
          // Attempt to attach ref, which emits the changed signal.
          if (!this.ref.try_attach(value)) this.href = '';
        }
        break;
      default:
        super.set(key, value);
        return;
    }
    this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
  }

  protected override childAdded(child: Node, ref: Node | null): void {
    super.childAdded(child, ref);
    this.requestModified(SP_OBJECT_MODIFIED_FLAG);
  }

  protected override removeChild(child: Node): void {
    super.removeChild(child);
    this.requestModified(SP_OBJECT_MODIFIED_FLAG);
  }

  override write(xmlDoc: XmlDocument, repr: Node | null, flags: number): Node | null {
    if (flags & SP_OBJECT_WRITE_BUILD && !repr) repr = xmlDoc.createElement('svg:pattern');
    return super.write(xmlDoc, repr, flags);
  }

  override getPaintType(): PaintServerType {
    return PaintServerType.PATTERN;
  }

  /** The patterns of the href chain, starting with this one; stops at a cycle. */
  *#chain(): Generator<SPPattern> {
    const seen = new Set<SPPattern>();
    for (let p: SPPattern | null = this; p && !seen.has(p); p = p.ref.getObject()) {
      seen.add(p);
      yield p;
    }
  }

  // Access functions that look up fields up the chain of referenced patterns and return the first one which is set

  patternUnits(): PatternUnits {
    for (const p of this.#chain()) if (p.#pattern_units_set) return p.#pattern_units;
    return this.#pattern_units;
  }
  patternContentUnits(): PatternUnits {
    for (const p of this.#chain()) if (p.#pattern_content_units_set) return p.#pattern_content_units;
    return this.#pattern_content_units;
  }
  getTransform(): Affine {
    for (const p of this.#chain()) if (p.#pattern_transform_set) return p.#pattern_transform;
    return this.#pattern_transform;
  }
  get_this_transform(): Affine {
    return this.#pattern_transform;
  }
  #length(get: (p: SPPattern) => SVGLength): number {
    for (const p of this.#chain()) if (get(p)._set) return get(p).computed;
    return 0;
  }
  x(): number {
    return this.#length((p) => p.#x);
  }
  y(): number {
    return this.#length((p) => p.#y);
  }
  width(): number {
    return this.#length((p) => p.#width);
  }
  height(): number {
    return this.#length((p) => p.#height);
  }
  getBox(): Rect {
    return Rect.fromXywh(this.x(), this.y(), this.width(), this.height());
  }
  viewbox(): Rect | null {
    for (const p of this.#chain()) if (p.vb.viewBox_set) return p.vb.viewBox;
    return null;
  }
  /** The preserveAspectRatio attribute from the chain, or null. */
  preserveAspectRatio(): string | null {
    for (const p of this.#chain()) {
      const v = p.getAttribute('preserveAspectRatio');
      if (v) return v;
    }
    return null;
  }

  /** The first pattern of the chain with children: the one whose content is drawn. */
  rootPattern(): SPPattern {
    for (const p of this.#chain()) if (p.firstChild()) return p; // find the first one with children
    // document is broken, we can't get to root; but at least we can return ourself which is supposedly a valid pattern
    return this;
  }

  hasItemChildren(): boolean {
    return this.children.some((c) => c instanceof SPItem);
  }

  override isValid(): boolean {
    return this.width() > 0 && this.height() > 0;
  }

  /** Count how many times pattern is used by the styles of o and its descendants */
  #countHrefs(o: SPObject | null): number {
    if (!o) return 1;
    let i = 0;
    if (o.style.getFillPaintServer() === this) i++;
    if (o.style.getStrokePaintServer() === this) i++;
    for (const child of o.children) i += this.#countHrefs(child);
    return i;
  }

  /** A new pattern in the defs that references this one (upstream _chain). */
  #chain_new(): SPPattern {
    const doc = this.document;
    const repr = doc.getReprDoc().createElement('svg:pattern');
    repr.setAttribute('inkscape:collect', 'always');
    setHrefAttribute(repr, `#${this.getId()}`);
    // this attribute is used to express uniform pattern scaling in pattern editor, so keep it
    repr.setAttribute('preserveAspectRatio', this.getAttribute('preserveAspectRatio'));
    doc.getDefs()?.getRepr().appendChild(repr);
    return doc.getObjectByRepr(repr) as SPPattern;
  }

  /**
   * A pattern of item's property ("fill" or "stroke") that only item uses: this one, or a new
   * pattern that references this one and that item's style now uses.
   */
  clone_if_necessary(item: SPItem, property: 'fill' | 'stroke'): SPPattern {
    let pattern: SPPattern = this;
    if (!pattern.href || pattern.hrefcount > this.#countHrefs(item)) {
      pattern = this.#chain_new();
      const css = spReprCssAttrNew();
      spReprCssSetProperty(css, property, `url(#${pattern.getId()})`);
      spReprCssChangeRecursive(item.getRepr(), css, 'style');
    }
    return pattern;
  }

  /** Set the patternTransform to postmul, or (set false) multiply it by postmul. */
  transform_multiply(postmul: Affine, set: boolean): void {
    // this formula is for a different interpretation of pattern transforms as described in (*) in sp-pattern.cpp
    // for it to work, we also need    sp_object_read_attr( item, "transform");
    // otherwise the formula is much simpler
    this.#pattern_transform = set ? postmul : this.getTransform().multiply(postmul);
    this.#pattern_transform_set = true;
    this.setAttributeOrRemoveIfEmpty('patternTransform', write_transform(this.#pattern_transform));
  }

  /**
   * Create a new pattern in the defs with copies of reprs as content, tile size bounds,
   * patternTransform transform; move is applied to the copies. Returns the pattern id.
   */
  static produce(
    reprs: readonly Node[],
    bounds: Rect,
    document: SPDocument,
    transform: Affine,
    move: Affine,
  ): string {
    const repr = document.getReprDoc().createElement('svg:pattern');
    repr.setAttribute('patternUnits', 'userSpaceOnUse');
    repr.setAttributeSvgDouble('width', bounds.width());
    repr.setAttributeSvgDouble('height', bounds.height());
    repr.setAttributeOrRemoveIfEmpty('patternTransform', write_transform(transform));
    // by default use uniform scaling
    repr.setAttribute('preserveAspectRatio', 'xMidYMid');
    document.getDefs()?.getRepr().appendChild(repr);
    const pd = repr.attribute('id') ?? '';
    const pat_object = document.getObjectById(pd) as SPPattern;
    let can_colorize = false;
    for (const node of reprs) {
      const copy = pat_object.appendChildRepr(node.duplicate(document.getReprDoc()));
      if (!(copy instanceof SPItem)) continue;
      if (!repr.attribute('inkscape:label') && node.attribute('inkscape:label')) {
        repr.setAttribute('inkscape:label', node.attribute('inkscape:label'));
      }
      // if some elements have undefined color or solid black, then their fill color is customizable
      const fill = copy.style.fill;
      if (fill.set) {
        if (fill.isColor() && fill.getColor()?.toRGBA() === 255) {
          // black color set?
          can_colorize = true;
          // remove black fill, it will be inherited from pattern
          const css = spReprCssAttrNew();
          spReprCssSetProperty(css, 'fill', null);
          spReprCssChange(copy.getRepr(), css, 'style');
          copy.removeAttribute('fill');
        }
      } else {
        // no color - it will be inherited
        can_colorize = true;
      }
      const dup_transform = sp_svg_transform_read(node.attribute('transform') ?? '') ?? Affine.identity();
      copy.doWriteTransform(dup_transform.multiply(move), null, false);
    }
    // add black fill style to the pattern object - it will tell pattern editor to enable color selector
    if (can_colorize && !pat_object.style.fill.set) {
      const css = spReprCssAttrNew();
      spReprCssSetProperty(css, 'fill', 'black');
      spReprCssChange(repr, css, 'style');
    }
    return pd;
  }
}
