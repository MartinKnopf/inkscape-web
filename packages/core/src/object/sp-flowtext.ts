// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-flowtext.cpp, src/object/sp-flowtext.h
/*
 * Authors: see git history
 *
 * Copyright (C) 2018 Authors
 */
import { Affine, type OptRect, type PathVector, type Point, type Rect, Scale } from '@inkscape-web/geom';
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
import { getTextLayoutBackend, type WrapShape } from '../libnrtype/Layout-TNG-Scanline-Makers.ts';
import { SnapCandidatePoint } from '../snap-candidate.ts';
import { SnapSourceType, SnapTargetType } from '../snap-enums.ts';
import type { SnapPreferences } from '../snap-preferences.ts';
import { SPCSSTextAlign } from '../style-enums.ts';
import { SPCSSUnit } from '../style-internal.ts';
import { ink_font_from_style } from '../style-text.ts';
import { sp_svg_transform_write } from '../svg/svg-affine.ts';
import { SVGLength } from '../svg/svg-length.ts';
import type { XmlDocument } from '../xml/document.ts';
import type { Node } from '../xml/node.ts';
import { spReprCssAttr, spReprCssProperty } from '../xml/repr-css.ts';
import { sp_repr_is_meta_element } from '../xml/repr-util.ts';
import {
  modifiedTextChildren,
  SPFlowdiv,
  SPFlowline,
  SPFlowpara,
  SPFlowregionbreak,
  updateTextChildren,
  writeTextChildren,
} from './sp-flowdiv.ts';
import { SPFlowregion, SPFlowregionExclude } from './sp-flowregion.ts';
import { BBoxType, SPItem } from './sp-item.ts';
import type { SPGroup } from './sp-item-group.ts';
import {
  SP_OBJECT_CHILD_MODIFIED_FLAG,
  SP_OBJECT_MODIFIED_FLAG,
  SP_OBJECT_STYLE_MODIFIED_FLAG,
  type SPCtx,
  type SPObject,
} from './sp-object.ts';
import { SPRect } from './sp-rect.ts';
import { SPString } from './sp-string.ts';
import { SPText } from './sp-text.ts';
import { SP_TEXT_CONTENT_MODIFIED_FLAG, SP_TEXT_LAYOUT_MODIFIED_FLAG } from './sp-tspan.ts';
import { SPUse } from './sp-use.ts';
import { TextTagAttributes } from './text-tag-attributes.ts';

/**
 * svg:flowRoot (upstream SPFlowtext), SVG 1.2 flowed text: the text flows
 * into the shapes of the flowRegion, minus the flowRegionExclude shapes.
 */
export class SPFlowtext extends SPItem {
  readonly layout = new Layout();
  /** from inkscape:layoutOptions par-indent */
  par_indent = 0;
  _optimizeScaledText = false;

  protected override build(document: SPDocument, repr: Node): void {
    super.build(document, repr);
    this.readAttr(SPAttr.LAYOUT_OPTIONS); // must happen after css has been read
  }

  override set(key: SPAttr, value: string | null): void {
    if (key === SPAttr.LAYOUT_OPTIONS) {
      // deprecated attribute, read for backward compatibility only
      const opts = spReprCssAttr(this.getRepr(), 'inkscape:layoutOptions');
      const justification = spReprCssProperty(opts, 'justification', '');
      if (justification && !this.style.text_align.set) {
        this.style.text_align.value =
          justification === '0' || justification === 'false'
            ? SPCSSTextAlign.SP_CSS_TEXT_ALIGN_LEFT
            : SPCSSTextAlign.SP_CSS_TEXT_ALIGN_JUSTIFY;
        this.style.text_align.set = true;
        this.style.text_align.inherit = false;
        this.style.text_align.computed = this.style.text_align.value;
      }
      // This would probably translate to padding-left, if SPStyle had it.
      const indent = spReprCssProperty(opts, 'par-indent', '');
      this.par_indent = indent ? Number.parseFloat(indent) || 0 : 0;
      this.requestModified(SP_OBJECT_MODIFIED_FLAG);
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
    updateTextChildren(this, ctx, flags);
    super.update(ctx, flags);
    if (
      flags &
      (SP_OBJECT_STYLE_MODIFIED_FLAG | SP_OBJECT_CHILD_MODIFIED_FLAG | SP_TEXT_LAYOUT_MODIFIED_FLAG)
    ) {
      this.rebuildLayout();
      this.#showLayout();
    }
  }

  protected override modified(flags: number): void {
    if (flags & SP_OBJECT_STYLE_MODIFIED_FLAG) this.#showLayout();
    modifiedTextChildren(this, flags);
  }

  #showLayout(): void {
    const paintbox = this.geometricBounds();
    for (const v of this.views) {
      const g = v.drawingitem as DrawingGroup;
      g.clearChildren();
      g.setStyle(this.style);
      this.layout.show(v.drawing, g, paintbox);
    }
  }

  override write(xmlDoc: XmlDocument, repr: Node | null, flags: number): Node | null {
    writeTextChildren(this, flags);
    return super.write(xmlDoc, repr, flags);
  }

  override bbox(transform: Affine, type: BBoxType): OptRect {
    return this.layout.bounds(transform, type === BBoxType.VISUAL_BBOX);
  }

  protected override show(drawing: Drawing, _key: number, _flags: number): DrawingItem {
    const flowed = drawing.createGroup();
    flowed.setPickChildren(false);
    flowed.setStyle(this.style);
    this.layout.show(drawing, flowed, this.geometricBounds());
    return flowed;
  }

  protected override hide(key: number): void {
    for (const v of this.views) if (v.key === key) (v.drawingitem as DrawingGroup).clearChildren();
  }

  override typeName(): string {
    return 'text';
  }

  override displayName(): string {
    return this.has_internal_frame() ? _('Flowed Text') : _('Linked Flowed Text');
  }

  override description(): string {
    const nChars = this.layout.iteratorToCharIndex(this.layout.end());
    const trunc = this.layout.inputTruncated() ? _(' [truncated]') : '';
    return ngettext('(%d character%s)', '(%d characters%s)', nChars)
      .replace('%d', String(nChars))
      .replace('%s', trunc);
  }

  override snappoints(p: SnapCandidatePoint[], snapprefs: SnapPreferences): void {
    if (snapprefs.isTargetSnappable(SnapTargetType.SNAPTARGET_TEXT_BASELINE) && this.layout.outputExists()) {
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

  /** The frame after `after` (the last one if null): an item of the flowRegion (upstream get_frame). */
  get_frame(after: SPItem | null): SPItem | null {
    let frame: SPItem | null = null;
    const region = this.children.find((o) => o instanceof SPFlowregion);
    if (region) {
      let past = false;
      for (const o of region.children) {
        if (!(o instanceof SPItem)) continue;
        if (after === null || past) frame = o;
        else if (o === after) past = true;
      }
      if (frame instanceof SPUse) frame = frame.get_original();
    }
    return frame;
  }

  /** Whether the frame is a rectangle inside the flowRoot (upstream has_internal_frame). */
  has_internal_frame(): boolean {
    const frame = this.get_frame(null);
    return !!frame && this.isAncestorOf(frame) && frame instanceof SPRect;
  }

  /** The outlines of the glyphs (upstream getNormalizedBpath). */
  getNormalizedBpath(): PathVector {
    return this.layout.convertToCurves();
  }

  /** Get the position of the baseline point for this text object. */
  getBaselinePoint(): Point | null {
    return this.layout.outputExists() ? this.layout.baselineAnchorPoint() : null;
  }

  /**
   * Embed uniform scaling: scale the frame rectangle, the font size and the
   * stroke width; return the rest (upstream set_transform).
   */
  override setTransform(xform: Affine): Affine {
    if (
      (this._optimizeScaledText && !xform.withoutTranslation().isNonzeroUniformScale()) ||
      (!this._optimizeScaledText && !xform.isNonzeroUniformScale())
    ) {
      this._optimizeScaledText = false;
      return xform;
    }
    this._optimizeScaledText = false;

    const ex = xform.descrim();
    if (ex === 0) return xform;

    const region = this.children.find((o) => o instanceof SPFlowregion);
    const rect = region?.firstChild();
    if (rect instanceof SPRect) {
      rect.setI2dAffine(rect.i2dtAffine().multiply(xform));
      rect.doWriteTransform(rect.transform, null, true);
    }

    const ret = new Affine(xform.c0 / ex, xform.c1 / ex, xform.c2 / ex, xform.c3 / ex, xform.c4, xform.c5);

    // Adjust font size
    SPText._adjustFontsizeRecursive(this, ex);
    // Adjust stroke width
    this.adjustStrokeWidthRecursive(ex);
    // Adjust pattern fill
    this.adjust_pattern(xform.multiply(ret.inverse()));
    // TODO: adjust gradient fill.
    return Affine.identity();
  }

  /** Completely recalculates the layout. */
  rebuildLayout(): void {
    this.layout.clear();
    const pending: { object: SPObject | null } = { object: null };
    this._buildLayoutInput(this, this._buildExclusionShape(), pending);
    this.layout.calculateFlow();
  }

  /** Recursively walks the object tree adding tags and their contents (upstream _buildLayoutInput). */
  _buildLayoutInput(
    root: SPObject,
    exclusion_shape: WrapShape | null,
    pending_line_break_object: { object: SPObject | null },
  ): void {
    const layout = this.layout;
    const pi: OptionalTextTagAttrs = emptyOptionalTextTagAttrs();
    let with_indent = false;

    if (root instanceof SPFlowpara || root instanceof SPFlowdiv) {
      layout.wrap_mode = WrapMode.WRAP_SHAPE_INSIDE;

      layout.strut.reset();
      const style = this.style;
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

      // emulate par-indent with the first char's kern
      let t: SPObject | null = root;
      let ft: SPFlowtext | null = null;
      while (t && !ft) {
        if (t instanceof SPFlowtext) ft = t;
        t = t.parent;
      }
      if (ft && ft.par_indent !== 0) {
        with_indent = true;
        const sl = new SVGLength();
        sl.assign(ft.par_indent);
        pi.dx.push(sl);
      }
    }

    const flushBreak = () => {
      const pending = pending_line_break_object.object;
      if (!pending) return;
      layout.appendControlCode(
        pending instanceof SPFlowregionbreak ? TextControlCode.SHAPE_BREAK : TextControlCode.PARAGRAPH_BREAK,
        pending,
      );
      pending_line_break_object.object = null;
    };
    flushBreak();

    const backend = getTextLayoutBackend();
    for (const child of root.children) {
      if (child instanceof SPString) {
        flushBreak();
        layout.appendText(child.string, root.style, child, with_indent ? pi : null);
      } else if (child instanceof SPFlowregion) {
        if (!backend) continue;
        for (const it of child.computed) {
          const shape = exclusion_shape?.hasEdges()
            ? backend.booleen(it, exclusion_shape, 2)
            : backend.copyShape(it);
          layout.appendWrapShape(shape);
        }
      } else if (!(child instanceof SPFlowregionExclude) && !sp_repr_is_meta_element(child.getRepr())) {
        // Xml Tree is being directly used while it shouldn't be.
        this._buildLayoutInput(child, exclusion_shape, pending_line_break_object);
      }
    }

    if (
      root instanceof SPFlowdiv ||
      root instanceof SPFlowpara ||
      root instanceof SPFlowregionbreak ||
      root instanceof SPFlowline
    ) {
      if (!root.hasChildren()) layout.appendText('', root.style, root);
      pending_line_break_object.object = root;
    }
  }

  /** The union of the flowRegionExclude shapes (upstream _buildExclusionShape). */
  _buildExclusionShape(): WrapShape | null {
    const backend = getTextLayoutBackend();
    if (!backend) return null;
    let shape: WrapShape | null = null;
    for (const child of this.children) {
      // RH: is it right that this shouldn't be recursive?
      if (!(child instanceof SPFlowregionExclude)) continue;
      const computed = child.getComputed();
      if (!computed?.hasEdges()) continue;
      if (shape?.hasEdges()) {
        const shape_temp = backend.booleen(shape, computed, 0);
        shape.delete();
        shape = shape_temp;
      } else {
        shape?.delete();
        shape = backend.copyShape(computed);
      }
    }
    return shape;
  }

  /**
   * The text as svg:text with one sodipodi:role="line" tspan per line and
   * kerning that reproduces the flow (upstream getAsText, Text > Convert to Text).
   */
  getAsText(): Node | null {
    const layout = this.layout;
    if (!layout.outputExists()) return null;

    const xml_doc = this.document.getReprDoc();
    const repr = xml_doc.createElement('svg:text');
    repr.setAttribute('xml:space', 'preserve');
    repr.setAttribute('style', this.getRepr().attribute('style'));
    const anchor_point0 = layout.characterAnchorPoint(layout.begin());
    repr.setAttributeSvgDouble('x', anchor_point0.x);
    repr.setAttributeSvgDouble('y', anchor_point0.y);

    for (const it = layout.begin(); !it.equals(layout.end()); ) {
      const line_tspan = xml_doc.createElement('svg:tspan');
      line_tspan.setAttribute('sodipodi:role', 'line');

      const it_line_end = it.copy();
      it_line_end.nextStartOfLine();

      while (!it.equals(it_line_end)) {
        const span_tspan = xml_doc.createElement('svg:tspan');
        const anchor_point = layout.characterAnchorPoint(it);
        // use kerning to simulate justification and whatnot
        const it_span_end = it.copy();
        it_span_end.nextStartOfSpan();
        const attrs = emptyOptionalTextTagAttrs();
        layout.simulateLayoutUsingKerning(it, it_span_end, attrs);
        // set x,y attributes only when we need to
        let set_x = false;
        let set_y = false;
        if (!this.transform.isIdentity()) {
          set_x = set_y = true;
        } else {
          const it_chunk_start = it.copy();
          it_chunk_start.thisStartOfChunk();
          if (it.equals(it_chunk_start)) {
            set_x = true;
            // don't set y so linespacing adjustments and things will still work
          }
          const it_shape_start = it.copy();
          it_shape_start.thisStartOfShape();
          if (it.equals(it_shape_start)) set_y = true;
        }
        if (set_x && attrs.dx.length) {
          const zero = new SVGLength();
          zero.assign(0.0);
          attrs.dx[0] = zero;
        }
        const tag = new TextTagAttributes();
        tag.attributes = attrs;
        tag.writeTo(span_tspan);
        // FIXME: this will pick up the wrong end of counter-directional runs
        if (set_x) span_tspan.setAttributeSvgDouble('x', anchor_point.x);
        if (set_y) span_tspan.setAttributeSvgDouble('y', anchor_point.y);
        if (line_tspan.childCount() === 0) {
          line_tspan.setAttributeSvgDouble('x', anchor_point.x);
          line_tspan.setAttributeSvgDouble('y', anchor_point.y);
        }

        const { source: source_obj, text_offset: start } = layout.getSourceOfCharacter(it);
        if (source_obj) {
          const style_obj = source_obj instanceof SPString ? source_obj.parent : source_obj;
          const style_text = style_obj?.style.writeIfDiff(this.style) ?? '';
          span_tspan.setAttributeOrRemoveIfEmpty('style', style_text);
        }

        if (source_obj instanceof SPString) {
          const string = source_obj.string;
          let { source: span_end_obj, text_offset: end } = layout.getSourceOfCharacter(it_span_end);
          if (span_end_obj !== source_obj) {
            if (it_span_end.equals(layout.end())) {
              const n = layout.iteratorToCharIndex(it_span_end) - layout.iteratorToCharIndex(it);
              end = start + [...string.slice(start)].slice(0, n).join('').length;
            } else {
              end = string.length; // spans will never straddle a source boundary
            }
          }
          if (start !== end) span_tspan.appendChild(xml_doc.createTextNode(string.slice(start, end)));
          span_end_obj = null;
        }
        it._char_index = it_span_end._char_index;
        it._glyph_index = it_span_end._glyph_index;

        line_tspan.appendChild(span_tspan);
      }
      repr.appendChild(line_tspan);
    }
    return repr;
  }

  /**
   * Scale the shapes of the flow region by 1000 (or back), to keep text
   * from overflowing while it is edited (upstream fix_overflow_flowregion).
   */
  fix_overflow_flowregion(inverse: boolean): void {
    const region = this.children.find((o) => o instanceof SPFlowregion);
    if (!region) return;
    for (const childshape of region.childList()) {
      if (!(childshape instanceof SPItem)) continue;
      const scale = inverse ? 1 / 1000 : 1000; //200? maybe find better way to fix overglow issue removing new lines...
      childshape.doWriteTransform(childshape.transform.multiply(Scale(scale)), null, true);
    }
  }
}

/** A flowed text with its frame rectangle (upstream create_flowtext_with_internal_frame). */
export function create_flowtext_with_internal_frame(parent: SPGroup, rect_doc: Rect): SPItem | null {
  const doc = parent.document;
  const xml_doc = doc.getReprDoc();
  const root_repr = xml_doc.createElement('svg:flowRoot');
  root_repr.setAttribute('xml:space', 'preserve'); // we preserve spaces in the text objects we create
  root_repr.setAttributeOrRemoveIfEmpty('transform', sp_svg_transform_write(parent.i2docAffine().inverse()));
  const ft_item = parent.appendChildRepr(root_repr);

  const region_repr = xml_doc.createElement('svg:flowRegion');
  root_repr.appendChild(region_repr);

  const rect_repr = xml_doc.createElement('svg:rect'); // FIXME: use path!!! after rects are converted to use path
  region_repr.appendChild(rect_repr);
  const rect = doc.getObjectByRepr(rect_repr);
  if (rect instanceof SPRect) {
    rect.setPosition(rect_doc.min().x, rect_doc.min().y, rect_doc.width(), rect_doc.height());
    rect.updateRepr();
  }

  const para_repr = xml_doc.createElement('svg:flowPara');
  root_repr.appendChild(para_repr);
  para_repr.appendChild(xml_doc.createTextNode(''));

  return ft_item instanceof SPItem ? ft_item : null;
}
