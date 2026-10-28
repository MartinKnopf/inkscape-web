// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-text.cpp, src/object/sp-text.h
/*
 * SVG <text> and <tspan> implementation
 *
 * Author:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   bulia byak <buliabyak@users.sf.net>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *
 * Copyright (C) 1999-2002 Lauris Kaplinski
 * Copyright (C) 2000-2001 Ximian, Inc.
 */
import { Affine, are_near, type OptRect, type Point, Rect, Translate } from '@inkscape-web/geom';
import { SPAttr } from '../attributes.ts';
import type { Drawing, DrawingGroup, DrawingItem } from '../display/drawing.ts';
import type { SPDocument } from '../document.ts';
import { _, ngettext } from '../i18n.ts';
import {
  emptyOptionalTextTagAttrs,
  Layout,
  type OptionalTextTagAttrs,
  TextControlCode,
  WrapMode,
} from '../libnrtype/Layout-TNG.ts';
import { computeFontLineHeight } from '../libnrtype/Layout-TNG-Compute.ts';
import { getTextMeasurer, ink_font_from_style } from '../libnrtype/text-measurer.ts';
import { Preferences } from '../preferences.ts';
import { SnapCandidatePoint } from '../snap-candidate.ts';
import { SnapSourceType, SnapTargetType } from '../snap-enums.ts';
import type { SnapPreferences } from '../snap-preferences.ts';
import {
  SPCSSDirection,
  SPCSSDisplay,
  SPCSSWritingMode,
  SPTextAnchor,
  SPWhiteSpace,
} from '../style-enums.ts';
import { SPCSSUnit, SPFontSizeType } from '../style-internal.ts';
import { spSvgReadPercentage } from '../svg/svg-length.ts';
import type { XmlDocument } from '../xml/document.ts';
import type { Node } from '../xml/node.ts';
import {
  type SPCSSAttr,
  spReprCssAttr,
  spReprCssProperty,
  spReprCssSet,
  spReprCssSetPropertyDouble,
} from '../xml/repr-css.ts';
import { sp_repr_is_meta_element } from '../xml/repr-util.ts';
import { BBoxType, SPItem, type SPItemCtx } from './sp-item.ts';
import type { SPGroup } from './sp-item-group.ts';
import {
  cascadeFlags,
  SP_OBJECT_CHILD_MODIFIED_FLAG,
  SP_OBJECT_MODIFIED_FLAG,
  SP_OBJECT_STYLE_MODIFIED_FLAG,
  SP_OBJECT_WRITE_BUILD,
  type SPCtx,
  type SPObject,
} from './sp-object.ts';
import { SPString } from './sp-string.ts';
import {
  SP_TEXT_CONTENT_MODIFIED_FLAG,
  SP_TEXT_LAYOUT_MODIFIED_FLAG,
  SP_TSPAN_ROLE_UNSPECIFIED,
  SPTSpan,
} from './sp-tspan.ts';
import { TextTagAttributes } from './text-tag-attributes.ts';

/**
 * svg:text (upstream SPText). The layout is rebuilt from the children in
 * update(); the drawing shows the layout's spans.
 * TODO: textPath and tref children, shape-subtract and shape-padding, real
 * shapes for shape-inside (the bounding box is used), print, getNormalizedBpath
 * (convert to path), getLinked, textLength, the gradient and pattern
 * adjustment in setTransform.
 */
export class SPText extends SPItem {
  readonly attributes = new TextTagAttributes();
  readonly layout = new Layout();

  protected override build(document: SPDocument, repr: Node): void {
    this.readAttr(SPAttr.X);
    this.readAttr(SPAttr.Y);
    this.readAttr(SPAttr.DX);
    this.readAttr(SPAttr.DY);
    this.readAttr(SPAttr.ROTATE);

    // textLength and friends
    this.readAttr(SPAttr.TEXTLENGTH);
    this.readAttr(SPAttr.LENGTHADJUST);
    super.build(document, repr);
    this.readAttr(SPAttr.SODIPODI_LINESPACING); // has to happen after the styles are read
  }

  override set(key: SPAttr, value: string | null): void {
    if (this.attributes.readSingleAttribute(key, value, this.style, this.viewport)) {
      this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
      return;
    }
    if (key === SPAttr.SODIPODI_LINESPACING) {
      // convert deprecated tag to css... but only if 'line-height' missing.
      const lh = this.style.line_height;
      if (value && !lh.set) {
        lh.set = true;
        lh.inherit = false;
        lh.normal = false;
        lh.unit = SPCSSUnit.SP_CSS_UNIT_PERCENT;
        lh.value = lh.computed = spSvgReadPercentage(value, 1.0);
      }
      // Remove deprecated attribute
      if (value) this.removeAttribute('sodipodi:linespacing');
      this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG | SP_TEXT_LAYOUT_MODIFIED_FLAG);
      return;
    }
    super.set(key, value);
  }

  protected override childAdded(child: Node, ref: Node | null): void {
    super.childAdded(child, ref);
    this.requestDisplayUpdate(
      SP_OBJECT_MODIFIED_FLAG | SP_TEXT_CONTENT_MODIFIED_FLAG | SP_TEXT_LAYOUT_MODIFIED_FLAG,
    );
  }

  protected override removeChild(child: Node): void {
    super.removeChild(child);
    this.requestDisplayUpdate(
      SP_OBJECT_MODIFIED_FLAG | SP_TEXT_CONTENT_MODIFIED_FLAG | SP_TEXT_LAYOUT_MODIFIED_FLAG,
    );
  }

  protected override update(ctx: SPCtx, flags: number): void {
    const childflags = cascadeFlags(flags);
    for (const child of this.childList()) {
      if (childflags || child.uflags & (SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_CHILD_MODIFIED_FLAG)) {
        child.updateDisplay(ctx, childflags);
      }
    }

    // update ourselves after updating children
    super.update(ctx, flags);

    if (
      flags &
      (SP_OBJECT_STYLE_MODIFIED_FLAG | SP_OBJECT_CHILD_MODIFIED_FLAG | SP_TEXT_LAYOUT_MODIFIED_FLAG)
    ) {
      const ictx = ctx as SPItemCtx;
      const w = ictx.viewport.width();
      const h = ictx.viewport.height();
      const em = this.style.font_size.computed;
      const ex = 0.5 * em; // fixme: get x height from pango or libnrtype.
      this.attributes.update(em, ex, w, h);

      // Set inline_size computed value if necessary (i.e. if unit is %).
      if (this.has_inline_size() && this.style.inline_size.unit === SPCSSUnit.SP_CSS_UNIT_PERCENT) {
        this.style.inline_size.computed = this.style.inline_size.value * (this.is_horizontal() ? w : h);
      }

      /* fixme: It is not nice to have it here, but otherwise children content changes does not work */
      /* fixme: Even now it may not work, as we are delayed */
      /* fixme: So check modification flag everywhere immediate state is used */
      this.rebuildLayout();
      this.#showLayout();
    }
  }

  protected override modified(flags: number): void {
    // FIXME: all that we need to do here is to call setStyle, to set the changed style, but
    // there's no easy way to access the drawing glyphs or texts corresponding to a text
    // this. Therefore we do here the same as in _update, that is, destroy all items and
    // create new ones. This is probably quite wasteful.
    if (flags & SP_OBJECT_STYLE_MODIFIED_FLAG) this.#showLayout();

    const cflags = cascadeFlags(flags);
    for (const child of this.childList()) {
      if (cflags || child.mflags & (SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_CHILD_MODIFIED_FLAG)) {
        child.emitModified(cflags);
      }
    }
  }

  /** Replace the display items of all views with the current layout. */
  #showLayout(): void {
    // pass the bbox of this as paintbox (used for paintserver fills)
    const paintbox = this.geometricBounds();
    for (const v of this.views) {
      const g = v.drawingitem as DrawingGroup;
      this._clearFlow(g);
      g.setStyle(this.style, this.parent?.style ?? null);
      this.layout.show(v.drawing, g, paintbox);
    }
  }

  override write(xmlDoc: XmlDocument, repr: Node | null, flags: number): Node | null {
    if (flags & SP_OBJECT_WRITE_BUILD) {
      if (!repr) {
        repr = xmlDoc.createElement('svg:text');
        // we preserve spaces in the text objects we create
        repr.setAttribute('xml:space', 'preserve');
      }
      const l: Node[] = [];
      for (const child of this.children) {
        // TODO: skip title and desc.
        let crepr: Node | null = null;
        if (child instanceof SPString) crepr = xmlDoc.createTextNode(child.string);
        else crepr = child.write(xmlDoc, null, flags);
        if (crepr) l.push(crepr);
      }
      for (const c of l) repr.appendChild(c);
    } else if (repr) {
      for (const child of this.children) {
        if (child instanceof SPString) child.getRepr().setContent(child.string);
        else child.updateRepr(flags);
      }
    }
    if (!repr) return null;

    this.attributes.writeTo(repr);
    return super.write(xmlDoc, repr, flags);
  }

  override bbox(transform: Affine, type: BBoxType): OptRect {
    return this.layout.bounds(transform, type === BBoxType.VISUAL_BBOX);
  }

  protected override show(drawing: Drawing, _key: number, _flags: number): DrawingItem {
    const flowed = drawing.createGroup();
    flowed.setPickChildren(false);
    flowed.setStyle(this.style, this.parent?.style ?? null);
    // pass the bbox of the text object as paintbox (used for paintserver fills)
    this.layout.show(drawing, flowed, this.geometricBounds());
    return flowed;
  }

  protected override hide(key: number): void {
    for (const v of this.views) if (v.key === key) this._clearFlow(v.drawingitem as DrawingGroup);
  }

  override typeName(): string {
    if (this.has_inline_size() || this.has_shape_inside()) return 'text-flow';
    return 'text';
  }

  override displayName(): string {
    if (this.has_inline_size()) return _('Auto-wrapped text');
    if (this.has_shape_inside()) return _('Text in-a-shape');
    return _('Text');
  }

  override description(): string {
    const nChars = this.layout.iteratorToCharIndex(this.layout.end());
    const trunc = this.layout.inputTruncated() ? _(' [truncated]') : '';
    return ngettext('(%d character%s)', '(%d characters%s)', nChars)
      .replace('%d', String(nChars))
      .replace('%s', trunc);
  }

  override snappoints(p: SnapCandidatePoint[], snapprefs: SnapPreferences): void {
    if (snapprefs.isTargetSnappable(SnapTargetType.SNAPTARGET_TEXT_BASELINE)) {
      // Choose a point on the baseline for snapping from or to, with the horizontal position
      // of this point depending on the text alignment (left vs. right)
      if (this.layout.outputExists()) {
        const pt = this.layout.baselineAnchorPoint();
        if (pt) {
          p.push(
            new SnapCandidatePoint(
              pt.transformed(this.i2dtAffine()),
              SnapSourceType.SNAPSOURCE_TEXT_ANCHOR,
              SnapTargetType.SNAPTARGET_TEXT_ANCHOR,
            ),
          );
        }
      }
    }
  }

  /**
   * Embed scaling and translation: move x/y/dx/dy and scale the font size
   * and stroke width; return the rest (upstream set_transform).
   */
  override setTransform(xform: Affine): Affine {
    // See if 'shape-inside' has rectangle
    if (Preferences.get().getBool('/tools/text/use_svg2', true) && this.style.shape_inside.set) return xform;
    // TODO: we cannot optimize textpath because changing its fontsize will break its match to the path
    // we cannot optimize text with textLength because it may show different size than specified
    if (this.attributes.getTextLength()._set) return xform;
    if (this.style.inline_size.set) return xform;

    // This function takes care of scaling & translation only, we return whatever parts we can't handle.
    const ex = xform.descrim();
    if (ex === 0) return xform;

    const r = xform.withoutTranslation();
    const ret = new Affine(r.c0 / ex, r.c1 / ex, r.c2 / ex, r.c3 / ex, 0, 0);

    // Adjust x/y, dx/dy
    SPText._adjustCoordsRecursive(this, xform.multiply(ret.inverse()), ex);
    // Adjust font size
    SPText._adjustFontsizeRecursive(this, ex);
    // Adjust stroke width
    this.adjustStrokeWidthRecursive(ex);
    // TODO: adjust pattern and gradient fills.
    return ret;
  }

  /**
   * When the object is transformed it's nicer to change the font size and
   * coordinates when we can, rather than just applying a matrix transform.
   * is_root extends zero-length position vectors to length 1 to record the
   * new position.
   */
  static _adjustCoordsRecursive(item: SPItem, m: Affine, ex: number, is_root = true): void {
    // it doesn't matter if we change the x,y for role=line spans because we'll just overwrite them anyway
    if (item instanceof SPTSpan || item instanceof SPText) item.attributes.transform(m, ex, ex, is_root);
    else return;
    for (const o of item.children) if (o instanceof SPItem) SPText._adjustCoordsRecursive(o, m, ex, false);
  }

  static _adjustFontsizeRecursive(item: SPItem, ex: number, is_root = true): void {
    const style = item.style;
    if (!are_near(ex, 1.0)) {
      if (!style.font_size.set && is_root) style.font_size.set = true;
      style.font_size.type = SPFontSizeType.SP_FONT_SIZE_LENGTH;
      style.font_size.computed *= ex;
      style.letter_spacing.computed *= ex;
      style.word_spacing.computed *= ex;
      const unit = style.line_height.unit;
      if (
        unit !== SPCSSUnit.SP_CSS_UNIT_NONE &&
        unit !== SPCSSUnit.SP_CSS_UNIT_PERCENT &&
        unit !== SPCSSUnit.SP_CSS_UNIT_EM &&
        unit !== SPCSSUnit.SP_CSS_UNIT_EX
      ) {
        // No unit on 'line-height' property has special behavior.
        style.line_height.computed *= ex;
      }
      item.updateRepr();
    }
    for (const o of item.children) if (o instanceof SPItem) SPText._adjustFontsizeRecursive(o, ex, false);
  }

  /** Discards the drawing objects representing this text. */
  _clearFlow(in_arena: DrawingGroup): void {
    in_arena.clearChildren();
  }

  // Layout

  /** Initializes layout from <text> (i.e. this node). */
  _buildLayoutInit(): void {
    const layout = this.layout;
    layout.strut.reset();
    layout.wrap_mode = WrapMode.WRAP_NONE; // Default to SVG 1.1

    const style = this.style;
    // Strut
    const font = ink_font_from_style(style);
    layout.strut.set(getTextMeasurer().fontMetrics(font), font.size);
    layout.strut.scale(style.font_size.computed);
    layout.strut.computeEffective(computeFontLineHeight(style));

    if (style.shape_inside.set) {
      layout.wrap_mode = WrapMode.WRAP_SHAPE_INSIDE;
      for (const shape of this.#shapeInsideItems()) {
        const box = shape.bbox(shape.transform, BBoxType.GEOMETRIC_BBOX);
        if (box) layout.appendWrapShape(box);
      }
      if (!layout._input_wrap_shapes.length) layout.wrap_mode = WrapMode.WRAP_NONE;
    } else if (this.has_inline_size()) {
      layout.wrap_mode = WrapMode.WRAP_INLINE_SIZE;
      // A rectangle with one dimension set by 'inline-size' and the other infinite.
      const frame = this.get_frame();
      if (frame) layout.appendWrapShape(frame);
    } else if (
      style.white_space.value === SPWhiteSpace.SP_CSS_WHITE_SPACE_PRE ||
      style.white_space.value === SPWhiteSpace.SP_CSS_WHITE_SPACE_PREWRAP ||
      style.white_space.value === SPWhiteSpace.SP_CSS_WHITE_SPACE_PRELINE
    ) {
      layout.wrap_mode = WrapMode.WRAP_WHITE_SPACE;
    }
  }

  /** The items referenced by shape-inside. */
  #shapeInsideItems(): SPItem[] {
    const items: SPItem[] = [];
    for (const href of this.style.shape_inside.hrefs) {
      const uri = href.getURI();
      const obj = href.getObject() ?? (uri ? this.document.getObjectById(uri.replace(/^#/, '')) : null);
      if (obj instanceof SPItem) items.push(obj);
    }
    return items;
  }

  /**
   * Recursively walk the object tree adding tags and their contents to the
   * layout: manage the positioning attributes and their inheritance rules,
   * and the line breaks of sodipodi:role="line" tspans.
   */
  _buildLayoutInput(
    object: SPObject,
    parent_optional_attrs: OptionalTextTagAttrs,
    parent_attrs_offset: number,
    in_textpath: boolean,
  ): number {
    let length = 0;
    let child_attrs_offset = 0;
    const optional_attrs = emptyOptionalTextTagAttrs();
    const layout = this.layout;

    // Per SVG spec, an object with 'display:none' doesn't contribute to text layout.
    if (object.style.display.computed === SPCSSDisplay.SP_CSS_DISPLAY_NONE) return 0;

    const flowed =
      layout.wrap_mode === WrapMode.WRAP_SHAPE_INSIDE || layout.wrap_mode === WrapMode.WRAP_INLINE_SIZE;
    if (object instanceof SPText) {
      // SVG 2 Text wrapping.
      object.attributes.mergeInto(
        optional_attrs,
        parent_optional_attrs,
        parent_attrs_offset,
        !flowed,
        !flowed,
      );
      // For inline-size, 'y' gives the first baseline.
      if (layout.wrap_mode === WrapMode.WRAP_INLINE_SIZE) {
        const y = this._getFirstYLength();
        if (y) optional_attrs.y.push(y);
      }
      // set textLength on the entire layout
      if (object.attributes.getTextLength()._set) {
        layout.textLength = object.attributes.getTextLength().copy();
        layout.lengthAdjust = object.attributes.getLengthAdjust();
      }
    } else if (object instanceof SPTSpan) {
      // x, y attributes are stripped from some tspans marked with role="line" as we do our own line layout.
      // This should be checked carefully, as it can undo line layout in imported SVG files.
      const use_xy =
        !in_textpath &&
        !flowed &&
        (object.role === SP_TSPAN_ROLE_UNSPECIFIED || !object.attributes.singleXYCoordinates());
      object.attributes.mergeInto(
        optional_attrs,
        parent_optional_attrs,
        parent_attrs_offset,
        use_xy,
        !flowed,
      );

      if (object.role !== SP_TSPAN_ROLE_UNSPECIFIED) {
        // We are doing line wrapping using sodipodi:role="line". New lines have been stripped.

        // Insert paragraph break before text if not first tspan.
        const prev_object = object.getPrev();
        if (prev_object instanceof SPTSpan) {
          if (!layout.inputExists()) {
            // Add an object to store style, needed even if there is no text.
            layout.appendText('', prev_object.style, prev_object, optional_attrs);
          }
          layout.appendControlCode(TextControlCode.PARAGRAPH_BREAK, prev_object);
        }

        // Create empty span to store info (any non-empty tspan with sodipodi:role="line" has a child).
        if (!object.hasChildren()) layout.appendText('', object.style, object, optional_attrs);

        length++; // interpreting line breaks as a character for the purposes of x/y/etc attributes
        // is a liberal interpretation of the svg spec, but a strict reading would mean
        // that if the first line is empty the second line would take its place at the
        // start position. Very confusing.
        // SVG 2 clarifies, attributes are matched to unicode input characters so line
        // breaks do match to an x/y/etc attribute.
        child_attrs_offset--;
      }
    } else {
      // TODO: tref and textPath.
      Object.assign(optional_attrs, parent_optional_attrs);
      child_attrs_offset = parent_attrs_offset;
    }

    // Recurse
    for (const child of object.children) {
      if (child instanceof SPString) {
        layout.appendText(child.string, object.style, child, optional_attrs, child_attrs_offset + length);
        length += [...child.string].length;
      } else if (!sp_repr_is_meta_element(child.getRepr())) {
        length += this._buildLayoutInput(child, optional_attrs, child_attrs_offset + length, in_textpath);
      }
    }
    return length;
  }

  /** SVG requires one to use the first x/y value found on a child element if x/y not given on text element. */
  _getFirstXLength() {
    const x = this.attributes.getFirstXLength();
    if (x) return x;
    const tspan = this.children.find((c) => c instanceof SPTSpan);
    return tspan instanceof SPTSpan ? tspan.attributes.getFirstXLength() : null;
  }

  _getFirstYLength() {
    const y = this.attributes.getFirstYLength();
    if (y) return y;
    const tspan = this.children.find((c) => c instanceof SPTSpan);
    return tspan instanceof SPTSpan ? tspan.attributes.getFirstYLength() : null;
  }

  /** Completely recalculates the layout. */
  rebuildLayout(): void {
    this.layout.clear();
    this._buildLayoutInit();
    this._buildLayoutInput(this, emptyOptionalTextTagAttrs(), 0, false);
    this.layout.calculateFlow();
    // TODO: fitToPathAlign for textPath children.

    // set the x,y attributes on role:line spans
    for (const child of this.children) {
      if (
        child instanceof SPTSpan &&
        child.role !== SP_TSPAN_ROLE_UNSPECIFIED &&
        child.attributes.singleXYCoordinates()
      ) {
        const iter = this.layout.sourceToIterator(child);
        const anchor_point = this.layout.chunkAnchorPoint(iter);
        child.attributes.setFirstXY(anchor_point);
        // repr needs to be updated but if we do it here we get a loop.
      }
    }
  }

  /** Get the position of the baseline point for this text object. */
  getBaselinePoint(): Point | null {
    return this.layout.outputExists() ? this.layout.baselineAnchorPoint() : null;
  }

  is_horizontal(): boolean {
    const mode = this.style.writing_mode.computed;
    return (
      mode === SPCSSWritingMode.SP_CSS_WRITING_MODE_LR_TB ||
      mode === SPCSSWritingMode.SP_CSS_WRITING_MODE_RL_TB
    );
  }

  has_inline_size(): boolean {
    // If inline size is '0' it is as if it is not set.
    return this.style.inline_size.set && this.style.inline_size.value !== 0;
  }

  has_shape_inside(): boolean {
    return this.style.shape_inside.set;
  }

  /** The inline-size or shape-inside frame (the first rectangle; interim: any shape's bounding box). */
  get_frame(): OptRect {
    if (this.has_inline_size()) {
      const inline_size = this.style.inline_size.computed;
      const anchor = this.style.text_anchor.computed;
      const direction = this.style.direction.computed;
      if (this.is_horizontal()) {
        let frame = Rect.fromXywh(this.attributes.firstXY().x, -100000, inline_size, 200000);
        if (anchor === SPTextAnchor.SP_CSS_TEXT_ANCHOR_MIDDLE) {
          frame = frame.transformed(Translate(-inline_size / 2.0, 0));
        } else if (
          (direction === SPCSSDirection.SP_CSS_DIRECTION_LTR &&
            anchor === SPTextAnchor.SP_CSS_TEXT_ANCHOR_END) ||
          (direction === SPCSSDirection.SP_CSS_DIRECTION_RTL &&
            anchor === SPTextAnchor.SP_CSS_TEXT_ANCHOR_START)
        ) {
          frame = frame.transformed(Translate(-inline_size, 0));
        }
        return frame;
      }
      let frame = Rect.fromXywh(-100000, this.attributes.firstXY().y, 200000, inline_size);
      if (anchor === SPTextAnchor.SP_CSS_TEXT_ANCHOR_MIDDLE)
        frame = frame.transformed(Translate(0, -inline_size / 2.0));
      else if (anchor === SPTextAnchor.SP_CSS_TEXT_ANCHOR_END)
        frame = frame.transformed(Translate(0, -inline_size));
      return frame;
    }
    const shape = this.#shapeInsideItems()[0];
    return shape ? shape.bbox(shape.transform, BBoxType.GEOMETRIC_BBOX) : null;
  }
}

/**
 * Create a free standing piece of text at doc_pos (document coordinates) in
 * parent, with a sodipodi:role="line" tspan and an empty string. css is the style.
 */
export function create_text_at_position(
  parent: SPGroup,
  css: SPCSSAttr | null,
  doc_pos: Point,
  inline_size?: number,
): SPText | null {
  const xml_doc = parent.document.getReprDoc();
  const text_repr = xml_doc.createElement('svg:text');
  text_repr.setAttribute('xml:space', 'preserve'); // we preserve spaces in the text objects we create

  const pos = doc_pos.transformed(parent.i2docAffine().inverse());
  text_repr.setAttributeSvgDouble('x', pos.x);
  text_repr.setAttributeSvgDouble('y', pos.y);

  /* Create <tspan> */
  const span_repr = xml_doc.createElement('svg:tspan');
  span_repr.setAttribute('sodipodi:role', 'line'); // otherwise, why bother creating the tspan?
  // CSS property "vector-effect" doesn't inherit, so add it to <tspan> if part of default style.
  if (
    css &&
    spReprCssProperty(css, '-inkscape-stroke', '') === 'hairline' &&
    spReprCssProperty(css, 'vector-effect', '') === 'non-scaling-stroke'
  ) {
    span_repr.setAttribute('style', 'vector-effect:non-scaling-stroke;-inkscape-stroke:hairline');
  }
  text_repr.addChild(span_repr, null);

  /* Create TEXT */
  span_repr.addChild(xml_doc.createTextNode(''), null);
  const text_item = parent.appendChildRepr(text_repr);

  const style = css ?? spReprCssAttr(text_repr, 'style');
  if (inline_size !== undefined) spReprCssSetPropertyDouble(style, 'inline-size', inline_size);
  spReprCssSet(text_repr, style, 'style');

  return text_item instanceof SPText ? text_item : null;
}
