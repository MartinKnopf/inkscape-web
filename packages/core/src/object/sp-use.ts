// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-use.cpp, src/object/sp-use.h
/*
 * SVG <use> implementation
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   bulia byak <buliabyak@users.sf.net>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *
 * Copyright (C) 1999-2005 authors
 * Copyright (C) 2000-2001 Ximian, Inc.
 */
import { Affine, type OptRect, Translate } from '@inkscape-web/geom';
import { SPAttr } from '../attributes.ts';
import type { Drawing, DrawingGroup, DrawingItem } from '../display/drawing.ts';
import type { SPDocument } from '../document.ts';
import { _ } from '../i18n.ts';
import { Preferences } from '../preferences.ts';
import { SVGLengthUnit } from '../svg/svg-length.ts';
import type { XmlDocument } from '../xml/document.ts';
import { getHrefAttribute } from '../xml/href-attribute-helper.ts';
import type { Node } from '../xml/node.ts';
import { SPDimensions } from './sp-dimensions.ts';
import { type BBoxType, SPItem, type SPItemCtx } from './sp-item.ts';
import {
  cascadeFlags,
  factoryCreateObject,
  getTypeString,
  SP_OBJECT_CHILD_MODIFIED_FLAG,
  SP_OBJECT_MODIFIED_CASCADE,
  SP_OBJECT_MODIFIED_FLAG,
  SP_OBJECT_PARENT_MODIFIED_FLAG,
  SP_OBJECT_STYLE_MODIFIED_FLAG,
  SP_OBJECT_USER_MODIFIED_FLAG_B,
  SP_OBJECT_WRITE_BUILD,
  type SPCtx,
} from './sp-object.ts';
import { SPShape } from './sp-shape.ts';
import { SPUseReference } from './sp-use-reference.ts';
import { BadURIException } from './uri-references.ts';

/** Values of /options/clonecompensation/value (upstream enums.h). */
export enum SPCloneCompensation {
  SP_CLONE_COMPENSATION_PARALLEL,
  SP_CLONE_COMPENSATION_UNMOVED,
  SP_CLONE_COMPENSATION_NONE,
}

/** Values of /options/cloneorphans/value (upstream enums.h). */
export enum SPCloneOrphans {
  SP_CLONE_ORPHANS_UNLINK,
  SP_CLONE_ORPHANS_DELETE,
  SP_CLONE_ORPHANS_KEEP,
}

let descriptionDepth = 0;

/**
 * svg:use, a clone (upstream SPUse). The child is an item built from the
 * original's repr (cloned = true): it follows the changes of the original and
 * is shown in the views of the use, like the child of a group.
 *
 * TODO: symbols, flowtext regions, clip and mask compensation in
 * move_compensate(), tmp successors and LPE forking in unlink(), snap points,
 * documentExactBounds, print.
 */
export class SPUse extends SPItem {
  /** Item built from the original's repr (the visible clone). */
  child: SPItem | null = null;
  /** The href attribute. */
  href: string | null = null;
  /** The reference to the original object. */
  readonly ref = new SPUseReference(this);
  readonly dims = new SPDimensions();

  #delete_connection: (() => void) | null = null;
  readonly #changed_connection: () => void;
  #transformed_connection: (() => void) | null = null;

  constructor() {
    super();
    this.dims.x.unset();
    this.dims.y.unset();
    this.dims.width.unset(SVGLengthUnit.PERCENT, 1.0, 1.0);
    this.dims.height.unset(SVGLengthUnit.PERCENT, 1.0, 1.0);
    this.#changed_connection = this.ref.changedSignal.connect(() => this.#href_changed());
  }

  get x() {
    return this.dims.x;
  }
  get y() {
    return this.dims.y;
  }
  get width() {
    return this.dims.width;
  }
  get height() {
    return this.dims.height;
  }

  protected override build(document: SPDocument, repr: Node): void {
    super.build(document, repr);
    this.readAttr(SPAttr.X);
    this.readAttr(SPAttr.Y);
    this.readAttr(SPAttr.WIDTH);
    this.readAttr(SPAttr.HEIGHT);
    this.readAttr(SPAttr.XLINK_HREF);

    // We don't need to create child here:
    // reading xlink:href will attach ref, and that will cause the changed signal to be emitted,
    // which will call SPUse::href_changed, and that will take care of the child
  }

  protected override release(): void {
    if (this.child) {
      this.detach(this.child);
      this.child = null;
    }
    this.#delete_connection?.();
    this.#delete_connection = null;
    this.#changed_connection();
    this.#transformed_connection?.();
    this.#transformed_connection = null;
    this.href = null;
    this.ref.detach();
    super.release();
  }

  override set(key: SPAttr, value: string | null): void {
    switch (key) {
      case SPAttr.X:
        this.x.readOrUnset(value);
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.Y:
        this.y.readOrUnset(value);
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.WIDTH:
        this.width.readOrUnset(value, SVGLengthUnit.PERCENT, 1.0, 1.0);
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.HEIGHT:
        this.height.readOrUnset(value, SVGLengthUnit.PERCENT, 1.0, 1.0);
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.XLINK_HREF:
        if (value && this.href && value === this.href) {
          /* No change, do nothing. */
        } else {
          this.href = null;
          if (value) {
            // First, set the href field, because SPUse::href_changed will need it.
            this.href = value;
            // Now do the attaching, which emits the changed signal.
            try {
              this.ref.attach(value);
            } catch (e) {
              if (!(e instanceof BadURIException)) throw e;
              console.warn(e.message);
              this.ref.detach();
            }
          } else {
            this.ref.detach();
          }
        }
        break;
      default:
        super.set(key, value);
        break;
    }
  }

  override write(xmlDoc: XmlDocument, repr: Node | null, flags: number): Node | null {
    if (flags & SP_OBJECT_WRITE_BUILD && !repr) repr = xmlDoc.createElement('svg:use');
    if (!repr) return null;

    super.write(xmlDoc, repr, flags);
    this.dims.writeDimensions(repr);

    const uri = this.ref.getURI();
    if (uri) repr.setAttribute(getHrefAttribute(repr)[0], uri || null);

    // TODO: text and flowtext children (rebuildLayout).
    if (this.child instanceof SPShape) this.child.set_shape(); // evaluate curve of child

    return repr;
  }

  override bbox(transform: Affine, bboxtype: BBoxType): OptRect {
    if (!this.child) return null;
    const ct = this.child.transform.multiply(Translate(this.x.computed, this.y.computed)).multiply(transform);
    return this.child.bounds(bboxtype, ct);
  }

  /** TODO: "symbol" for symbols. */
  override typeName(): string {
    return 'clone';
  }
  override displayName(): string {
    return _('Clone');
  }
  override description(): string {
    if (!this.child) return _('[orphaned]');
    if (descriptionDepth >= 4) {
      /* TRANSLATORS: Used for statusbar description for long <use> chains:
       * "Clone of: Clone of: ... in Layer 1". */
      return _('...');
      /* We could do better, e.g. chasing the href chain until we reach something other than
       * a <use>, and giving its description. */
    }
    ++descriptionDepth;
    const child_desc = this.child.detailedDescription();
    --descriptionDepth;
    return _('of: %s').replace('%s', child_desc);
  }

  protected override show(drawing: Drawing, key: number, flags: number): DrawingItem {
    const ai = drawing.createGroup();
    ai.setPickChildren(false);
    this.context_style = this.style;
    ai.setStyle(this.style, this.context_style);

    if (this.child) {
      const ac = this.child.invokeShow(drawing, key, flags);
      if (ac) ai.prependChild(ac);
      ai.setChildTransform(Translate(this.x.computed, this.y.computed));
    }
    return ai;
  }

  protected override hide(key: number): void {
    this.child?.invokeHide(key);
  }

  /**
   * Returns the ultimate original of a SPUse (i.e. the first object in the chain of its originals
   * which is not an SPUse). If no original is found, null is returned.
   *
   * Note that the returned is the clone object, i.e. the child of an SPUse (of the argument one for
   * the trivial case) and not the "true original". If you want the true original, use trueOriginal().
   */
  root(): SPItem | null {
    let orig = this.child;
    while (orig instanceof SPUse) orig = orig.child;
    return orig;
  }

  /**
   * Returns the ultimate original of a SPUse, i.e., the first object in the chain of uses
   * which is not itself an SPUse. If the chain of references is broken or no original is found,
   * the return value will be null.
   */
  trueOriginal(): SPItem | null {
    const depth = this.cloneDepth();
    if (depth < 0) return null;
    let original_item: SPItem | null = this;
    for (let i = 0; i < depth; ++i) {
      if (original_item instanceof SPUse) original_item = original_item.get_original();
      else return null;
    }
    return original_item;
  }

  /**
   * Get the number of dereferences or calls to get_original() needed to get an object
   * which is not an svg:use. Returns -1 if there is no original object.
   */
  cloneDepth(): number {
    let depth = 1;
    let orig = this.child;
    while (orig instanceof SPUse) {
      ++depth;
      orig = orig.child;
    }
    return orig ? depth : -1;
  }

  /**
   * Returns the effective transform that goes from the ultimate original to given SPUse, both ends
   * included.
   */
  get_root_transform(): Affine {
    //track the ultimate source of a chain of uses
    const chain: SPItem[] = [this];
    let orig = this.child;
    while (orig instanceof SPUse) {
      chain.push(orig);
      orig = orig.child;
    }
    if (orig) chain.push(orig);

    // calculate the accumulated transform, starting from the original
    let t = Affine.identity();
    for (const i_tem of chain.reverse()) {
      // "An additional transformation translate(x,y) is appended to the end (i.e.,
      // right-side) of the transform attribute on the generated 'g', where x and y
      // represent the values of the x and y attributes on the 'use' element." - http://www.w3.org/TR/SVG11/struct.html#UseElement
      if (i_tem instanceof SPUse && i_tem.has_xy_offset()) t = t.multiply(i_tem.get_xy_offset());
      t = t.multiply(i_tem.transform);
    }
    return t;
  }

  /**
   * Returns the transform that leads to the use from its immediate original.
   * Does not include the original's transform if any.
   */
  get_parent_transform(): Affine {
    let t = Affine.identity();
    if (this.has_xy_offset()) t = t.multiply(this.get_xy_offset());
    return t.multiply(this.transform);
  }

  has_xy_offset(): boolean {
    return (this.x._set && this.x.computed !== 0) || (this.y._set && this.y.computed !== 0);
  }

  get_xy_offset(): Affine {
    return Translate(this.x._set ? this.x.computed : 0, this.y._set ? this.y.computed : 0);
  }

  get_original(): SPItem | null {
    return this.ref.getObject();
  }

  // A clone's child is the ghost of its original - we must not touch it, skip recursion
  override adjustStrokeWidthRecursive(expansion: number): void {
    this.adjustStroke(expansion);
  }
  override freezeStrokeWidthRecursive(freeze: boolean): void {
    this.freeze_stroke_width = freeze;
  }

  /**
   * Sensing a movement of the original, this function attempts to compensate for it in such a way
   * that the clone stays unmoved or moves in parallel (depending on user setting) regardless of the
   * clone's transform.
   */
  #move_compensate(mp: Affine): void {
    // the clone is orphaned; or this is not a real use, but a clone of another use;
    // we skip it, otherwise duplicate compensation will occur
    if (this.cloned) return;

    // TODO: never compensate uses which are used in flowtext

    const mode = Preferences.get().getInt(
      '/options/clonecompensation/value',
      SPCloneCompensation.SP_CLONE_COMPENSATION_PARALLEL,
    );
    // user wants no compensation
    if (mode === SPCloneCompensation.SP_CLONE_COMPENSATION_NONE) return;

    const m = mp;
    const t = this.get_parent_transform();
    let clone_move = t.inverse().multiply(m).multiply(t);

    // this is not a simple move, do not try to compensate
    // TODO: move clip paths and masks accordingly.
    if (!m.isTranslation()) return;

    // restore item->transform field from the repr, in case it was changed by seltrans
    this.readAttr(SPAttr.TRANSFORM);

    // calculate the compensation matrix and the advertized movement matrix
    let advertized_move: Affine;
    if (mode === SPCloneCompensation.SP_CLONE_COMPENSATION_PARALLEL) {
      clone_move = clone_move.inverse().multiply(m);
      advertized_move = m;
    } else {
      clone_move = clone_move.inverse();
      advertized_move = Affine.identity();
    }

    // TODO: move clip paths and masks by clone_move.inverse().

    // commit the compensation
    this.transform = this.transform.multiply(clone_move);
    this.doWriteTransform(this.transform, advertized_move);
    this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
  }

  #href_changed(): void {
    this.#delete_connection?.();
    this.#delete_connection = null;
    this.#transformed_connection?.();
    this.#transformed_connection = null;

    if (this.child) {
      this.detach(this.child);
      this.child = null;
    }

    if (!this.href) return;
    const refobj = this.ref.getObject();
    if (!refobj) return;

    const childrepr = refobj.getRepr();
    const obj = factoryCreateObject(getTypeString(childrepr));
    if (!(obj instanceof SPItem)) return;

    this.child = obj;
    this.attach(obj, this.lastChild());
    obj.invokeBuild(refobj.document, childrepr, true);

    for (const v of this.views) {
      const ai = obj.invokeShow(v.drawing, v.key, v.flags);
      if (ai) v.drawingitem.prependChild(ai);
    }

    this.#delete_connection = refobj.deleteSignal.connect(() => this.#delete_self());
    this.#transformed_connection = refobj.transformedSignal.connect((mp) => this.#move_compensate(mp));
  }

  #delete_self(): void {
    // TODO: always delete uses which are used in flowtext
    const mode = Preferences.get().getInt(
      '/options/cloneorphans/value',
      SPCloneOrphans.SP_CLONE_ORPHANS_UNLINK,
    );
    if (mode === SPCloneOrphans.SP_CLONE_ORPHANS_UNLINK) {
      this.unlink();
    } else if (mode === SPCloneOrphans.SP_CLONE_ORPHANS_DELETE) {
      this.deleteObject();
    }
  }

  protected override update(ctx: SPCtx, flags: number): void {
    const ictx = ctx as SPItemCtx;
    const cctx = { ...ictx };

    let childflags = flags;
    if (flags & SP_OBJECT_MODIFIED_FLAG) childflags |= SP_OBJECT_PARENT_MODIFIED_FLAG;
    childflags &= SP_OBJECT_MODIFIED_CASCADE;

    /* Set up child viewport */
    this.dims.calcDimsFromParentViewport(ictx);

    childflags &= ~SP_OBJECT_USER_MODIFIED_FLAG_B;

    const child = this.child;
    if (child && (childflags || child.uflags & (SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_CHILD_MODIFIED_FLAG))) {
      cctx.i2doc = child.transform.multiply(ictx.i2doc);
      cctx.i2vp = child.transform.multiply(ictx.i2vp);
      child.updateDisplay(cctx, childflags);
    }

    super.update(ctx, flags);

    if (flags & SP_OBJECT_STYLE_MODIFIED_FLAG) {
      for (const v of this.views) {
        this.context_style = this.style;
        v.drawingitem.setStyle(this.style, this.context_style);
      }
    }

    /* As last step set additional transform of arena group */
    for (const v of this.views) {
      (v.drawingitem as DrawingGroup).setChildTransform(Translate(this.x.computed, this.y.computed));
    }
  }

  protected override modified(flags: number): void {
    flags = cascadeFlags(flags);

    if (flags & SP_OBJECT_STYLE_MODIFIED_FLAG) {
      for (const v of this.views) {
        this.context_style = this.style;
        v.drawingitem.setStyle(this.style, this.context_style);
      }
    }

    const child = this.child;
    if (child && (flags || child.mflags & (SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_CHILD_MODIFIED_FLAG))) {
      child.emitModified(flags);
    }
  }

  /**
   * Replace the clone by a copy of its ultimate original, with the clone's
   * id, style and accumulated transform. Returns the copy, or null if the
   * clone has no original.
   */
  unlink(): SPItem | null {
    const repr = this.getRepr();
    const parent = repr.parent();
    if (!parent) return null;
    const document = this.document;
    const xml_doc = document.getReprDoc();

    // Track the ultimate source of a chain of uses.
    const orig = this.root();
    if (!orig) return null;

    // Calculate the accumulated transform, starting from the original.
    const t = this.get_root_transform();

    // TODO: symbols (make a group, copy children, viewBox transformation).
    const copy = orig.getRepr().duplicate(xml_doc);
    copy.setAttribute('display', 'none');
    // Add the duplicate repr just after the existing one.
    parent.addChild(copy, repr);

    // Retrieve the SPItem of the resulting repr.
    const unlinked = document.getObjectByRepr(copy);
    if (!(unlinked instanceof SPItem)) return null;
    // TODO: tmp successors of the true original, forking of path effects.

    // Merge style from the use.
    unlinked.style.merge(this.style);
    if (unlinked.parent) unlinked.style.cascade(unlinked.parent.style);
    unlinked.updateRepr();
    unlinked.removeAttribute('display');

    // Remove ourselves, not propagating delete events to avoid a
    // chain-reaction with other elements that might reference us.
    const id = repr.attribute('id');
    this.deleteObject(false);

    // Give the copy our old id.
    copy.setAttribute('id', id);

    // Remove tiled clone attrs.
    copy.removeAttribute('inkscape:tiled-clone-of');
    copy.removeAttribute('inkscape:tile-w');
    copy.removeAttribute('inkscape:tile-h');
    copy.removeAttribute('inkscape:tile-cx');
    copy.removeAttribute('inkscape:tile-cy');

    // TODO: this.setSuccessor(unlinked).

    // Set the accummulated transform.
    // Advertise ourselves as not moving.
    unlinked.doWriteTransform(t, Affine.identity());
    return unlinked;
  }
}
