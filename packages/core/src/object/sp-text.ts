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
import {
  Affine,
  are_near,
  Point as GeomPoint,
  type OptRect,
  type PathVector,
  type Point,
  Rect,
  Translate,
  write_svg_path,
} from '@inkscape-web/geom';
import { SPAttr } from '../attributes.ts';
import type { Drawing, DrawingGroup, DrawingItem } from '../display/drawing.ts';
import type { SPDocument } from '../document.ts';
import { _, ngettext } from '../i18n.ts';
import {
  Direction,
  emptyOptionalTextTagAttrs,
  FontMetrics,
  Layout,
  type OptionalTextTagAttrs,
  TextControlCode,
  WrapMode,
} from '../libnrtype/Layout-TNG.ts';
import {
  getTextLayoutBackend,
  ShapeScanlineMaker,
  type WrapShape,
} from '../libnrtype/Layout-TNG-Scanline-Makers.ts';
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
import { ink_font_from_style } from '../style-text.ts';
import { sp_svg_transform_write } from '../svg/svg-affine.ts';
import { formatNumber, spSvgReadPercentage } from '../svg/svg-length.ts';
import type { XmlDocument } from '../xml/document.ts';
import { setHrefAttribute } from '../xml/href-attribute-helper.ts';
import type { Node } from '../xml/node.ts';
import {
  type SPCSSAttr,
  spReprCssAttr,
  spReprCssProperty,
  spReprCssSet,
  spReprCssSetProperty,
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
import { SPRect } from './sp-rect.ts';
import { SPShape } from './sp-shape.ts';
import { SPString } from './sp-string.ts';
import {
  SP_IS_TEXT_TEXTPATH,
  SP_TEXT_CONTENT_MODIFIED_FLAG,
  SP_TEXT_LAYOUT_MODIFIED_FLAG,
  SP_TSPAN_ROLE_UNSPECIFIED,
  SPTextPath,
  SPTSpan,
  sp_textpath_get_path_item,
} from './sp-tspan.ts';
import { TextTagAttributes } from './text-tag-attributes.ts';

/**
 * svg:text (upstream SPText). The layout is rebuilt from the children in
 * update(); the drawing shows the layout's spans.
 * TODO: tref children, print, getLinked, the gradient adjustment in setTransform.
 */
export class SPText extends SPItem {
  readonly attributes = new TextTagAttributes();
  readonly layout = new Layout();
  /** Allow one setTransform() optimization of text on a path (upstream _optimizeTextpathText). */
  _optimizeTextpathText = false;

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
    // we cannot optimize textpath because changing its fontsize will break its match to the path
    if (SP_IS_TEXT_TEXTPATH(this)) {
      if (!this._optimizeTextpathText) return xform;
      this._optimizeTextpathText = false;
    }
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
    // Adjust pattern fill
    this.adjust_pattern(xform.multiply(ret.inverse()));
    // TODO: adjust gradient fills.
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
    else if (item instanceof SPTextPath) item.attributes.transform(m, ex, ex, is_root);
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
    layout.strut.set(font);
    layout.strut.xheight = font.GetXHeight();
    layout.strut.scale(style.font_size.computed);
    if (style.line_height.normal) {
      layout.strut.computeEffective(Layout.LINE_HEIGHT_NORMAL);
    } else if (style.line_height.unit === SPCSSUnit.SP_CSS_UNIT_NONE) {
      layout.strut.computeEffective(style.line_height.computed);
    } else if (style.font_size.computed > 0.0) {
      layout.strut.computeEffective(style.line_height.computed / style.font_size.computed);
    }

    const backend = getTextLayoutBackend();
    // To do: follow SPItem clip_ref/mask_ref code
    if (style.shape_inside.set) {
      layout.wrap_mode = WrapMode.WRAP_SHAPE_INSIDE;
      for (const wrap_shape of this.makeEffectiveShapes()) layout.appendWrapShape(wrap_shape);
    } else if (this.has_inline_size()) {
      layout.wrap_mode = WrapMode.WRAP_INLINE_SIZE;

      // If both shape_inside and inline_size are set, shape_inside wins out.

      // We construct a rectangle with one dimension set by the computed value of 'inline-size'
      // and the other dimension set to infinity. Text is laid out starting at the 'x' and 'y'
      // attribute values. This is handled elsewhere.
      const frame = this.get_frame();
      if (frame && backend) {
        layout.appendWrapShape(backend.rectShape(frame.left(), frame.top(), frame.right(), frame.bottom()));
      }
    } else if (
      style.white_space.value === SPWhiteSpace.SP_CSS_WHITE_SPACE_PRE ||
      style.white_space.value === SPWhiteSpace.SP_CSS_WHITE_SPACE_PREWRAP ||
      style.white_space.value === SPWhiteSpace.SP_CSS_WHITE_SPACE_PRELINE
    ) {
      layout.wrap_mode = WrapMode.WRAP_WHITE_SPACE;
    }
  }

  /** The shape items referenced by shape-inside. */
  #shapeInsideItems(): SPItem[] {
    const items: SPItem[] = [];
    for (const href of this.style.shape_inside.hrefs) {
      const uri = href.getURI();
      const obj = href.getObject() ?? (uri ? this.document.getObjectById(uri.replace(/^#/, '')) : null);
      if (obj instanceof SPItem) items.push(obj);
    }
    return items;
  }

  /** The union of the shape-subtract shapes (upstream getExclusionShape). */
  getExclusionShape(): WrapShape | null {
    const backend = getTextLayoutBackend();
    if (!backend) return null;
    let result: WrapShape | null = null; // Union of all exclusion shapes
    for (const href of this.style.shape_subtract.hrefs) {
      const uri = href.getURI();
      const shape = href.getObject() ?? (uri ? this.document.getObjectById(uri.replace(/^#/, '')) : null);
      if (!(shape instanceof SPShape)) continue;
      if (!shape.curve()) shape.set_shape();
      const curve = shape.curve();
      if (!curve) continue;
      const margin = shape.style.shape_margin.set ? shape.style.shape_margin.computed : -1;
      const uncrossed = backend.exclusionShape(
        write_svg_path(curve),
        shape.getRelativeTransform(this),
        margin,
      );
      if (result?.hasEdges()) {
        const shape_temp = backend.booleen(result, uncrossed, 0);
        result.delete();
        uncrossed.delete();
        result = shape_temp;
      } else {
        result?.delete();
        result = uncrossed;
      }
    }
    return result;
  }

  /** The shape-inside shape of an item with shape-padding (upstream getInclusionShape). */
  getInclusionShape(shape: SPItem): WrapShape | null {
    let padding = Math.abs(this.style.shape_padding.computed);
    if (!this.style.shape_padding.set || padding < 1e-12) padding = -1;
    return SPText.makeInclusionShape(shape, padding);
  }

  /** The livarot shape of a shape-inside item, padding < 0: none (upstream makeInclusionShape). */
  static makeInclusionShape(shape: SPItem | null, padding = -1): WrapShape | null {
    const backend = getTextLayoutBackend();
    if (!backend || !(shape instanceof SPShape)) return null;
    if (!shape.curve()) shape.set_shape();
    const curve = shape.curve();
    if (!curve) return null;
    return backend.inclusionShape(write_svg_path(curve), shape.transform, padding);
  }

  /** Where the first line of text in a shape starts (upstream getFirstInsertionPosition). */
  static getFirstInsertionPosition(shape: SPItem, ltr: boolean): Point | null {
    const layout_shape = SPText.makeInclusionShape(shape);
    if (!layout_shape) return null;
    // TODO: Layout direction would need to return the value unrotated, since
    // the scanline maker can return interesting results when not in TTB.
    const scan = new ShapeScanlineMaker(layout_shape, Direction.TOP_TO_BOTTOM);
    const line = scan.makeScanline(new FontMetrics());
    scan.dispose();
    layout_shape.delete();
    const run = line[0];
    return run ? new GeomPoint(ltr ? run.x_start : run.x_end, run.y) : null;
  }

  /** The shape-inside shapes minus the shape-subtract shapes (upstream makeEffectiveShapes). */
  makeEffectiveShapes(): WrapShape[] {
    const backend = getTextLayoutBackend();
    if (!backend) return [];
    // Find union of all exclusion shapes
    const exclusion_shape = this.style.shape_subtract.set ? this.getExclusionShape() : null;
    const has_exclusion = !!exclusion_shape?.hasEdges();

    const result: WrapShape[] = [];
    // Find inside shape curves
    for (const obj of this.#shapeInsideItems()) {
      let textarea_shape = this.getInclusionShape(obj);
      if (!textarea_shape) continue;
      if (has_exclusion) {
        // Subtract exclusion shape
        const copy = backend.booleen(textarea_shape, exclusion_shape!, 2);
        textarea_shape.delete();
        textarea_shape = copy;
      }
      result.push(textarea_shape);
    }
    exclusion_shape?.delete();
    return result;
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
    let optional_attrs = emptyOptionalTextTagAttrs();
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

      // SVG 2 Text wrapping
      if (layout.wrap_mode === WrapMode.WRAP_INLINE_SIZE) {
        // For horizontal text:
        //   'x' is used to calculate the left/right edges of the rectangle but is not
        //   needed later. If not deleted here, it will cause an incorrect positioning
        //   of the first line.
        //   'y' is used to determine where the first line box is located and is needed
        //   during the output stage.
        // For vertical text:
        //   Follow above but exchange 'x' and 'y'.
        if (this.is_horizontal()) {
          const y = this._getFirstYLength();
          if (y) optional_attrs.y.push(y);
        } else {
          const x = this._getFirstXLength();
          if (x) optional_attrs.x.push(x);
        }
      }

      // set textLength on the entire layout, see note in TNG-Layout.h
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
    } else if (object instanceof SPTextPath) {
      in_textpath = true; // This should be made local so we can mix normal text with textpath per SVG 2.
      object.attributes.mergeInto(optional_attrs, parent_optional_attrs, parent_attrs_offset, false, true);
      optional_attrs.x = []; // Hmm, you can use x with horizontal text. So this is probably wrong.
      optional_attrs.y = [];
    } else {
      // TODO: tref.
      optional_attrs = parent_optional_attrs;
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

    for (const child of this.children) {
      if (child instanceof SPTextPath && child.originalPath) {
        this.layout.fitToPathAlign(child.startOffset, child.originalPath);
      }
    }

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
    // See if 'shape-inside' has rectangle
    const rectangle = this.get_first_rectangle();
    if (rectangle) {
      const x = rectangle.getAttributeDouble('x', 0.0);
      const y = rectangle.getAttributeDouble('y', 0.0);
      const width = rectangle.getAttributeDouble('width', 0.0);
      const height = rectangle.getAttributeDouble('height', 0.0);
      return Rect.fromXywh(x, y, width, height);
    }
    return null;
  }

  /** Find the node of the first rectangle (if it exists) in 'shape-inside'. */
  get_first_rectangle(): Node | null {
    if (this.style.shape_inside.set) {
      for (const shape of this.#shapeInsideItems()) {
        if (shape instanceof SPRect) return shape.getRepr();
      }
    }
    return null;
  }

  /**
   * Get the first shape reference which affects the position and layout of
   * this text item: a shape-inside or a textPath referenced shape.
   */
  get_first_shape_dependency(): SPItem | null {
    return this.get_all_shape_dependencies()[0] ?? null;
  }

  get_all_shape_dependencies(): SPItem[] {
    if (this.style.shape_inside.set) return this.#shapeInsideItems();
    const textpath = this.firstChild();
    if (textpath instanceof SPTextPath) {
      const item = sp_textpath_get_path_item(textpath);
      return item ? [item] : [];
    }
    return [];
  }

  /** The outlines of the glyphs (upstream getNormalizedBpath). */
  getNormalizedBpath(): PathVector {
    return this.layout.convertToCurves();
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

/** Create a text flowed into a new rectangle doc_rect (document coordinates) in the defs (upstream create_text_in_rectangle). */
export function create_text_in_rectangle(
  parent: SPGroup,
  css: SPCSSAttr | null,
  doc_rect: Rect,
): SPText | null {
  const xml_doc = parent.document.getReprDoc();

  // Create rectangle
  const rect = doc_rect.transformed(parent.i2docAffine().inverse());
  const rect_repr = xml_doc.createElement('svg:rect');
  rect_repr.setAttributeSvgDouble('x', rect.left());
  rect_repr.setAttributeSvgDouble('y', rect.top());
  rect_repr.setAttributeSvgDouble('width', rect.width());
  rect_repr.setAttributeSvgDouble('height', rect.height());

  // Add rectangle to defs.
  const defs = parent.document.getDefs();
  const box = defs?.appendChildRepr(rect_repr);
  if (!(box instanceof SPShape)) return null;
  return create_text_in_shape(parent, css, box);
}

/** Create a text that flows into shape with shape-inside (upstream create_text_in_shape). */
export function create_text_in_shape(parent: SPGroup, css: SPCSSAttr | null, shape: SPShape): SPText | null {
  const xml_doc = parent.document.getReprDoc();
  const text_repr = xml_doc.createElement('svg:text');
  text_repr.setAttribute('xml:space', 'preserve'); // we preserve spaces in the text objects we create

  // Text transform is uneffected by the shape's parent transforms (groups etc) but does already
  // have the transformation of the shape itself, if any.
  const tr = shape.parent instanceof SPItem ? parent.getRelativeTransform(shape.parent) : Affine.identity();
  text_repr.setAttributeOrRemoveIfEmpty('transform', sp_svg_transform_write(tr.inverse()));

  const text_item = parent.appendChildRepr(text_repr);

  const style = css ?? spReprCssAttr(text_repr, 'style');
  spReprCssSetProperty(style, 'white-space', 'pre');
  spReprCssSetProperty(style, 'shape-inside', `url(#${shape.getId()})`);
  spReprCssSet(text_repr, style, 'style');

  /* Create <tspan> */
  const rtspan = xml_doc.createElement('svg:tspan');
  rtspan.setAttribute('sodipodi:role', 'line'); // otherwise, why bother creating the tspan?
  rtspan.appendChild(xml_doc.createTextNode(''));
  text_repr.appendChild(rtspan);

  return text_item instanceof SPText ? text_item : null;
}

/**
 * Create a text on path at offset (0..1 of the path length) with alignment
 * align (< 0 start, 0 middle, > 0 end) (upstream create_text_on_path).
 */
export function create_text_on_path(
  parent: SPGroup,
  css: SPCSSAttr | null,
  path: SPShape,
  offset: number,
  align: number,
  right_side: boolean,
): SPText | null {
  const xml_doc = parent.document.getReprDoc();
  const text_repr = xml_doc.createElement('svg:text');
  text_repr.setAttribute('xml:space', 'preserve'); // we preserve spaces in the text objects we create
  const text_item = parent.appendChildRepr(text_repr);

  // Create textPath object and link to path
  const textpath_repr = xml_doc.createElement('svg:textPath');
  setHrefAttribute(textpath_repr, `#${path.getId()}`);
  textpath_repr.appendChild(xml_doc.createTextNode(''));
  text_repr.appendChild(textpath_repr);

  const style = css ?? spReprCssAttr(text_repr, 'style');
  if (align < 0) {
    spReprCssSetProperty(style, 'text-anchor', 'start');
    spReprCssSetProperty(style, 'text-align', 'start');
  } else if (align > 0) {
    spReprCssSetProperty(style, 'text-anchor', 'end');
    spReprCssSetProperty(style, 'text-align', 'end');
  } else {
    spReprCssSetProperty(style, 'text-anchor', 'middle');
    spReprCssSetProperty(style, 'text-align', 'center');
  }
  textpath_repr.setAttribute('startOffset', `${formatNumber(offset * 100.0, 3)}%`);
  textpath_repr.setAttribute('side', right_side ? 'right' : 'left');
  spReprCssSet(text_repr, style, 'style');
  return text_item instanceof SPText ? text_item : null;
}
