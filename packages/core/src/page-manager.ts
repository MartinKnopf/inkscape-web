// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/page-manager.cpp, src/page-manager.h
/*
 * Inkscape::PageManager - Multi-Page management.
 *
 * Copyright 2021 Martin Owens <doctormo@geek-2.com>
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { type Affine, type OptRect, Point, Rect, Rotate, Translate } from '@inkscape-web/geom';
import type { SPDocument } from './document.ts';
import { _ } from './i18n.ts';
import { ObjectSet } from './object/object-set.ts';
import type { SPItem } from './object/sp-item.ts';
import { SPPage } from './object/sp-page.ts';
import { Preferences } from './preferences.ts';
import { convertUnit } from './svg/svg-length.ts';
import { findPaperSize } from './util/paper.ts';
import { Signal } from './util/signal.ts';
import type { Node } from './xml/node.ts';
import { sp_repr_compare_position } from './xml/repr-sorting.ts';

/** Upstream CanvasPage::DEFAULT_MARGIN_COLOR, DEFAULT_BLEED_COLOR and the shadow colors (0xRRGGBBAA). */
export const DEFAULT_MARGIN_COLOR = 0x1699d751;
export const DEFAULT_BLEED_COLOR = 0xbe310e31;
export const DEFAULT_SHADOW_COLOR = 0x000000a0;
export const DEFAULT_SHADOW_COLOR_LIGHT = 0xffffffa0;

/** Upstream format_number(value, 2): at most two decimals, no trailing zeros. */
function format_number(value: number, precision: number): string {
  return String(Number(value.toFixed(precision)));
}

/**
 * The pages of a document (upstream Inkscape::PageManager). A document
 * without pages has a single page: the viewport (width, height). The first
 * page enabled with enablePages() covers the viewport; it is the "viewport
 * page", and resizing or moving it resizes the document.
 *
 * Upstream keeps the page display attributes of the namedview (page color,
 * border, shadow, label style) here; they are read from the SPNamedView.
 */
export class PageManager {
  readonly #document: SPDocument;
  #selected_page: SPPage | null = null;
  #pages: SPPage[] = [];
  #disconnect_page_modified: (() => void) | null = null;

  readonly #page_selected_signal = new Signal<[SPPage | null]>();
  readonly #page_modified_signal = new Signal<[SPPage | null]>();
  readonly #pages_changed_signal = new Signal<[SPPage | null]>();

  constructor(document: SPDocument) {
    this.#document = document;
  }

  /** "Move objects with page" (/tools/pages/move_objects, default true). */
  static move_objects(): boolean {
    return Preferences.get().getBool('/tools/pages/move_objects', true);
  }

  getPages(): readonly SPPage[] {
    return this.#pages;
  }

  /**
   * Get the pages from a set of pages in the given set.
   *
   * @param page_pos - A set of page positions indexed from 1.
   * @param inverse - Reverse the selection, selecting pages not in page_pos.
   */
  getPagesByPosition(page_pos: ReadonlySet<number>, inverse = false): SPPage[] {
    return this.#pages.filter((page) => page_pos.has(page.getPagePosition()) !== inverse);
  }

  /** Add a page to this manager, called when the page is built. */
  addPage(page: SPPage): void {
    if (page.document !== this.#document) throw new Error('addPage: page of another document');
    // Refuse to double add pages to list.
    if (this.#pages.includes(page)) return;
    // Keep pages in the defs from being vacuumed (upstream _updateTotalHRefCount(1)).
    page.hrefObject();
    this.#pages.push(page);
    this.reorderPages();
    this.selectPage(page); // Select last page added.
    this.pagesChanged(page);
  }

  /** Remove a page from this manager */
  removePage(child: Node): void {
    const i = this.#pages.findIndex((page) => page.getRepr() === child);
    const page = this.#pages[i];
    if (!page) return;
    this.#pages.splice(i, 1);

    const first = this.getFirstPage();
    if (first && page.isViewportPage()) {
      this.#document.fitToRect(first.getDesktopRect(), false);
    }

    // Reselect because this page is gone.
    if (this.#selected_page === page) {
      this.selectPage(this.#pages[i] ?? this.#pages[i - 1] ?? null);
    }
    this.pagesChanged(null);
  }

  /**
   * Reorder pages within the internal list to keep it up to date by tracking
   * their order in the object tree.
   */
  reorderPages(): void {
    const before = [...this.#pages];
    this.#pages.sort((a, b) => sp_repr_compare_position(a.getRepr(), b.getRepr()));
    if (this.#pages.some((page, i) => page !== before[i])) this.pagesChanged(null);
  }

  /**
   * Enables multi page support by turning the document viewBox into
   * the first page. Ensures that there is a selected page.
   */
  enablePages(): void {
    if (!this.hasPages()) {
      this.#selected_page = this.newDocumentPage(this.#document.preferredBounds(), true);
    } else if (!this.#selected_page) {
      this.#selected_page = this.#pages.at(-1) ?? null;
    }
  }

  /** Disables multi page supply by removing all the page objects. */
  disablePages(): void {
    while (this.hasPages()) this.deletePage(this.getLastPage(), false);
  }

  /**
   * Add a new page of the default size, this will be either
   * the size of the viewBox if no pages exist, or the size
   * of the selected page.
   */
  newPage(): SPPage | null {
    this.enablePages();
    const selected = this.#selected_page;
    if (!selected) return null;
    const rect = selected.getRect();
    const new_page = this.newPageOfSize(rect.width(), rect.height());
    new_page?.copyFrom(selected);
    return new_page;
  }

  /** Add a new page of the given width and height (upstream newPage(width, height)). */
  newPageOfSize(width: number, height: number): SPPage | null {
    const loc = this.nextPageLocation();
    return this.newPageRect(Rect.fromXywh(loc.x, loc.y, width, height));
  }

  /** Return the location of the next created page. */
  nextPageLocation(): Point {
    // Get a new location for the page.
    let left = 0.0;
    for (const page of this.#pages) {
      const rect = page.getRect();
      if (rect.right() > left) left = rect.right() + 10;
    }
    return new Point(left, 0.0);
  }

  /** Add a new page with the given rectangle, in user units (upstream newPage(rect, first_page)). */
  newPageRect(rect: Rect, first_page = false): SPPage | null {
    // This turns on pages support, which will make two pages if none exist yet.
    // The first is the ViewBox page, and the second is made below as the "second"
    if (!this.hasPages() && !first_page) this.enablePages();

    const repr = this.#document.getReprDoc().createElement('svg:view');
    repr.setAttribute('viewBox', [rect.left(), rect.top(), rect.width(), rect.height()].join(' '));
    const page = this.#document.getDefs()?.appendChildRepr(repr);
    return page instanceof SPPage ? page : null;
  }

  /** Create a new page, resizing the rectangle from desktop coordinates. */
  newDesktopPage(rect: Rect, first_page = false): SPPage | null {
    return this.newDocumentPage(rect.transformed(this.#document.dt2doc()), first_page);
  }

  /** Create a new page, using document coordinates. */
  newDocumentPage(rect: Rect, first_page = false): SPPage | null {
    const s = this.#document.getDocumentScale();
    return this.newPageRect(
      new Rect(rect.left() / s.x, rect.top() / s.y, rect.right() / s.x, rect.bottom() / s.y),
      first_page,
    );
  }

  /**
   * Delete the given page.
   *
   * @param content - Also remove the svg objects that are inside the page.
   */
  deletePage(page: SPPage | null, content = false): void {
    if (page) {
      if (content) {
        const items_to_delete = new ObjectSet(this.#document);
        for (const item of page.getExclusiveItems()) items_to_delete.add(item);
        for (const item of page.getOverlappingItems()) {
          // Only delete objects when they rest on one page.
          if (this.getPagesFor(item, false).length === 1) items_to_delete.add(item);
        }
        items_to_delete.deleteItems(true);
      }
      // Only adjust if there will be a page after viewport page is deleted
      const fit_viewport = page.isViewportPage() && this.getPageCount() >= 2;

      // Removal from pages is done automatically via release().
      page.deleteObject();

      const first = this.getFirstPage();
      if (fit_viewport && first) this.#document.fitToRect(first.getDocumentRect(), false);
    }

    // As above with the viewbox shadowing, we need go back to a single page
    // (which is zero pages) when needed.
    const page_left = this.getFirstPage();
    if (page_left && this.getPageCount() === 1) {
      const rect = page_left.getDesktopRect();
      // We delete the page, only if it's bare (no margins etc)
      if (page_left.isBarePage()) this.deletePage(page_left, false);
      this.#document.fitToRect(rect, false);
    }
  }

  /** Delete the selected page (upstream deletePage(content)). */
  deleteSelectedPage(content = false): void {
    this.deletePage(this.#selected_page, content);
  }

  /**
   * Creates a new page of the size of the currently selected page,
   * and makes a deep copy of its overlapping elements.
   */
  duplicatePage(): SPPage | null {
    this.enablePages();
    const selected = this.#selected_page;
    if (!selected) return null;

    const contents = new ObjectSet(this.#document);
    contents.setList(selected.getOverlappingItems());

    const rect = selected.getRect();
    const new_page = this.newPageOfSize(rect.width(), rect.height());
    if (!new_page) return null;
    new_page.copyFrom(selected);

    const s = this.#document.getDocumentScale();
    const d = new_page.getRect().midpoint().sub(rect.midpoint());
    contents.duplicate(true, false);
    contents.applyAffine(Translate(d.x * s.x, d.y * s.y));
    return new_page;
  }

  /** Get page index, returns -1 if the page is not found in this document. */
  getPageIndex(page: SPPage | null): number {
    return page ? this.#pages.indexOf(page) : -1;
  }

  /** Return the index of the selected page */
  getSelectedPageIndex(): number {
    return this.getPageIndex(this.#selected_page);
  }

  /** Returns the selected page rect, OR the viewbox rect. */
  getSelectedPageRect(): Rect {
    return this.#selected_page?.getDesktopRect() ?? this.#document.preferredBounds();
  }

  /**
   * Called when the pages vector is updated, either page
   * deleted or page created (but not if the page is modified)
   */
  pagesChanged(new_page: SPPage | null): void {
    if (this.#pages.length === 0 || this.getSelectedPageIndex() === -1) this.selectPage(null);
    if (!this.#selected_page) this.selectPage(new_page);
    this.#pages_changed_signal.emit(new_page);
  }

  /**
   * Set the given page as the selected page.
   *
   * @returns whether the selected page changed
   */
  selectPage(page: SPPage | null): boolean {
    if (page && this.getPageIndex(page) < 0) return false;
    if (this.#selected_page === page) return false;
    this.#selected_page = page;
    this.#page_selected_signal.emit(page);

    // Modified signal for when the attributes themselves are modified.
    this.#disconnect_page_modified?.();
    this.#disconnect_page_modified = page
      ? page.modifiedSignal.connect(() => this.#page_modified_signal.emit(this.#selected_page))
      : null;
    return true;
  }

  /** selectPage() by index. */
  selectPageIndex(index: number): boolean {
    return this.selectPage(this.getPage(index));
  }
  selectNextPage(): boolean {
    return this.selectPageIndex(this.getSelectedPageIndex() + 1);
  }
  selectPrevPage(): boolean {
    return this.selectPageIndex(this.getSelectedPageIndex() - 1);
  }
  hasNextPage(): boolean {
    return this.getSelectedPageIndex() + 1 < this.#pages.length;
  }
  hasPrevPage(): boolean {
    return this.getSelectedPageIndex() - 1 >= 0;
  }

  /**
   * Select the first page that all the given SPItems are within.
   * If there is no such page, the selection will not be changed.
   * If multiple pages are valid, the currently selected page (if a match) will be preferred.
   *
   * @returns whether the selected page changed
   */
  selectBestPage(items: readonly SPItem[], contains: boolean): boolean {
    if (items.length === 0) return false;
    // Prefer currently selected page if that is a valid option
    const selected = this.#selected_page;
    if (selected && items.every((item) => selected.itemOnPage(item, contains))) return false;
    // Choose the first page all the items are on, if any
    const page = this.getPageForItems(items, contains);
    return page ? this.selectPage(page) : false;
  }

  getSelected(): SPPage | null {
    return this.#selected_page;
  }

  /** Get the page at the given position or return null if out of range. */
  getPage(index: number): SPPage | null {
    return this.#pages[index] ?? null;
  }
  getFirstPage(): SPPage | null {
    return this.getPage(0);
  }
  getLastPage(): SPPage | null {
    return this.getPage(this.#pages.length - 1);
  }
  hasPages(): boolean {
    return this.#pages.length > 0;
  }
  getPageCount(): number {
    return this.#pages.length;
  }

  /** Return a list of pages this item is on. */
  getPagesFor(item: SPItem, contains: boolean): SPPage[] {
    return this.#pages.filter((page) => page.itemOnPage(item, contains));
  }

  /** Return the first page that contains the given item */
  getPageFor(item: SPItem, contains: boolean): SPPage | null {
    return this.#pages.find((page) => page.itemOnPage(item, contains)) ?? null;
  }

  /** Return the first page that contains all the given items */
  getPageForItems(items: readonly SPItem[], contains: boolean): SPPage | null {
    const [front, ...rest] = items;
    if (!front) return null;
    // Check each candidate page in order, to see if all other items are a match for that page too
    return (
      this.getPagesFor(front, contains).find((page) =>
        rest.every((item) => page.itemOnPage(item, contains)),
      ) ?? null
    );
  }

  /** Get a page at a specific starting location. */
  getPageAt(pos: Point): SPPage | null {
    return this.#pages.find((page) => page.getDesktopRect().corner(0).equals(pos)) ?? null;
  }

  /**
   * This provides a simple way of selecting a page based on their layering
   * Pages which are entirely contained within another are selected before
   * their larger parents.
   */
  findPageAt(pos: Point): SPPage | null {
    let ret: SPPage | null = null;
    for (const page of this.#pages) {
      const rect = page.getSensitiveRect();
      // If the point is inside the page boundry
      // If we don't have a page yet, or the new page is inside the old one.
      if (rect.contains(pos) && (!ret || ret.getSensitiveRect().contains(rect))) ret = page;
    }
    return ret;
  }

  /**
   * Returns the page attached to the viewport, or null if no pages
   * or none of the pages are the viewport page.
   */
  getViewportPage(): SPPage | null {
    return this.#pages.find((page) => page.isViewportPage()) ?? null;
  }

  /** Returns the total area of all the pages in desktop units. */
  getDesktopRect(): OptRect {
    let total: OptRect = null;
    for (const page of this.#pages)
      total = total ? total.unionWith(page.getDesktopRect()) : page.getDesktopRect();
    return total;
  }

  /** Change page size, margins and bleeds by a set amount */
  scalePages(scale: Point): void {
    for (const page of this.#pages) {
      const r = page.getRect();
      page.setRect(
        new Rect(r.left() * scale.x, r.top() * scale.y, r.right() * scale.x, r.bottom() * scale.y),
      );
      for (let side = 0; side < 4; side++) {
        page.setMarginSide(side, page.getMarginSide(side) * scale.x);
        page.setBleedSide(side, page.getBleedSide(side) * scale.x);
      }
    }
  }

  /** Resize the selected page, in px (upstream resizePage(width, height)). */
  resizeSelectedPage(width: number, height: number): void {
    this.resizePage(this.#selected_page, width, height);
  }

  /** Resize page (the viewport without pages), in px. */
  resizePage(page: SPPage | null, width: number, height: number): void {
    if (this.#pages.length && !page) return;
    // Resizing the Viewport, means the page gets updated automatically
    if (!this.#pages.length || page?.isViewportPage()) {
      this.#document.fitToRect(new Rect(new Point(0, 0), new Point(width, height)), false);
    } else {
      page?.setSize(width, height);
    }
  }

  /** Rotate the selected page by the given number of 90 degree rotations. */
  rotatePage(turns: number): void {
    const page_size = this.getSelectedPageRect();
    const center = Translate(page_size.midpoint());
    const tr = center
      .inverse()
      .multiply(Rotate.from_degrees(turns * 90))
      .multiply(center);

    const contents = new ObjectSet(this.#document);
    contents.setList(
      this.#selected_page ? this.#selected_page.getOverlappingItems() : this.#document.getRoot().item_list(),
    );
    contents.applyAffine(tr);

    const new_box = new Rect(page_size.min().transformed(tr), page_size.max().transformed(tr));
    this.fitToRect(new_box, this.#selected_page);
  }

  /** Change page orientation, landscape to portrait and back. */
  changeOrientation(): void {
    const rect = this.getSelectedPageRect();
    this.resizeSelectedPage(rect.height(), rect.width());
  }

  /**
   * Resize the page to the given selection. If nothing is selected,
   * Resize to all the items on the selected page.
   */
  fitToSelection(selection: ObjectSet | null, add_margins = true, dkey = 0): void {
    if (!selection || selection.isEmpty()) {
      const page = this.#selected_page;
      // This means there aren't any pages, so revert to the default assumption
      // that the viewport is resized around ALL objects.
      if (!page) {
        this.fitToRect(this.#document.getRoot().documentPreferredBounds(), page, add_margins);
      } else {
        // This allows the pages to be resized around the items related to the page only.
        const contents = new ObjectSet(this.#document);
        contents.setList(this.getOverlappingItems(dkey, page));
        if (contents.isEmpty()) {
          this.fitToRect(this.#document.getRoot().documentPreferredBounds(), page, add_margins);
        } else {
          this.fitToSelection(contents, add_margins, dkey);
        }
      }
    } else {
      const rect = selection.documentPreferredBounds();
      if (rect) this.fitToRect(rect, this.#selected_page, add_margins);
    }
  }

  /** Fit the given page (or the viewport) to the given rectangle, in document coordinates. */
  fitToRect(rect: OptRect, page: SPPage | null, add_margins = false): void {
    if (!rect) return;
    let viewport = true;
    if (page) {
      viewport = page.isViewportPage();
      page.setDocumentRect(rect, add_margins);
      rect = page.getDocumentRect();
    }
    if (viewport) {
      this.#document.fitToRect(rect);
      if (page && !page.isViewportPage()) {
        // The document's fitToRect has slightly mangled the page rect, fix it.
        page.setDocumentRect(new Rect(new Point(0, 0), rect.dimensions()));
      }
    }
  }

  /** Return a list of objects touching this page, or viewbox (of single page document) */
  getOverlappingItems(
    dkey: number,
    page: SPPage | null,
    hidden = true,
    in_bleed = false,
    in_layers = true,
  ): SPItem[] {
    if (page) return page.getOverlappingItems(hidden, in_bleed, in_layers);
    return this.#document.getItemsPartiallyInBox(
      dkey,
      this.#document.preferredBounds(),
      true,
      true,
      true,
      false,
      in_layers,
    );
  }

  /** The canvas label style of the namedview: "below" shows the page number under each page. */
  showDefaultLabel(): boolean {
    return this.#document.getNamedView().label_style === 'below';
  }

  /** Return a page's size label, or match via width and height. */
  getSizeLabel(page: SPPage | null = null): string {
    let box = this.#document.preferredBounds();
    if (page) {
      box = page.getDesktopRect();
      const label = page.getSizeLabel();
      if (label) return _(label);
    }
    return this.getSizeLabelFor(box.width(), box.height());
  }

  /**
   * Loop through all page sizes to find a matching one for this width and height.
   * Upstream matches the template presets; here the paper sizes (util/paper.ts).
   */
  getSizeLabelFor(width: number, height: number): string {
    const preset = findPaperSize(width, height, 'px');
    if (preset) return _(preset.name);
    const unit = this.#document.getNamedView().getDisplayUnit();
    return `${format_number(convertUnit(width, 'px', unit), 2)} × ${format_number(convertUnit(height, 'px', unit), 2)} ${unit}`;
  }

  /** The page shadow color: light on a very dark desk. */
  getShadowColor(): number {
    const desk = this.#document.getNamedView().getDeskColor().toRGBA();
    const c = [24, 16, 8].map((shift) => ((desk >>> shift) & 0xff) / 255);
    const lightness = (Math.max(...c) + Math.min(...c)) / 2;
    return lightness < 0.05 ? DEFAULT_SHADOW_COLOR_LIGHT : DEFAULT_SHADOW_COLOR;
  }

  /** Called when the viewbox is resized. */
  movePages(tr: Affine): void {
    // Adjust each page against the change in position of the viewbox.
    for (const page of this.#pages) page.movePage(tr, false);
  }

  connectPageSelected(slot: (page: SPPage | null) => void): () => void {
    return this.#page_selected_signal.connect(slot);
  }
  /** connectPageModified tracks changes to the selected page only. */
  connectPageModified(slot: (page: SPPage | null) => void): () => void {
    return this.#page_modified_signal.connect(slot);
  }
  connectPagesChanged(slot: (page: SPPage | null) => void): () => void {
    return this.#pages_changed_signal.connect(slot);
  }
}
