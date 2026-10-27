// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-item.cpp, src/object/sp-item.h
/*
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   bulia byak <buliabyak@users.sf.net>
 *   Johan Engelen <j.b.c.engelen@ewi.utwente.nl>
 *   Abhishek Sharma
 *   Jon A. Cruz <jon@joncruz.org>
 *
 * Copyright (C) 2001-2006 authors
 * Copyright (C) 2001 Ximian, Inc.
 * Copyright (C) 2004 Monash University
 */
import { Affine, are_near, type OptRect, Rect } from '@inkscape-web/geom';
import { SPAttr } from '../attributes.ts';
import { Color } from '../colors/color.ts';
import type { Drawing, DrawingItem } from '../display/drawing.ts';
import type { SPDocument } from '../document.ts';
import { _ } from '../i18n.ts';
import { Preferences } from '../preferences.ts';
import { SPCSSDisplay, SPIsolation, SPShapeRendering } from '../style-enums.ts';
import { svgNumber } from '../svg/stringstream.ts';
import { sp_svg_transform_read, sp_svg_transform_write } from '../svg/svg-affine.ts';
import { Signal } from '../util/signal.ts';
import type { XmlDocument } from '../xml/document.ts';
import type { Node } from '../xml/node.ts';
import {
  SP_OBJECT_CHILD_MODIFIED_FLAG,
  SP_OBJECT_MODIFIED_FLAG,
  SP_OBJECT_STYLE_MODIFIED_FLAG,
  SP_OBJECT_USER_MODIFIED_FLAG_B,
  SP_OBJECT_WRITE_EXT,
  type SPCtx,
  SPObject,
} from './sp-object.ts';

/**
 * A view of an item in one Drawing (upstream SPItemView).
 * `drawing` is extra: upstream gets it from drawingitem->drawing().
 */
export interface SPItemView {
  flags: number;
  key: number;
  drawingitem: DrawingItem;
  drawing: Drawing;
}

/** Offsets from the key of a drawing item for its clip, mask, paint and marker views. */
export enum SPItemKey {
  ITEM_KEY_CLIP,
  ITEM_KEY_MASK,
  ITEM_KEY_FILL,
  ITEM_KEY_STROKE,
  ITEM_KEY_MARKERS,
  /** ITEM_KEY_MARKERS + SP_MARKER_LOC_QTY (4, see sp-marker-loc.h) */
  ITEM_KEY_SIZE = 8,
}

export const SP_ITEM_BBOX_VISUAL = 1;
export const SP_ITEM_SHOW_DISPLAY = 1 << 0;
/** Flag for referenced views (markers, clip paths, masks, patterns); does the same as DISPLAY. */
export const SP_ITEM_REFERENCE_FLAGS = 1 << 1;

/** Update context of items (upstream SPItemCtx). */
export interface SPItemCtx extends SPCtx {
  /** Item to document transformation. */
  i2doc: Affine;
  /** Viewport size. */
  viewport: Rect;
  /** Item to viewport transformation. */
  i2vp: Affine;
}

/** Upstream SPItem::BBoxType. */
export enum BBoxType {
  /** Legacy: includes crude stroke and markers. */
  APPROXIMATE_BBOX,
  /** Only the bare path, no stroke. */
  GEOMETRIC_BBOX,
  /** Everything: stroke, markers, filter margins. */
  VISUAL_BBOX,
}

let dkey = 1;

/**
 * Base class of visible SVG elements (upstream SPItem): transform, sensitivity,
 * bounding boxes and the views in Drawings (show/hide).
 *
 * TODO: clip-path and mask references, paint server and filter views, markers,
 * LPE, snap points, conditional attributes (isEvaluated), avoid refs (connectors),
 * title/desc children in write().
 */
export class SPItem extends SPObject {
  sensitive = true;
  bbox_valid = false;
  transform_center_x = 0;
  transform_center_y = 0;
  freeze_stroke_width = false;
  transform: Affine = Affine.identity();
  doc_bbox: OptRect = null;
  /** The viewport of the last update, to resolve percentages. */
  viewport = new Rect(0, 0, 0, 0);
  views: SPItemView[] = [];
  #highlightColor: Color | null = null;

  /** Emitted by doWriteTransform with the relative transform. */
  readonly transformedSignal = new Signal<[Affine, SPItem]>();

  isLocked(): boolean {
    for (let o: SPObject | null = this; o; o = o.parent) {
      if (o instanceof SPItem && !o.sensitive) return true;
    }
    return false;
  }

  setLocked(locked: boolean, recursive = false): void {
    this.setAttribute('sodipodi:insensitive', locked ? '1' : null);
    this.updateRepr();
    // TODO: upstream emits the document modified signal here (document->_emitModified()).
    if (recursive && this.parent instanceof SPItem) this.parent.setLocked(locked, recursive);
  }

  isHidden(): boolean {
    if (!this.isEvaluated()) return true;
    return this.style.display.computed === SPCSSDisplay.SP_CSS_DISPLAY_NONE;
  }

  setHidden(hide: boolean): void {
    const display = this.style.display;
    display.set = true;
    display.value = hide ? SPCSSDisplay.SP_CSS_DISPLAY_NONE : SPCSSDisplay.SP_CSS_DISPLAY_INLINE;
    display.computed = display.value;
    display.inherit = false;
    this.updateRepr();
  }

  /** TODO: systemLanguage, requiredFeatures and requiredExtensions (sp_item_evaluate). */
  isEvaluated(): boolean {
    return true;
  }

  isExplicitlyHidden(): boolean {
    return this.style.display.set && this.style.display.value === SPCSSDisplay.SP_CSS_DISPLAY_NONE;
  }

  setExplicitlyHidden(val: boolean): void {
    const display = this.style.display;
    display.set = val;
    display.value = val ? SPCSSDisplay.SP_CSS_DISPLAY_NONE : SPCSSDisplay.SP_CSS_DISPLAY_INLINE;
    display.computed = display.value;
    this.updateRepr();
  }

  isVisibleAndUnlocked(): boolean {
    return !this.isHidden() && !this.isLocked();
  }

  isHighlightSet(): boolean {
    return this.#highlightColor !== null;
  }

  setHighlight(color: Color): void {
    this.#highlightColor = color;
    this.updateRepr();
  }

  highlight_color(): Color {
    if (this.#highlightColor) return this.#highlightColor;
    if (this.parent instanceof SPItem) return this.parent.highlight_color();
    const color = Color.parse(Preferences.get().getString('/tools/nodes/highlight_color', '#aaaaaaff'));
    return color ?? Color.parse('#aaaaaaff')!;
  }

  /** Position among the item siblings. */
  posInParent(): number {
    if (!this.parent) throw new Error('posInParent: no parent');
    let pos = 0;
    for (const child of this.parent.children) {
      if (child === this) return pos;
      if (child instanceof SPItem) pos++;
    }
    throw new Error('posInParent: not a child of its parent');
  }

  // Object life cycle

  protected override build(document: SPDocument, repr: Node): void {
    this.readAttr(SPAttr.TRANSFORM);
    this.readAttr(SPAttr.SODIPODI_INSENSITIVE);
    this.readAttr(SPAttr.TRANSFORM_CENTER_X);
    this.readAttr(SPAttr.TRANSFORM_CENTER_Y);
    this.readAttr(SPAttr.INKSCAPE_HIGHLIGHT_COLOR);
    // SPObject.build() reads the style.
    super.build(document, repr);
  }

  protected override release(): void {
    super.release();
    for (const v of this.views) v.drawingitem.unlink();
    this.views = [];
  }

  override set(key: SPAttr, value: string | null): void {
    switch (key) {
      case SPAttr.TRANSFORM: {
        const t = value ? sp_svg_transform_read(value) : null;
        this.setItemTransform(t ?? Affine.identity());
        break;
      }
      case SPAttr.SODIPODI_INSENSITIVE:
        this.sensitive = !value;
        for (const v of this.views) v.drawingitem.setSensitive(this.sensitive);
        break;
      case SPAttr.INKSCAPE_HIGHLIGHT_COLOR:
        this.#highlightColor = Color.parse(value) ?? null;
        break;
      case SPAttr.TRANSFORM_CENTER_X:
        this.transform_center_x = value ? Number.parseFloat(value) || 0 : 0;
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.TRANSFORM_CENTER_Y:
        this.transform_center_y = value ? (Number.parseFloat(value) || 0) * -this.document.yaxisdir() : 0;
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      default:
        // TODO: clip-path, mask, connector-avoid, conditional attributes.
        super.set(key, value);
        break;
    }
  }

  protected override update(ctx: SPCtx, flags: number): void {
    // Any of the modifications defined in sp-object.h might change bbox,
    // so we invalidate it unconditionally
    this.bbox_valid = false;

    this.viewport = (ctx as SPItemCtx).viewport; // Cache viewport

    if (flags & (SP_OBJECT_CHILD_MODIFIED_FLAG | SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_STYLE_MODIFIED_FLAG)) {
      if (flags & SP_OBJECT_MODIFIED_FLAG) {
        for (const v of this.views) v.drawingitem.setTransform(this.transform);
      }
      // TODO: bboxes of clip, mask and paint server views.
      if (flags & SP_OBJECT_STYLE_MODIFIED_FLAG) {
        for (const v of this.views) {
          const di = v.drawingitem;
          di.setOpacity(this.style.opacity.as_double());
          di.setAntialiasing(
            this.style.shape_rendering.computed !== SPShapeRendering.SP_CSS_SHAPE_RENDERING_CRISPEDGES,
          );
          di.setIsolation(this.style.isolation.value === SPIsolation.SP_CSS_ISOLATION_ISOLATE);
          di.setBlendMode(this.style.mix_blend_mode.value);
          di.setVisible(!this.isHidden());
        }
      }
    }

    // Update bounding box in user space, used for filter and objectBoundingBox units.
    if (this.style.filter.set) {
      const bbox = this.geometricBounds();
      for (const v of this.views) v.drawingitem.setItemBounds(bbox);
    }
  }

  override write(xmlDoc: XmlDocument, repr: Node | null, flags: number): Node | null {
    if (!repr) return super.write(xmlDoc, repr, flags);
    repr.setAttribute('transform', sp_svg_transform_write(this.transform) || null);

    if (flags & SP_OBJECT_WRITE_EXT) {
      repr.setAttribute('sodipodi:insensitive', this.sensitive ? null : 'true');
      repr.setAttribute(
        'inkscape:transform-center-x',
        this.transform_center_x !== 0 ? svgNumber(this.transform_center_x) : null,
      );
      repr.setAttribute(
        'inkscape:transform-center-y',
        this.transform_center_y !== 0 ? svgNumber(this.transform_center_y * -this.document.yaxisdir()) : null,
      );
    }
    repr.setAttribute('inkscape:highlight-color', this.#highlightColor?.toString() ?? null);

    return super.write(xmlDoc, repr, flags);
  }

  // Bounding boxes

  /** Bounding box of type in the coordinates given by transform (from this item). Subclasses override it. */
  bbox(_transform: Affine, _type: BBoxType): OptRect {
    return null;
  }

  /** Bounding box of the bare path, no stroke. */
  geometricBounds(transform: Affine = Affine.identity()): OptRect {
    return this.bbox(transform, BBoxType.GEOMETRIC_BBOX);
  }

  /** Bounding box with the stroke. TODO: filter region, clip and mask. */
  visualBounds(transform: Affine = Affine.identity()): OptRect {
    return this.bbox(transform, BBoxType.VISUAL_BBOX);
  }

  bounds(type: BBoxType, transform: Affine = Affine.identity()): OptRect {
    return type === BBoxType.GEOMETRIC_BBOX ? this.geometricBounds(transform) : this.visualBounds(transform);
  }

  documentPreferredBounds(): OptRect {
    return Preferences.get().getInt('/tools/bounding_box', 0) === 0
      ? this.documentBounds(BBoxType.VISUAL_BBOX)
      : this.documentBounds(BBoxType.GEOMETRIC_BBOX);
  }

  documentGeometricBounds(): OptRect {
    return this.geometricBounds(this.i2docAffine());
  }

  /** Cached until the next update. */
  documentVisualBounds(): OptRect {
    if (!this.bbox_valid) {
      this.doc_bbox = this.visualBounds(this.i2docAffine());
      this.bbox_valid = true;
    }
    return this.doc_bbox;
  }

  documentBounds(type: BBoxType): OptRect {
    return type === BBoxType.GEOMETRIC_BBOX ? this.documentGeometricBounds() : this.documentVisualBounds();
  }

  desktopGeometricBounds(): OptRect {
    return this.geometricBounds(this.i2dtAffine());
  }

  desktopVisualBounds(): OptRect {
    return this.documentVisualBounds()?.transformed(this.document.doc2dt()) ?? null;
  }

  desktopPreferredBounds(): OptRect {
    return Preferences.get().getInt('/tools/bounding_box', 0) === 0
      ? this.desktopBounds(BBoxType.VISUAL_BBOX)
      : this.desktopBounds(BBoxType.GEOMETRIC_BBOX);
  }

  desktopBounds(type: BBoxType): OptRect {
    return type === BBoxType.GEOMETRIC_BBOX ? this.desktopGeometricBounds() : this.desktopVisualBounds();
  }

  // Descriptions

  typeName(): string {
    return 'item';
  }
  displayName(): string {
    return _('Object');
  }
  description(): string {
    return '';
  }
  /** Description for the status bar, in Pango markup. TODO: clipped, masked, filtered. */
  detailedDescription(): string {
    return `<b>${this.displayName()}</b> ${this.description()}`;
  }

  // Views

  /** Allocate numkeys consecutive display keys and return the first. */
  static displayKeyNew(numkeys: number): number {
    dkey += numkeys;
    return dkey - numkeys;
  }

  /** Give di the first key of a block of ITEM_KEY_SIZE keys, if it has no key yet. */
  static ensureKey(di: DrawingItem): number {
    if (!di.key()) di.setKey(SPItem.displayKeyNew(SPItemKey.ITEM_KEY_SIZE));
    return di.key();
  }

  /** Create the drawing item of this item. Subclasses override it. */
  protected show(_drawing: Drawing, _key: number, _flags: number): DrawingItem | null {
    return null;
  }

  /** Release the views with key. Subclasses override it to hide their children. */
  protected hide(_key: number): void {}

  /** Create a view of this item in drawing, identified by key. */
  invokeShow(drawing: Drawing, key: number, flags: number): DrawingItem | null {
    const ai = this.show(drawing, key, flags);
    if (!ai) return null;

    ai.setItem(this);
    ai.setItemBounds(this.geometricBounds());
    ai.setTransform(this.transform);
    ai.setOpacity(this.style.opacity.as_double());
    ai.setIsolation(this.style.isolation.value === SPIsolation.SP_CSS_ISOLATION_ISOLATE);
    ai.setBlendMode(this.style.mix_blend_mode.value);
    ai.setVisible(!this.isHidden());
    ai.setSensitive(this.sensitive);
    this.views.push({ flags, key, drawingitem: ai, drawing });

    // TODO: clip, mask, fill and stroke paint servers, filter.
    return ai;
  }

  /** Remove the views with key. */
  invokeHide(key: number): void {
    this.hide(key);
    // TODO: hide clip, mask, paint server and filter views.
    this.views = this.views.filter((v) => {
      if (v.key !== key) return true;
      v.drawingitem.unlink();
      return false;
    });
  }

  /** The drawing item of the view with key. */
  getArenaitem(key: number): DrawingItem | null {
    return this.views.find((v) => v.key === key)?.drawingitem ?? null;
  }

  // Transforms

  /** Scale the stroke width and dashes by ex. */
  adjustStroke(ex: number): void {
    if (this.freeze_stroke_width) return;
    const style = this.style;
    if (!are_near(ex, 1.0) && !style.stroke_extensions.hairline) {
      // If there are any pending attribute updates, SPStyle::read overwrites the new stroke_width when
      // updateRepr applies those other attributes. Write out any pending updates before adjusting stroke.
      this.updateRepr();

      style.stroke_width.computed *= ex;
      style.stroke_width.set = true;

      if (style.stroke_dasharray.values.length) {
        for (const value of style.stroke_dasharray.values) {
          value.value *= ex;
          value.computed *= ex;
        }
        style.stroke_dashoffset.value *= ex;
        style.stroke_dashoffset.computed *= ex;
      }

      this.updateRepr();
    }
  }

  /** Scale the stroke width of this item and its children by expansion. */
  adjustStrokeWidthRecursive(expansion: number): void {
    this.adjustStroke(expansion);
    // TODO: skip the children of SPUse (a clone's child is the ghost of its original).
    for (const o of this.children) if (o instanceof SPItem) o.adjustStrokeWidthRecursive(expansion);
  }

  freezeStrokeWidthRecursive(freeze: boolean): void {
    this.freeze_stroke_width = freeze;
    // TODO: skip the children of SPUse.
    for (const o of this.children) if (o instanceof SPItem) o.freezeStrokeWidthRecursive(freeze);
  }

  /**
   * Embed transform into the item where possible (e.g. into path data) and
   * return the rest that goes into the transform attribute. Subclasses override it.
   */
  setTransform(transform: Affine): Affine {
    return transform;
  }

  /**
   * Set a new transform: compensate the stroke width as the preferences say, let
   * setTransform() embed it if allowed, and write the result to the repr.
   * TODO: compensate rx/ry of rects, patterns, hatches and gradients; LPE.
   */
  doWriteTransform(transform: Affine, adv: Affine | null = null, compensate = true): void {
    // Transform delta between the transform currently in the repr and the new transform.
    // This must be used for compensation (stroke, patterns, etc.), otherwise passing an
    // absolute transform via `adv` can cause repeated compensation on pure translations.
    const relativeTransform = sp_item_transform_repr(this).inverse().multiply(transform);
    const advertizedTransform = adv ?? relativeTransform;

    const prefs = Preferences.get();
    if (compensate) {
      // recursively compensating for stroke scaling will not always work, because it can be scaled to zero or infinite
      // from which we cannot ever recover by applying an inverse scale; therefore we temporarily block any changes
      // to the strokewidth in such a case instead, and unblock these after the transformation
      if (!prefs.getBool('/options/transform/stroke', true)) {
        const expansion = 1 / relativeTransform.descrim();
        if (expansion < 1e-9 || expansion > 1e9) {
          this.freezeStrokeWidthRecursive(true);
        } else {
          this.adjustStrokeWidthRecursive(expansion);
        }
      }
    }

    const preserve = prefs.getBool('/options/preservetransform/value', false);
    let transformAttr = transform;
    // Run the object's setTransform (i.e. embed the transform) only if the user did not choose to
    // preserve all transforms, and the object has no filter or the transform is a translation.
    // TODO: no clip path, no mask, no LPE (unoptimized()), text on path.
    if (!preserve && !(!transform.isTranslation() && this.style.getFilter())) {
      transformAttr = this.setTransform(transform);
    }
    if (this.freeze_stroke_width) {
      this.freezeStrokeWidthRecursive(false);
      if (compensate && !prefs.getBool('/options/transform/stroke', true)) {
        // Recursively compensate for stroke scaling, depending on user preference
        this.adjustStrokeWidthRecursive(1 / relativeTransform.descrim());
      }
    }
    // this avoid temporary scaling issues on display when near identity
    // this must be a bit grater than EPSILON * transform.descrim()
    const e = 1e-5 * transform.descrim();
    if (transformAttr.isIdentity(e)) transformAttr = Affine.identity();
    this.setItemTransform(transformAttr);

    // Note: updateRepr comes before emitting the transformed signal since
    // it causes clone SPUse's copy of the original object to be brought up to
    // date with the original.
    this.updateRepr();

    this.transformedSignal.emit(advertizedTransform, this);
  }

  /** Set the transform without writing it to the repr or compensating anything. */
  setItemTransform(transform: Affine): void {
    if (!affineNear(transform, this.transform, 1e-18)) {
      this.transform = transform;
      // SP_OBJECT_USER_MODIFIED_FLAG_B marks that it is only a transformation.
      this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_USER_MODIFIED_FLAG_B);
    }
  }

  /** Transform from item to document coordinates, with the root's viewBox. */
  i2docAffine(): Affine {
    return i2anc_affine(this, null);
  }

  /** Transform from item to desktop coordinates. */
  i2dtAffine(): Affine {
    return this.i2docAffine().multiply(this.document.doc2dt());
  }

  /** Set the transform so that i2dtAffine() becomes i2dt. */
  setI2dAffine(i2dt: Affine): void {
    const dt2p = this.parent instanceof SPItem ? this.parent.i2dtAffine().inverse() : this.document.dt2doc();
    this.setItemTransform(i2dt.multiply(dt2p));
  }

  dt2iAffine(): Affine {
    return this.i2dtAffine().inverse();
  }

  getRelativeTransform(dest: SPObject): Affine {
    return i2i_affine(this, dest);
  }
}

function affineNear(a: Affine, b: Affine, eps: number): boolean {
  for (let i = 0; i < 6; i++) if (Math.abs(a.at(i) - b.at(i)) > eps) return false;
  return true;
}

/**
 * Transform from object to ancestor (or to the document for null). Stops at the
 * first ancestor that is no item.
 */
export function i2anc_affine(object: SPObject | null, ancestor: SPObject | null): Affine {
  let ret = Affine.identity();
  while (object !== ancestor && object instanceof SPItem) {
    // SPRoot (not imported here: import cycle) uses its viewBox transform c2p.
    ret = ret.multiply('c2p' in object && object.c2p instanceof Affine ? object.c2p : object.transform);
    object = object.parent;
  }
  return ret;
}

export function i2i_affine(src: SPObject, dest: SPObject): Affine {
  const ancestor = src.nearestCommonAncestor(dest);
  return i2anc_affine(src, ancestor).multiply(i2anc_affine(dest, ancestor).inverse());
}

/** The transform in the repr of item (before changes that are not written yet). */
export function sp_item_transform_repr(item: SPItem): Affine {
  const attr = item.getRepr().attribute('transform');
  return (attr && sp_svg_transform_read(attr)) || Affine.identity();
}
