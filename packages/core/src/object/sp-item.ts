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
import { Affine, are_near, type OptRect, Point, Rect, Scale, Translate } from '@inkscape-web/geom';
import { SPAttr } from '../attributes.ts';
import { Color } from '../colors/color.ts';
import type { SPAvoidRef } from '../conn-avoid-ref.ts';
import type { Drawing, DrawingItem } from '../display/drawing.ts';
import type { SPDocument } from '../document.ts';
import { SPContentUnits } from '../enums.ts';
import { _ } from '../i18n.ts';
import { Preferences } from '../preferences.ts';
import { SnapCandidatePoint } from '../snap-candidate.ts';
import { SnapSourceType, SnapTargetType } from '../snap-enums.ts';
import type { SnapPreferences } from '../snap-preferences.ts';
import { SPCSSDisplay, SPIsolation, SPShapeRendering } from '../style-enums.ts';
import { extractUri } from '../style-internal.ts';
import { svgNumber } from '../svg/stringstream.ts';
import { sp_svg_transform_read, sp_svg_transform_write } from '../svg/svg-affine.ts';
import { SVGLength, SVGLengthUnit } from '../svg/svg-length.ts';
import { Signal } from '../util/signal.ts';
import type { XmlDocument } from '../xml/document.ts';
import type { Node } from '../xml/node.ts';
import { type SPClipPath, SPClipPathReference } from './sp-clippath.ts';
import type { SPFilter } from './sp-filter.ts';
import { SPFilterUnits } from './sp-filter-units.ts';
import { type SPMask, SPMaskReference } from './sp-mask.ts';
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
 * TODO: paint server views (the drawing mirrors the paint servers instead), LPE,
 * conditional attributes (isEvaluated), avoid refs (connectors), title/desc children in write().
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
  clip_ref: SPClipPathReference | null = null;
  mask_ref: SPMaskReference | null = null;
  #highlightColor: Color | null = null;

  constructor() {
    super();
    this.style.signal_filter_changed.connect((old_obj, obj) => this.#filter_ref_changed(old_obj, obj));
  }

  getClipObject(): SPClipPath | null {
    return this.clip_ref?.getObject() ?? null;
  }

  getMaskObject(): SPMask | null {
    return this.mask_ref?.getObject() ?? null;
  }

  getClipRef(): SPClipPathReference {
    if (!this.clip_ref) {
      this.clip_ref = new SPClipPathReference(this);
      this.clip_ref.changedSignal.connect((old_obj, obj) => this.#clip_ref_changed(old_obj, obj));
    }
    return this.clip_ref;
  }

  getMaskRef(): SPMaskReference {
    if (!this.mask_ref) {
      this.mask_ref = new SPMaskReference(this);
      this.mask_ref.changedSignal.connect((old_obj, obj) => this.#mask_ref_changed(old_obj, obj));
    }
    return this.mask_ref;
  }

  /** Emitted by doWriteTransform with the relative transform. */
  readonly transformedSignal = new Signal<[Affine, SPItem]>();

  /** The connector obstacle of the item (upstream avoidRef), created by getAvoidRef(). */
  avoidRef: SPAvoidRef | null = null;
  /** Creates the SPAvoidRef; set by conn-avoid-ref.ts, which imports this module. */
  static avoidRefFactory: ((item: SPItem) => SPAvoidRef) | null = null;

  getAvoidRef(): SPAvoidRef {
    if (!this.avoidRef) {
      const factory = SPItem.avoidRefFactory;
      if (!factory) throw new Error('conn-avoid-ref.ts is not loaded');
      this.avoidRef = factory(this);
    }
    return this.avoidRef;
  }

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
    this.readAttr(SPAttr.CLIP_PATH);
    this.readAttr(SPAttr.MASK);
    this.readAttr(SPAttr.SODIPODI_INSENSITIVE);
    this.readAttr(SPAttr.TRANSFORM_CENTER_X);
    this.readAttr(SPAttr.TRANSFORM_CENTER_Y);
    this.readAttr(SPAttr.INKSCAPE_HIGHLIGHT_COLOR);
    this.readAttr(SPAttr.CONNECTOR_AVOID);
    // SPObject.build() reads the style.
    super.build(document, repr);
  }

  protected override release(): void {
    // Detaching calls *_ref_changed() with null, which hides the clip and mask views.
    this.clip_ref?.detach();
    this.clip_ref = null;
    this.mask_ref?.detach();
    this.mask_ref = null;
    this.avoidRef?.release();
    this.avoidRef = null;
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
      case SPAttr.CLIP_PATH: {
        const uri = value ? extractUri(value).uri : '';
        if (uri || this.clip_ref) this.getClipRef().try_attach(uri);
        break;
      }
      case SPAttr.MASK: {
        const uri = value ? extractUri(value).uri : '';
        if (uri || this.mask_ref) this.getMaskRef().try_attach(uri);
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
      case SPAttr.CONNECTOR_AVOID:
        if (value || this.avoidRef) this.getAvoidRef().setAvoid(value);
        break;
      default:
        // TODO: conditional attributes.
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
      let bbox: OptRect | undefined;
      const set_bboxes = (obj: SPClipPath | SPMask | null, type: SPItemKey) => {
        if (!obj) return;
        bbox ??= this.geometricBounds();
        for (const v of this.views) obj.setBBox(v.drawingitem.key() + type, bbox);
      };
      set_bboxes(this.getClipObject(), SPItemKey.ITEM_KEY_CLIP);
      set_bboxes(this.getMaskObject(), SPItemKey.ITEM_KEY_MASK);
      // The paint servers have no views: the drawing mirrors them (DrawingPaintServers).
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

    // Update libavoid with item geometry (for connector routing).
    this.avoidRef?.handleSettingChange();
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
    const clip = this.getClipObject();
    if (clip) repr.setAttributeOrRemoveIfEmpty('clip-path', this.clip_ref?.cssStr() ?? null);
    const mask = this.getMaskObject();
    if (mask) repr.setAttributeOrRemoveIfEmpty('mask', this.mask_ref?.cssStr() ?? null);
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

  /**
   * Bounding box with the stroke, or the filter region if the item has a filter (wfilter),
   * intersected with the bounds of the clip (wclip) and the mask (wmask).
   */
  visualBounds(transform: Affine = Affine.identity(), wfilter = true, wclip = true, wmask = true): OptRect {
    let bbox: OptRect;
    let gbox: OptRect | undefined;
    const geom = () => {
      gbox ??= this.geometricBounds();
      return gbox;
    };

    const filter = this.style.getFilter();
    if (filter && wfilter) {
      // call the subclass method
      bbox = geom(); // see LP Bug 1229971
      if (!bbox) {
        // If we don't have a valid bbox, don't go on and create one.
        return bbox;
      }

      // default filter area per the SVG spec:
      const x = new SVGLength();
      const y = new SVGLength();
      const w = new SVGLength();
      const h = new SVGLength();
      x.set(SVGLengthUnit.PERCENT, -0.1, 0);
      y.set(SVGLengthUnit.PERCENT, -0.1, 0);
      w.set(SVGLengthUnit.PERCENT, 1.2, 0);
      h.set(SVGLengthUnit.PERCENT, 1.2, 0);

      // if area is explicitly set, override:
      const fx = filter.x._set ? filter.x : x;
      const fy = filter.y._set ? filter.y : y;
      const fw = filter.width._set ? filter.width : w;
      const fh = filter.height._set ? filter.height : h;

      const len = bbox.dimensions();
      fx.update(12, 6, len.x);
      fy.update(12, 6, len.y);
      fw.update(12, 6, len.x);
      fh.update(12, 6, len.y);

      const pct = (l: SVGLength, size: number) =>
        l.computed * (l.unit === SVGLengthUnit.PERCENT ? 1.0 : size);
      if (filter.filterUnits === SPFilterUnits.SP_FILTER_UNITS_OBJECTBOUNDINGBOX) {
        bbox = Rect.fromXywh(
          bbox.left() + pct(fx, len.x),
          bbox.top() + pct(fy, len.y),
          pct(fw, len.x),
          pct(fh, len.y),
        );
      } else {
        bbox = Rect.fromXywh(fx.computed, fy.computed, fw.computed, fh.computed);
      }
      bbox = bbox.transformed(transform);
    } else {
      // call the subclass method
      bbox = this.bbox(transform, BBoxType.VISUAL_BBOX);
      if (!bbox) {
        // If we don't have a valid bbox, don't do clipping/masking etc.
        return bbox;
      }
    }

    const transform_with_units = (contentunits: SPContentUnits): Affine => {
      const g = contentunits === SPContentUnits.SP_CONTENT_UNITS_OBJECTBOUNDINGBOX ? geom() : null;
      return g ? Scale(g.dimensions()).multiply(Translate(g.min())).multiply(transform) : transform;
    };
    const intersect = (box: OptRect) => {
      bbox = bbox && box ? bbox.intersect(box) : null;
    };

    const clip = this.getClipObject();
    if (clip && wclip) intersect(clip.visualBounds(transform_with_units(clip.clippath_units())));
    const mask = this.getMaskObject();
    if (mask && wmask) intersect(mask.visualBounds(transform_with_units(mask.mask_content_units())));

    return bbox;
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
  /** Description for the status bar, in Pango markup. */
  detailedDescription(): string {
    let s = `<b>${this.displayName()}</b> ${this.description()}`;
    if (this.getClipObject()) s = _('%s; <i>clipped</i>').replace('%s', s);
    if (this.getMaskObject()) s = _('%s; <i>masked</i>').replace('%s', s);
    const filter = this.style.getFilter();
    if (filter) {
      const label = filter.label();
      s = label
        ? _('%s; <i>filtered (%s)</i>').replace('%s', s).replace('%s', _(label))
        : _('%s; <i>filtered</i>').replace('%s', s);
    }
    return s;
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

    const bbox = this.geometricBounds();
    const clip = this.getClipObject();
    if (clip) {
      const clip_key = SPItem.ensureKey(ai) + SPItemKey.ITEM_KEY_CLIP;
      ai.setClip(clip.show(drawing, clip_key, bbox));
    }
    const mask = this.getMaskObject();
    if (mask) {
      const mask_key = SPItem.ensureKey(ai) + SPItemKey.ITEM_KEY_MASK;
      ai.setMask(mask.show(drawing, mask_key, bbox));
    }
    // The fill and stroke paint servers have no views: the drawing mirrors them.
    this.style.getFilter()?.show(ai);
    return ai;
  }

  /** Remove the views with key. */
  invokeHide(key: number): void {
    this.hide(key);
    this.views = this.views.filter((v) => {
      if (v.key !== key) return true;
      const ai_key = v.drawingitem.key();
      this.getClipObject()?.hide(ai_key + SPItemKey.ITEM_KEY_CLIP);
      this.getMaskObject()?.hide(ai_key + SPItemKey.ITEM_KEY_MASK);
      this.style.getFilter()?.hide(v.drawingitem);
      v.drawingitem.unlink();
      return false;
    });
  }

  #clip_ref_changed(old_clip: SPObject | null, clip: SPObject | null): void {
    if (old_clip && this.clip_ref) {
      this.clip_ref.modified_connection?.();
      this.clip_ref.modified_connection = null;
      for (const v of this.views)
        (old_clip as SPClipPath).hide(v.drawingitem.key() + SPItemKey.ITEM_KEY_CLIP);
    }
    const clipPath = clip as SPClipPath | null;
    if (clipPath && this.clip_ref) {
      const bbox = this.geometricBounds();
      for (const v of this.views) {
        const clip_key = SPItem.ensureKey(v.drawingitem) + SPItemKey.ITEM_KEY_CLIP;
        v.drawingitem.setClip(clipPath.show(v.drawing, clip_key, bbox));
      }
      this.clip_ref.modified_connection = clipPath.modifiedSignal.connect((_obj, flags) => {
        if (flags & (SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_CHILD_MODIFIED_FLAG)) {
          this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        }
      });
    } else {
      for (const v of this.views) v.drawingitem.setClip(null);
    }
    this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG); // To update bbox.
  }

  #mask_ref_changed(old_mask: SPObject | null, mask: SPObject | null): void {
    if (old_mask && this.mask_ref) {
      this.mask_ref.modified_connection?.();
      this.mask_ref.modified_connection = null;
      for (const v of this.views) (old_mask as SPMask).hide(v.drawingitem.key() + SPItemKey.ITEM_KEY_MASK);
    }
    const maskItem = mask as SPMask | null;
    if (maskItem && this.mask_ref) {
      const bbox = this.geometricBounds();
      for (const v of this.views) {
        const mask_key = SPItem.ensureKey(v.drawingitem) + SPItemKey.ITEM_KEY_MASK;
        v.drawingitem.setMask(maskItem.show(v.drawing, mask_key, bbox));
      }
      this.mask_ref.modified_connection = maskItem.modifiedSignal.connect((_obj, flags) => {
        if (flags & (SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_CHILD_MODIFIED_FLAG)) {
          this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        }
      });
    } else {
      for (const v of this.views) v.drawingitem.setMask(null);
    }
    this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG); // To update bbox.
  }

  #filter_ref_changed(old_obj: SPObject | null, obj: SPObject | null): void {
    if (old_obj) for (const v of this.views) (old_obj as SPFilter).hide(v.drawingitem);
    if (obj) for (const v of this.views) (obj as SPFilter).show(v.drawingitem);
  }

  /** The drawing item of the view with key. */
  getArenaitem(key: number): DrawingItem | null {
    return this.views.find((v) => v.key === key)?.drawingitem ?? null;
  }

  // Transforms

  /** Reset the rotation center to the middle of the bounding box. */
  unsetCenter(): void {
    this.transform_center_x = 0;
    this.transform_center_y = 0;
  }

  /** True if the rotation center was moved away from the middle of the bounding box. */
  isCenterSet(): boolean {
    return this.transform_center_x !== 0 || this.transform_center_y !== 0;
  }

  /** Scale of user units to px, for the rotation center (the smaller of the viewBox scales). */
  #centerViewscale(): number {
    const vb = this.document.getRoot().viewBox;
    if (vb.hasZeroArea()) return 1.0;
    const size = this.document.getDimensions();
    return Math.min(size.y / vb.height(), size.x / vb.width());
  }

  /** The rotation center in desktop coordinates (px). */
  getCenter(ensure_uptodate = true): Point {
    if (ensure_uptodate) this.document.ensureUpToDate();
    const viewscale = this.#centerViewscale();
    const bbox = this.desktopGeometricBounds();
    if (!bbox) return new Point(0, 0); // something's wrong!
    // transform_center_x/y are stored in user units, so we have to take the viewbox into account
    return bbox
      .midpoint()
      .add(new Point(this.transform_center_x * viewscale, this.transform_center_y * viewscale));
  }

  /**
   * Set the rotation center to object_centre (in desktop coordinates), as an
   * offset from the center of the desktop bounding box.
   */
  setCenter(object_centre: Point): void {
    this.document.ensureUpToDate();

    const viewscale = this.#centerViewscale();

    // FIXME this is seriously wrong
    const bbox = this.desktopGeometricBounds();
    if (bbox) {
      // object centre is document coordinates (i.e. in pixels), so we need to consider the viewbox
      // to translate to user units; transform_center_x/y is in user units
      this.transform_center_x = (object_centre.x - bbox.midpoint().x) / viewscale;
      if (are_near(this.transform_center_x, 0)) this.transform_center_x = 0; // rounding error
      this.transform_center_y = (object_centre.y - bbox.midpoint().y) / viewscale;
      if (are_near(this.transform_center_y, 0)) this.transform_center_y = 0; // rounding error
    }
  }

  // Snapping

  /**
   * Add the snap points of this item (desktop coordinates) to p. Subclasses
   * override it; the base class has none.
   */
  snappoints(_p: SnapCandidatePoint[], _snapprefs: SnapPreferences): void {}

  /**
   * Add the snap points of the item and its rotation center to p.
   * TODO: the snap points of clipping paths and masks.
   */
  getSnappoints(p: SnapCandidatePoint[], snapprefs: SnapPreferences): void {
    // Get the snappoints of the item
    this.snappoints(p, snapprefs);
    // Get the snappoints at the item's center
    if (snapprefs.isTargetSnappable(SnapTargetType.SNAPTARGET_ROTATION_CENTER)) {
      p.push(
        new SnapCandidatePoint(
          this.getCenter(),
          SnapSourceType.SNAPSOURCE_ROTATION_CENTER,
          SnapTargetType.SNAPTARGET_ROTATION_CENTER,
        ),
      );
    }
  }

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
    // SPUse overrides it: a clone's child is the ghost of its original, it is not touched.
    for (const o of this.children) if (o instanceof SPItem) o.adjustStrokeWidthRecursive(expansion);
  }

  freezeStrokeWidthRecursive(freeze: boolean): void {
    this.freeze_stroke_width = freeze;
    // SPUse overrides it and skips its child.
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
   * TODO: compensate rx/ry of rects, patterns, hatches and gradients.
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
    // (upstream calls notifyTransform on cast<SPLPEItem>(this); here SPItem has an empty one)
    this.notifyTransform(transform);
    const unoptimiced = this.unoptimized();
    // Run the object's setTransform (i.e. embed the transform) only if the user did not choose to
    // preserve all transforms, the object has no filter or the transform is a translation, and
    // the object has no path effect.
    // TODO: no clip path, no mask, text on path.
    if (!preserve && !(!transform.isTranslation() && this.style.getFilter()) && !unoptimiced) {
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

  /** Tell the path effects of the item about a new transform (SPLPEItem overrides it). */
  notifyTransform(_postmul: Affine): void {}

  /** True if the transform must stay in the transform attribute: the item has a path effect. TODO: satellites. */
  unoptimized(): boolean {
    return !!this.getAttribute('inkscape:path-effect');
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

  /** Scale the item around the middle of its visual bounds (desktop coordinates) and write the transform. */
  scale_rel(scale: Affine): void {
    const bbox = this.desktopVisualBounds();
    if (bbox) {
      const s = Translate(bbox.midpoint()); // use getCenter?
      this.setI2dAffine(this.i2dtAffine().multiply(s.inverse()).multiply(scale).multiply(s));
      this.doWriteTransform(this.transform);
    }
  }

  /** Rotate the item around its rotation center (desktop coordinates) and write the transform. */
  rotate_rel(rotation: Affine): void {
    const center = this.getCenter();
    const s = Translate(center);
    const affine = s.inverse().multiply(rotation).multiply(s);
    this.setI2dAffine(this.i2dtAffine().multiply(affine));
    this.doWriteTransform(this.transform);
    // Restore the center position (it changed because the bbox center changed).
    if (this.isCenterSet()) {
      this.setCenter(center.transformed(affine));
      this.updateRepr();
    }
  }

  /** Skew the item around its rotation center (desktop coordinates) and write the transform. */
  skew_rel(skewX: number, skewY: number): void {
    const center = this.getCenter();
    const s = Translate(center);
    const affine = s
      .inverse()
      .multiply(new Affine(1, skewY, skewX, 1, 0, 0))
      .multiply(s);
    this.setI2dAffine(this.i2dtAffine().multiply(affine));
    this.doWriteTransform(this.transform);
    if (this.isCenterSet()) {
      this.setCenter(center.transformed(affine));
      this.updateRepr();
    }
  }

  /** Move the item by tr in desktop coordinates and write the transform. */
  move_rel(tr: Affine): void {
    this.setI2dAffine(this.i2dtAffine().multiply(tr));
    this.doWriteTransform(this.transform);
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
