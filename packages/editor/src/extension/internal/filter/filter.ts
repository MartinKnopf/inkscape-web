// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/internal/filter/filter.cpp, src/extension/internal/filter/filter.h
/*
 * Authors:
 *   Ted Gould <ted@gould.cx>
 *
 * Copyright (C) 2008 Authors
 */
import {
  DocumentUndo,
  type Node,
  type ObjectSet,
  type SPItem,
  spReprCssAttr,
  spReprCssProperty,
  spReprCssSet,
  spReprCssSetProperty,
  type XmlDocument,
} from '@inkscape-web/core';

const FILTER_SRC_GRAPHIC = 'fbSourceGraphic';
const FILTER_SRC_GRAPHIC_ALPHA = 'fbSourceGraphicAlpha';

/**
 * Copy the attributes (but the id) and the children of the filter from into to. With
 * srcGraphic, the inputs SourceGraphic and SourceAlpha are replaced by srcGraphic and
 * srcGraphicAlpha, and the first primitive without input reads srcGraphic: then the filter is
 * chained after the primitives that to has.
 */
export function merge_filters(
  to: Node,
  from: Node | null,
  doc: XmlDocument,
  srcGraphic: string | null = null,
  srcGraphicAlpha: string | null = null,
): void {
  if (from === null) return;

  for (const [attr, value] of from.attributeList()) {
    if (attr === 'id') continue; // nope, don't copy that one!
    to.setAttribute(attr, value);
    if (attr === 'in' || attr === 'in2' || attr === 'in3') {
      if (srcGraphic !== null && value === 'SourceGraphic') to.setAttribute(attr, srcGraphic);
      if (srcGraphicAlpha !== null && value === 'SourceAlpha') to.setAttribute(attr, srcGraphicAlpha);
    }
  }

  for (let from_child = from.firstChild(); from_child; from_child = from_child.next()) {
    if (from_child.type() !== 'element') continue;
    const to_child = doc.createElement(from_child.name());
    to.appendChild(to_child);
    merge_filters(to_child, from_child, doc, srcGraphic, srcGraphicAlpha);

    if (
      from_child === from.firstChild() &&
      from.name() === 'svg:filter' &&
      srcGraphic !== null &&
      to_child.attribute('in') === null
    ) {
      to_child.setAttribute('in', srcGraphic);
    }
  }
}

/** Put a copy of the filter in the defs of the item's document and set it as the item's filter. */
export function create_and_apply_filter(item: SPItem | null, filter: Node): void {
  if (!item) return;
  const node = item.getRepr();
  const document = item.document;
  const xmldoc = document.getReprDoc();
  const defsrepr = document.getDefs()?.getRepr();
  if (!defsrepr) return;

  const newfilterroot = xmldoc.createElement('svg:filter');
  merge_filters(newfilterroot, filter, xmldoc);
  defsrepr.appendChild(newfilterroot);
  // TODO: document->resources_changed_signals["filter"].emit()

  const url = `url(#${newfilterroot.attribute('id')})`;
  const css = spReprCssAttr(node, 'style');
  spReprCssSetProperty(css, 'filter', url);
  spReprCssSet(node, css, 'style');
}

/**
 * A filter effect (upstream Inkscape::Extension::Internal::Filter::Filter): a filter preset
 * that the Filters menu applies to the selection.
 */
export class Filter {
  constructor(
    /** The extension id, "org.inkscape.effect.filter." and the id of the preset. */
    readonly id: string,
    /** Untranslated name (the label of the preset). */
    readonly name: string,
    /** The submenus below Filters (untranslated). */
    readonly menu: readonly string[],
    /** Untranslated tooltip. */
    readonly menu_tip: string,
    /** The svg:filter of the preset. */
    readonly filter: Node,
  ) {}

  /** The action name of the effect (upstream Effect::get_sanitized_id). */
  get_sanitized_id(): string {
    return this.id.replaceAll('_', '-').replace(/[^A-Za-z0-9.-]/g, 'X');
  }

  /**
   * Apply the filter to the selected items: a new filter for items without one, else the
   * preset is chained after the primitives of their filter. One undo step with the name.
   */
  effect(selection: ObjectSet, undo_name: string): void {
    const doc = selection.document();
    if (!doc) return;
    const xmldoc = doc.getReprDoc();
    const defsrepr = doc.getDefs()?.getRepr();

    for (const spitem of selection.items()) {
      const node = spitem.getRepr();
      const css = spReprCssAttr(node, 'style');
      const filter = spReprCssProperty(css, 'filter', null);

      if (!filter) {
        create_and_apply_filter(spitem, this.filter);
        continue;
      }
      if (!filter.startsWith('url(#') || !filter.endsWith(')')) continue;
      const lfilter = filter.slice(5, -1);
      let filternode: Node | null = null;
      for (let child = defsrepr?.firstChild() ?? null; child; child = child.next()) {
        if (child.attribute('id') === lfilter) {
          filternode = child;
          break;
        }
      }
      if (!filternode) {
        console.warn('no assigned filter found!');
        continue;
      }

      if (!filternode.lastChild()) {
        merge_filters(filternode, this.filter, xmldoc);
      } else {
        filternode.lastChild()?.setAttribute('result', FILTER_SRC_GRAPHIC);

        const alpha = xmldoc.createElement('svg:feColorMatrix');
        alpha.setAttribute('result', FILTER_SRC_GRAPHIC_ALPHA);
        alpha.setAttribute('in', FILTER_SRC_GRAPHIC); // not required, but we're being explicit
        alpha.setAttribute('values', '0 0 0 -1 0 0 0 0 -1 0 0 0 0 -1 0 0 0 0 1 0');
        filternode.appendChild(alpha);

        merge_filters(filternode, this.filter, xmldoc, FILTER_SRC_GRAPHIC, FILTER_SRC_GRAPHIC_ALPHA);
      }
    }
    // upstream ExecutionEnv::commit
    DocumentUndo.done(doc, undo_name, '');
  }

  /** Apply the filter to item, as a new filter (upstream apply_filter, used by the gallery). */
  apply_filter(item: SPItem | null): boolean {
    if (!item) return false;
    create_and_apply_filter(item, this.filter);
    return true;
  }
}
