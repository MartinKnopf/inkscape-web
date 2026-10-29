// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-page.cpp, src/object/sp-page.h
/*
 * Inkscape pages implementation
 *
 * Authors:
 *   Martin Owens <doctormo@geek-2.com>
 *
 * Copyright (C) 2021 Martin Owens
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { type Affine, Point, Rect, Scale, Translate } from '@inkscape-web/geom';
import { SPAttr } from '../attributes.ts';
import type { SPDocument } from '../document.ts';
import { _ } from '../i18n.ts';
import { type BoxSide, SVGBox } from '../svg/svg-box.ts';
import type { XmlDocument } from '../xml/document.ts';
import type { Node } from '../xml/node.ts';
import { ObjectSet } from './object-set.ts';
import type { SPItem } from './sp-item.ts';
import { SPGroup } from './sp-item-group.ts';
import { SP_OBJECT_MODIFIED_FLAG, SP_OBJECT_WRITE_BUILD, type SPCtx, SPObject } from './sp-object.ts';
import { SPViewBox } from './viewbox.ts';

/** Multiply a rect by the document scale (upstream rect * Geom::Scale). */
function scaled(rect: Rect, scale: Point): Rect {
  return rect.transformed(Scale(scale));
}

/**
 * A page of a multipage document: an svg:view element in the defs (upstream
 * SPPage). The viewBox is the page rectangle in user units; inkscape:margin,
 * inkscape:bleed and inkscape:page-size hold the margin box, the bleed box
 * and the name of the size preset.
 *
 * The page registers itself with the document's PageManager when it is built
 * and unregisters on release. Upstream the page owns its CanvasPage; here the
 * desktop draws the pages of the PageManager (the core has no display).
 */
export class SPPage extends SPObject {
  /** viewBox of the page (upstream private base class SPViewBox). */
  readonly vb = new SPViewBox();
  /** Selected highlight, set by the pages tool (upstream CanvasPage::is_selected). */
  is_selected = false;

  margin = new SVGBox();
  bleed = new SVGBox();
  #size_label = '';
  /**
   * This stores a value when the page is being moved or shuffled and we need
   * to prevent double resizing as viewBox changes pages and visa-versa
   */
  _can_be_viewport = true;

  protected override build(document: SPDocument, repr: Node): void {
    super.build(document, repr);
    // SVG 2.0 Attributes
    this.readAttr(SPAttr.VIEWBOX);
    // Inkscape attributes
    this.readAttr(SPAttr.PAGE_MARGIN);
    this.readAttr(SPAttr.PAGE_BLEED);
    this.readAttr(SPAttr.INKSCAPE_LABEL);
    this.readAttr(SPAttr.PAGE_SIZE_NAME);
    // Register (upstream: document->addResource("page", this) and the page-manager's resource signal)
    document.getPageManager().addPage(this);
  }

  protected override release(): void {
    // Unregister ourselves
    this.document?.getPageManager().removePage(this.repr);
    super.release();
  }

  override set(key: SPAttr, value: string | null): void {
    switch (key) {
      case SPAttr.VIEWBOX:
        this.vb.set_viewBox(value);
        break;
      case SPAttr.PAGE_MARGIN:
        this.margin.readOrUnset(value, this.document.getDocumentScale());
        break;
      case SPAttr.PAGE_BLEED:
        this.bleed.readOrUnset(value, this.document.getDocumentScale());
        break;
      case SPAttr.PAGE_SIZE_NAME:
        this.#size_label = value ?? '';
        break;
      default:
        super.set(key, value);
        break;
    }
    this.#update_relatives();
    this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
  }

  protected override position_changed(): void {
    this.document.getPageManager().reorderPages();
  }

  /** Update the percentage values of the svg boxes */
  #update_relatives(): void {
    if (this.vb.viewBox_set) {
      const rect = this.getRect();
      if (this.margin.isSet()) this.margin.update(12, 6, rect.width(), rect.height());
      if (this.bleed.isSet()) this.bleed.update(12, 6, rect.width(), rect.height());
    }
  }

  /** Returns true if the only aspect to this page is its size */
  isBarePage(): boolean {
    return !this.margin.isSet() && !this.bleed.isSet();
  }

  /** Gets the rectangle in document units */
  getRect(): Rect {
    return this.vb.viewBox;
  }

  /** Get the rectangle of the page, in desktop units */
  getDesktopRect(): Rect {
    return this.getDocumentRect().transformed(this.document.doc2dt());
  }

  /** Get the rectangle of the page, scaled to the document. */
  getDocumentRect(): Rect {
    return scaled(this.getRect(), this.document.getDocumentScale());
  }

  /** Get document rect, minus the margin amounts. */
  getDocumentMargin(): Rect {
    const r = this.getRect();
    const m = this.margin;
    const rect = new Rect(
      r.left() + m.left().computed,
      r.top() + m.top().computed,
      r.right() - m.right().computed,
      r.bottom() - m.bottom().computed,
    );
    if (rect.hasZeroArea()) return this.getDocumentRect(); // Cancel!
    return scaled(rect, this.document.getDocumentScale());
  }

  getDesktopMargin(): Rect {
    return this.getDocumentMargin().transformed(this.document.doc2dt());
  }

  /** Get page rect enlarged by bleed amounts */
  getBleed(): Rect {
    const r = this.getRect();
    const b = this.bleed;
    const rect = new Rect(
      r.left() - b.left().computed,
      r.top() - b.top().computed,
      r.right() + b.right().computed,
      r.bottom() + b.bottom().computed,
    );
    if (rect.hasZeroArea()) return this.getRect();
    return rect;
  }

  /** Get document rect, plus the bleed amounts. */
  getDocumentBleed(): Rect {
    return scaled(this.getBleed(), this.document.getDocumentScale());
  }

  getDesktopBleed(): Rect {
    return this.getDocumentBleed().transformed(this.document.doc2dt());
  }

  /**
   * Like getDesktopRect but returns a slightly shrunken rectangle
   * so interactions don't confuse the border with the object.
   */
  getSensitiveRect(): Rect {
    return this.getDesktopRect().expandBy(-0.1);
  }

  /** Set the page rectangle in its native units. */
  setRect(rect: Rect): void {
    this.vb.viewBox = rect;
    this.vb.viewBox_set = true;
    // always clear size label, toolbar is responsible for putting it back if needed.
    this.#size_label = '';
    // This is needed to update the xml
    this.updateRepr();
    this.requestModified(SP_OBJECT_MODIFIED_FLAG);
  }

  /** Set the page rectangle in document coordinates. */
  setDocumentRect(rect: Rect, add_margins = false): void {
    const s = this.document.getDocumentScale();
    rect = scaled(rect, new Point(1 / s.x, 1 / s.y));
    if (add_margins) {
      // Add margins to rectangle.
      const m = this.margin;
      rect = new Rect(
        rect.left() - m.left().computed,
        rect.top() - m.top().computed,
        rect.right() + m.right().computed,
        rect.bottom() + m.bottom().computed,
      );
    }
    this.setRect(rect);
  }

  /** Set the page rectangle in desktop coordinates. */
  setDesktopRect(rect: Rect): void {
    this.setDocumentRect(rect.transformed(this.document.dt2doc()));
  }

  /**
   * Set just the height and width from a predefined size, in document/desktop
   * units (pages are aligned to the coordinate axes).
   */
  setSize(width: number, height: number): void {
    const rect = this.getDocumentRect();
    this.setDocumentRect(Rect.fromXywh(rect.left(), rect.top(), width, height));
  }

  /** Set the page's margin, from user input in the display unit. */
  setMargin(value: string): void {
    this.margin.fromString(
      value,
      this.document.getNamedView().getDisplayUnit(),
      this.document.getDocumentScale(),
    );
    this.updateRepr();
  }

  /** Set the page's bleed, from user input in the display unit. */
  setBleed(value: string): void {
    this.bleed.fromString(
      value,
      this.document.getNamedView().getDisplayUnit(),
      this.document.getDocumentScale(),
    );
    this.updateRepr();
  }

  /** Get the margin side of the box. */
  getMarginSide(side: BoxSide): number {
    return this.margin.get(side);
  }

  /** Set the margin at this side of the box in user units. */
  setMarginSide(side: BoxSide, value: number, confine = false): void {
    if (confine && !this.margin.isSet()) this.margin.set(value);
    else this.margin.setSide(side, value, confine);
    this.updateRepr();
  }

  /** Set the margin at this side from user input in the display unit. */
  setMarginSideText(side: BoxSide, value: string, confine = false): void {
    const scale = this.document.getDocumentScale();
    const unit = this.document.getNamedView().getDisplayUnit();
    if (confine && !this.margin.isSet()) this.margin.fromString(value, unit, scale);
    else this.margin.fromStringSide(side, value, unit, scale);
    this.updateRepr();
  }

  getMarginLabel(): string {
    return this.#boxLabel(this.margin);
  }

  getBleedLabel(): string {
    return this.#boxLabel(this.bleed);
  }

  #boxLabel(box: SVGBox): string {
    if (!box.isSet() || box.isZero()) return '';
    return box.toString(this.document.getNamedView().getDisplayUnit(), this.document.getDocumentScale(), 2);
  }

  getBleedSide(side: BoxSide): number {
    return this.bleed.get(side);
  }

  setBleedSide(side: BoxSide, value: number): void {
    this.bleed.setSide(side, value, false);
    this.updateRepr();
  }

  /**
   * Get the items which are ONLY on this page and don't overlap.
   *
   * This ignores layers so items in the same layer which are shared
   * between pages are not moved around or exported into pages they
   * shouldn't be.
   */
  getExclusiveItems(hidden = true, in_bleed = false, in_layers = true): SPItem[] {
    const box = in_bleed ? this.getDocumentBleed() : this.getDocumentRect();
    return this.document.getItemsInBox(0, box, hidden, true, true, false, in_layers);
  }

  /** Like getExclusiveItems above but get all the items which are inside or overlapping. */
  getOverlappingItems(hidden = true, in_bleed = false, in_layers = true): SPItem[] {
    const box = in_bleed ? this.getDocumentBleed() : this.getDocumentRect();
    return this.document.getItemsPartiallyInBox(0, box, hidden, true, true, false, in_layers);
  }

  /**
   * Return true if this item is contained within the page boundary.
   *
   * @param contains - If true the test will be if the shape is entirely contained,
   *                   rather than just partly overlaps.
   * @param groups - If true, groups will be tested as a whole object instead of one
   *                 object at a time.
   */
  itemOnPage(item: SPItem, contains = false, groups = true): boolean {
    if (!groups && item instanceof SPGroup) {
      return item.item_list().some((child) => this.itemOnPage(child));
    }
    const box = item.desktopGeometricBounds();
    if (!box) return false;
    return contains ? this.getDesktopRect().contains(box) : this.getDesktopRect().intersects(box);
  }

  /** Returns true if this page is the same as the viewport. */
  isViewportPage(): boolean {
    const a = this.getDocumentRect().corner(0);
    const b = this.document.preferredBounds().corner(0);
    return (
      this._can_be_viewport && Math.floor(a.x) === Math.floor(b.x) && Math.floor(a.y) === Math.floor(b.y)
    );
  }

  /** Set the selected high-light for this page. */
  setSelected(sel: boolean): void {
    this.is_selected = sel;
    this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
  }

  /** Returns the page number (order of pages) starting at 0 */
  getPageIndex(): number {
    return this.document.getPageManager().getPageIndex(this);
  }

  /** Returns the page number starting at 1 */
  getPagePosition(): number {
    return this.getPageIndex() + 1;
  }

  /**
   * Set this page to a new order in the page stack.
   *
   * @param index - Placement of page in the stack, starting at '0'
   * @param swap_page - Swap the rectangle position
   *
   * @returns true if page has been moved.
   */
  setPageIndex(index: number, swap_page: boolean): boolean {
    const current = this.getPageIndex();
    if (current === index) return false;
    const page_manager = this.document.getPageManager();

    // The page we're going to be shifting to
    let sibling = page_manager.getPage(index);

    // Insertions are done to the right of the sibling
    if (index < current) index -= 1;
    let insert_after = page_manager.getPage(index);

    // We may have selected an index off the end, so attach it after the last page.
    if (!insert_after && index > 0) {
      insert_after = page_manager.getLastPage();
      sibling = null; // disable swap
    }

    const repr = this.getRepr();
    if (insert_after) {
      if (this === insert_after) {
        console.warn('Page is already at this index. Not moving.');
        return false;
      }
      // Attach after the given page
      repr.parent()?.changeOrder(repr, insert_after.getRepr());
    } else {
      // Attach to before any existing page
      sibling = page_manager.getFirstPage();
      repr.parent()?.changeOrder(repr, null);
    }
    if (sibling && swap_page) this.swapPage(sibling, true);

    page_manager.selectPage(this);
    return true;
  }

  /** setPageIndex() with the position starting at 1. */
  setPagePosition(position: number, swap_page: boolean): boolean {
    return this.setPageIndex(position - 1, swap_page);
  }

  /**
   * Move the page by the given affine, in desktop units.
   *
   * @param with_objects - Flag to request that connected objects also move.
   */
  movePage(translate: Affine, with_objects: boolean): void {
    if (!translate.isTranslation()) return;
    if (with_objects) {
      // Move each item that is overlapping this page too
      SPPage.moveItems(translate, this.getOverlappingItems());
    }
    this.setDesktopRect(this.getDesktopRect().transformed(translate));
  }

  /** Move the given items by the given translation in document units. */
  static moveItems(translate: Affine, items: readonly SPItem[]): void {
    const first = items[0];
    if (!first) return;
    const set = new ObjectSet(first.document);
    for (const item of items) {
      if (item.isLocked()) continue;
      set.add(item);
    }
    set.applyAffine(translate, true, false, true);
  }

  /** Swap the locations of this page with another page (see movePage) */
  swapPage(other: SPPage, with_objects: boolean): void {
    // Flip direction so we know which page will be the viewport
    if (other.isViewportPage()) {
      other.swapPage(this, with_objects);
      return;
    }

    // Swapping with the viewport page must be handled gracefully.
    if (this.isViewportPage()) {
      const other_rect = other.getDesktopRect();
      this.document.fitToRect(
        new Rect(new Point(0, 0), new Point(other_rect.width(), other_rect.height())),
        false,
      );
    }

    // Prevent any resizing of these pages by the viewport when doc.ensureUpToDate()
    // is called by the move objects functionality that needs accurate bboxes.
    this._can_be_viewport = false;
    other._can_be_viewport = false;

    const this_affine = Translate(this.getDesktopRect().corner(0));
    const other_affine = Translate(other.getDesktopRect().corner(0));
    this.movePage(this_affine.inverse().multiply(other_affine), with_objects);
    other.movePage(other_affine.inverse().multiply(this_affine), with_objects);

    this._can_be_viewport = true;
    other._can_be_viewport = true;
  }

  /** The label shown on the canvas: the page label, or the position with the "below" label style. */
  getCanvasLabel(): string {
    const lbl = this.label();
    if (lbl) return lbl;
    return this.document.getPageManager().showDefaultLabel() ? String(this.getPagePosition()) : '';
  }

  protected override update(_ctx: SPCtx, _flags: number): void {
    // Upstream updates its CanvasPage here; the desktop redraws the pages on the modified signal.
  }

  /** Write out the page's data into its xml structure. */
  override write(xmlDoc: XmlDocument, repr: Node | null, flags: number): Node | null {
    if (flags & SP_OBJECT_WRITE_BUILD && !repr) repr = xmlDoc.createElement('svg:view');
    if (repr) {
      this.vb.write_viewBox(repr);
      repr.setAttributeOrRemoveIfEmpty('inkscape:margin', this.margin.isSet() ? this.margin.write() : null);
      repr.setAttributeOrRemoveIfEmpty('inkscape:bleed', this.bleed.isSet() ? this.bleed.write() : null);
      repr.setAttributeOrRemoveIfEmpty('inkscape:page-size', this.#size_label);
    }
    return super.write(xmlDoc, repr, flags);
  }

  setSizeLabel(label: string): void {
    this.#size_label = label;
    // This is needed to update the xml
    this.updateRepr();
  }

  getDefaultLabel(): string {
    return _('Page %d').replace('%d', String(this.getPagePosition()));
  }

  getLabel(): string {
    return this.label() ?? this.getDefaultLabel();
  }

  getSizeLabel(): string {
    return this.#size_label;
  }

  /** Copy non-size attributes from the given page. */
  copyFrom(page: SPPage): void {
    this.#size_label = page.#size_label;
    const scale = this.document.getDocumentScale();
    if (page.margin.isSet()) this.margin.read(page.margin.write(), scale);
    if (page.bleed.isSet()) this.bleed.read(page.bleed.write(), scale);
    this.updateRepr();
  }
}
