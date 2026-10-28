// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-flowtext.cpp, src/object/sp-flowtext.h
/*
 * Authors: see git history
 *
 * Copyright (C) 2018 Authors
 */
import type { Affine, OptRect } from '@inkscape-web/geom';
import type { Drawing, DrawingGroup, DrawingItem } from '../display/drawing.ts';
import { _, ngettext } from '../i18n.ts';
import { Layout, TextControlCode, WrapMode } from '../libnrtype/Layout-TNG.ts';
import { computeFontLineHeight } from '../libnrtype/Layout-TNG-Compute.ts';
import { getTextMeasurer, ink_font_from_style } from '../libnrtype/text-measurer.ts';
import { SnapCandidatePoint } from '../snap-candidate.ts';
import { SnapSourceType, SnapTargetType } from '../snap-enums.ts';
import type { SnapPreferences } from '../snap-preferences.ts';
import type { XmlDocument } from '../xml/document.ts';
import type { Node } from '../xml/node.ts';
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
import {
  SP_OBJECT_CHILD_MODIFIED_FLAG,
  SP_OBJECT_MODIFIED_FLAG,
  SP_OBJECT_STYLE_MODIFIED_FLAG,
  type SPCtx,
  type SPObject,
} from './sp-object.ts';
import { SPString } from './sp-string.ts';
import { SP_TEXT_CONTENT_MODIFIED_FLAG, SP_TEXT_LAYOUT_MODIFIED_FLAG } from './sp-tspan.ts';

/**
 * svg:flowRoot (upstream SPFlowtext), SVG 1.2 flowed text. Read and shown;
 * the text flows into the bounding box of the first flowRegion.
 * TODO: the flow region shapes, flowRegionExclude, par-indent, getAsText
 * (convert to text), set_transform optimization, create_flowtext_with_internal_frame.
 */
export class SPFlowtext extends SPItem {
  readonly layout = new Layout();

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

  /** The flowRegion after `after` (or the first one). */
  get_frame(after: SPItem | null): SPItem | null {
    let past = after === null;
    for (const child of this.children) {
      if (!(child instanceof SPFlowregion)) continue;
      for (const item of child.children) {
        if (!(item instanceof SPItem)) continue;
        if (past) return item;
        if (item === after) past = true;
      }
    }
    return null;
  }

  /** Whether the frame is a child of the flowRegion (not a clone of another shape). */
  has_internal_frame(): boolean {
    const frame = this.get_frame(null);
    return !!frame && this.isAncestorOf(frame) && frame.getRepr().name() === 'svg:rect';
  }

  /** Completely recalculates the layout. */
  rebuildLayout(): void {
    const layout = this.layout;
    layout.clear();
    layout.wrap_mode = WrapMode.WRAP_SHAPE_INSIDE;
    layout.strut.reset();
    const font = ink_font_from_style(this.style);
    layout.strut.set(getTextMeasurer().fontMetrics(font), font.size);
    layout.strut.scale(this.style.font_size.computed);
    layout.strut.computeEffective(computeFontLineHeight(this.style));

    const region = this.children.find((c) => c instanceof SPFlowregion);
    const frame = region instanceof SPFlowregion ? region.computedBounds() : null;
    if (frame) layout.appendWrapShape(frame);

    const pending: { object: SPObject | null } = { object: null };
    this.#buildLayoutInput(this, pending);
    layout.calculateFlow();
  }

  /** Recursively walks the object tree adding tags and their contents. */
  #buildLayoutInput(root: SPObject, pending_line_break_object: { object: SPObject | null }): void {
    const layout = this.layout;
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

    for (const child of root.children) {
      if (child instanceof SPString) {
        flushBreak();
        layout.appendText(child.string, root.style, child);
      } else if (!(child instanceof SPFlowregion) && !(child instanceof SPFlowregionExclude)) {
        this.#buildLayoutInput(child, pending_line_break_object);
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
}
