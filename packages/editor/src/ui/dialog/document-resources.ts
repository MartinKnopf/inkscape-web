// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/document-resources.cpp, src/ui/dialog/document-resources.h
/*
 * Document Resources dialog: the colors, fonts, styles, patterns, symbols, markers, gradients,
 * swatches, images, filters and external references that the document uses or defines.
 *
 * Authors:
 *   Michael Kowalski
 *
 * Copyright (C) 2023 Authors
 */
import {
  _,
  C_,
  type Colors,
  DocumentUndo,
  getHrefAttribute,
  N_,
  type SPDocument,
  SPFilter,
  SPFilterPrimitive,
  SPGradient,
  SPGroup,
  SPImage,
  SPMarker,
  SPMeshGradient,
  type SPObject,
  SPPath,
  SPPattern,
  SPSymbol,
  SPUse,
} from '@inkscape-web/core';
import type { SPDesktop } from '../../desktop.ts';

/** The pages of the dialog (upstream enum Resources); the value is the id of the category. */
export enum Resources {
  Stats = 'stats',
  Colors = 'colors',
  Fonts = 'fonts',
  Styles = 'styles',
  Patterns = 'patterns',
  Symbols = 'symbols',
  Markers = 'markers',
  Gradients = 'gradients',
  Swatches = 'swatches',
  Images = 'images',
  Filters = 'filters',
  External = 'external',
  Metadata = 'metadata',
}

/** The categories of the list on the left, in order, with their labels (untranslated); "-" is a separator. */
export const resource_categories: readonly (readonly [id: string, label: string])[] = [
  [Resources.Stats, N_('Overview')],
  ['-', ''],
  [Resources.Colors, N_('Colors')],
  [Resources.Swatches, N_('Swatches')],
  [Resources.Fonts, N_('Fonts')],
  [Resources.Gradients, N_('Gradients')],
  [Resources.Patterns, N_('Patterns')],
  [Resources.Symbols, N_('Symbols')],
  [Resources.Markers, N_('Markers')],
  [Resources.Filters, N_('Filters')],
  [Resources.Images, N_('Images')],
  [Resources.Styles, N_('Styles')],
  [Resources.External, N_('External resources')],
  [Resources.Metadata, N_('Metadata')],
];

/** What the document contains (upstream details::Statistics). */
export interface Statistics {
  nodes: number;
  groups: number;
  layers: number;
  paths: number;
  images: number;
  patterns: number;
  symbols: number;
  markers: number;
  fonts: number;
  filters: number;
  svg_fonts: number;
  colors: number;
  gradients: number;
  swatches: number;
  metadata: number;
  styles: number;
  meshgradients: number;
  colorprofiles: number;
  external_uris: number;
}

/** The number of resources of the category, 1 for the overview. */
export function get_resource_count(id: string, stats: Statistics): number {
  switch (id) {
    case Resources.Colors:
      return stats.colors;
    case Resources.Swatches:
      return stats.swatches;
    case Resources.Fonts:
      return stats.fonts;
    case Resources.Symbols:
      return stats.symbols;
    case Resources.Gradients:
      return stats.gradients;
    case Resources.Patterns:
      return stats.patterns;
    case Resources.Images:
      return stats.images;
    case Resources.Filters:
      return stats.filters;
    case Resources.Markers:
      return stats.markers;
    case Resources.Metadata:
      return stats.metadata;
    case Resources.Styles:
      return stats.styles;
    case Resources.External:
      return stats.external_uris;
    case Resources.Stats:
      return 1;
    default:
      return 0;
  }
}

/** Whether the category has entries, and so shows in the list. */
export const is_resource_present = (id: string, stats: Statistics): boolean =>
  get_resource_count(id, stats) > 0;

/** Visit the object and its descendants; the object that a clone shows is skipped. */
function apply_visitor(object: SPObject, visitor: (o: SPObject) => void): void {
  visitor(object);
  // SPUse inserts referenced object as a child; skip it
  if (object instanceof SPUse) return;
  for (const child of object.children) apply_visitor(child, visitor);
}

/** The colors that an object sets in its style, by their text (upstream collect_object_colors). */
function collect_object_colors(obj: SPObject, colors: Map<string, Colors.Color>): void {
  const style = obj.style;
  const add = (c: Colors.Color) => colors.set(c.toString(), c);
  if (style.stroke.set && style.stroke.isColor()) add(style.stroke.getColor());
  if (style.color.set) add(style.color.getColor());
  if (style.fill.set) add(style.fill.getColor());
  if (style.solid_color.set) add(style.solid_color.getColor());
}

/** The distinct colors used in the tree. */
export function collect_colors(root: SPObject | null): Map<string, Colors.Color> {
  const colors = new Map<string, Colors.Color>();
  if (root) apply_visitor(root, (o) => collect_object_colors(o, colors));
  return colors;
}

/** The distinct font specifications used in the tree (upstream collect_fontspecs). */
export function collect_fontspecs(root: SPObject | null): Set<string> {
  const fonts = new Set<string>();
  if (!root) return fonts;
  apply_visitor(root, (obj) => {
    const style = obj.style;
    if (style.font_specification.set) {
      const fspec = style.font_specification.value();
      if (fspec) fonts.add(fspec);
    } else if (style.font.set) {
      // some SVG files won't have Inkscape-specific fontspec; read font settings instead
      let font = style.font.getValue();
      if (style.font_style.set) font += ` ${style.font_style.getValue()}`;
      fonts.add(font);
    }
  });
  return fonts;
}

/** Patterns need children and gradients stops to be listed. */
const listed = (o: SPObject): boolean =>
  o instanceof SPPattern ? o.hasChildren() : o instanceof SPGradient ? o.hasStops() : true;

/** The objects of the class in the tree that are worth listing (upstream collect_items). */
export function collect_items<T extends SPObject>(
  root: SPObject | null,
  type: abstract new (...args: never[]) => T,
  filter: (o: T) => boolean = listed,
): T[] {
  const items: T[] = [];
  if (root) apply_visitor(root, (o) => void (o instanceof type && filter(o) && items.push(o)));
  return items;
}

/** The style attributes of the tree and how often each is used (upstream collect_styles). */
export function collect_styles(root: SPObject | null): Map<string, number> {
  const map = new Map<string, number>();
  if (root) {
    apply_visitor(root, (o) => {
      const style = o.getAttribute('style');
      if (style) map.set(style, (map.get(style) ?? 0) + 1);
    });
  }
  return map;
}

/** Whether the href of the object points outside of the document (a file or an URL, not data:). */
export function has_external_ref(obj: SPObject): boolean {
  const href = getHrefAttribute(obj.getRepr())[1];
  if (!href || href === '#' || href === '?' || href.startsWith('#')) return false;
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(href)?.[1]?.toLowerCase() ?? '';
  // There are tens of schemes; the ones that name another file or server count.
  return scheme === 'file' || scheme === 'http' || scheme === 'https' || scheme === '';
}

/** Collect what the document has. The metadata (RDF) is not ported: it counts as 0. */
export function collect_statistics(root: SPObject | null): Statistics {
  const stats: Statistics = {
    nodes: 0,
    groups: 0,
    layers: 0,
    paths: 0,
    images: 0,
    patterns: 0,
    symbols: 0,
    markers: 0,
    fonts: 0,
    filters: 0,
    svg_fonts: 0,
    colors: 0,
    gradients: 0,
    swatches: 0,
    metadata: 0,
    styles: 0,
    meshgradients: 0,
    colorprofiles: 0,
    external_uris: 0,
  };
  if (!root) return stats;
  const colors = new Map<string, Colors.Color>();
  const fonts = new Set<string>();
  apply_visitor(root, (obj) => {
    // order of tests is important; derived classes first, before base,
    // so meshgradient first, gradient next
    if (obj instanceof SPPattern) {
      if (listed(obj)) stats.patterns++;
    } else if (obj instanceof SPMeshGradient) stats.meshgradients++;
    else if (obj instanceof SPGradient) {
      if (listed(obj)) {
        if (obj.isSwatch()) stats.swatches++;
        else stats.gradients++;
      }
    } else if (obj instanceof SPMarker) stats.markers++;
    else if (obj instanceof SPSymbol) stats.symbols++;
    else if (obj instanceof SPImage) stats.images++;
    else if (obj instanceof SPGroup) {
      if (obj.getRepr().name() === 'svg:g') {
        if (obj.isLayer()) stats.layers++;
        else stats.groups++;
      }
    } else if (obj instanceof SPPath) stats.paths++;
    else if (obj instanceof SPFilter) stats.filters++;
    if (obj.getAttribute('style')) stats.styles++;
    if (has_external_ref(obj)) stats.external_uris++;
    collect_object_colors(obj, colors);
    stats.nodes++;
  });
  for (const f of collect_fontspecs(root)) fonts.add(f);
  stats.colors = colors.size;
  stats.fonts = fonts.size;
  return stats;
}

// The pages ---------------------------------------------------------------------------------------

/** A line of a table page: a name, a value and a count of uses (0: none). */
export interface InfoItem {
  item: string;
  /** Plain text. */
  value: string;
  count: number;
  object: SPObject | null;
}

/** An entry of a grid page: its id, label, an image (a CSS value for `background`) and the object. */
export interface ResourceItem {
  id: string;
  label: string;
  /** What the preview shows: a CSS background, or empty. */
  image: string;
  object: SPObject | null;
  editable: boolean;
  /** The 24 bit RGB of a color. */
  color: number;
}

/** The content of a page: a table or a grid. */
export type ResourcePage = { kind: 'info'; rows: InfoItem[] } | { kind: 'items'; items: ResourceItem[] };

const label_fmt = (label: string | null, id: string): string => (label ? label : `#${id}`);

/** The "inkscape:label" of an object, the text shown for it. Symbols use the title element. */
export function get_resource_label(object: SPObject): string {
  return object instanceof SPSymbol ? (object.title() ?? '') : (object.getAttribute('inkscape:label') ?? '');
}

/** Set the label (upstream g_set_label): the title of a symbol, else "inkscape:label". */
export function set_resource_label(object: SPObject, label: string): void {
  if (object instanceof SPSymbol) object.setTitle(label);
  else object.setAttribute('inkscape:label', label);
}

/** The CSS of the swatch of a color. */
function color_css(color: Colors.Color): string {
  return color.toString();
}

/** The CSS gradient of the stops of a gradient. */
function gradient_css(gradient: SPGradient): string {
  const vector = gradient.getVector();
  const stops: string[] = [];
  for (let stop = vector.getFirstStop(); stop; stop = stop.getNextStop()) {
    stops.push(`${color_css(stop.getColor())} ${Math.round(stop.offset * 100)}%`);
  }
  return stops.length ? `linear-gradient(to right, ${stops.join(', ')})` : '';
}

function items_of(
  objects: readonly SPObject[],
  use_title: boolean,
  image: (o: SPObject) => string,
): ResourceItem[] {
  return objects.map((object) => {
    const id = object.getId() ?? '';
    const label = use_title ? object.title() : object.getAttribute('inkscape:label');
    return { id, label: label_fmt(label, id), image: image(object), object, editable: true, color: 0 };
  });
}

/** The content of the page of the category for the document (upstream refresh_page). */
export function collect_page(doc: SPDocument | null, id: string, stats: Statistics): ResourcePage {
  const root = doc?.getRoot() ?? null;
  const defs = doc?.getDefs() ?? null;
  switch (id) {
    case Resources.Colors:
      return {
        kind: 'items',
        items: [...collect_colors(root)].map(([name, color]) => ({
          id: name,
          label: name,
          image: color_css(color),
          object: null,
          editable: false,
          color: color.toRGBA(0xff) >>> 8,
        })),
      };
    case Resources.Symbols:
      return { kind: 'items', items: items_of(collect_items(defs, SPSymbol), true, () => '') };
    case Resources.Patterns:
      return { kind: 'items', items: items_of(collect_items(defs, SPPattern), false, () => '') };
    case Resources.Markers:
      return { kind: 'items', items: items_of(collect_items(defs, SPMarker), false, () => '') };
    case Resources.Gradients:
      return {
        kind: 'items',
        items: items_of(
          collect_items(
            defs,
            SPGradient,
            (g) => !(g instanceof SPMeshGradient) && g.hasStops() && !g.isSwatch(),
          ),
          false,
          (o) => gradient_css(o as SPGradient),
        ),
      };
    case Resources.Swatches:
      return {
        kind: 'items',
        items: items_of(
          collect_items(defs, SPGradient, (g) => g.hasStops() && g.isSwatch()),
          false,
          (o) => gradient_css(o as SPGradient),
        ),
      };
    case Resources.Images:
      return {
        kind: 'items',
        items: items_of(
          collect_items(root, SPImage, () => true),
          false,
          (o) => {
            const href = (o as SPImage).href;
            return href ? `url("${href.replaceAll('"', '%22')}") center / contain no-repeat` : '';
          },
        ),
      };
    case Resources.Fonts:
      return {
        kind: 'info',
        rows: [...collect_fontspecs(root)].map((fs, i) => ({
          item: `${_('Font')} ${i + 1}`,
          value: fs,
          count: 0,
          object: null,
        })),
      };
    case Resources.Filters:
      return {
        kind: 'info',
        rows: collect_items(defs, SPFilter, () => true).map((filter) => ({
          item: filter.getAttribute('inkscape:label') || filter.getId() || '',
          value: filter.children
            .filter((c): c is SPFilterPrimitive => c instanceof SPFilterPrimitive)
            .map((c) => c.getRepr().name().replace('svg:', ''))
            .join(', '),
          count: 0,
          object: filter,
        })),
      };
    case Resources.Styles:
      return {
        kind: 'info',
        rows: [...collect_styles(root)]
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([style, count], i) => ({
            item: `${_('Style ')}${i + 1}`,
            value: style,
            count,
            object: null,
          })),
      };
    case Resources.External:
      return { kind: 'info', rows: external_rows(root) };
    case Resources.Metadata:
      return { kind: 'info', rows: [] };
    default:
      return { kind: 'info', rows: overview_rows(doc, stats) };
  }
}

function external_rows(root: SPObject | null): InfoItem[] {
  const rows: InfoItem[] = [];
  if (!root) return rows;
  apply_visitor(root, (obj) => {
    if (!has_external_ref(obj)) return;
    const href = getHrefAttribute(obj.getRepr())[1];
    if (href) rows.push({ item: label_fmt(null, obj.getId() ?? ''), value: href, count: 0, object: obj });
  });
  return rows;
}

/** The overview page: the file, and the number of each kind of resource (upstream add_stats). */
export function overview_rows(doc: SPDocument | null, stats: Statistics): InfoItem[] {
  const text = (item: string, value: string): InfoItem => ({ item, value, count: 0, object: null });
  const n = (item: string, v: number): InfoItem => text(item, v ? String(v) : '-');
  return [
    text(_('Document'), doc?.documentFilename ?? '-'),
    text(_('License'), '-'),
    text(_('Metadata'), stats.metadata > 0 ? C_('Adjective for Metadata status', 'Present') : '-'),
    n(_('Colors'), stats.colors),
    n(_('Color profiles'), stats.colorprofiles),
    n(_('Swatches'), stats.swatches),
    n(_('Fonts'), stats.fonts),
    n(_('Gradients'), stats.gradients),
    n(_('Mesh gradients'), stats.meshgradients),
    n(_('Patterns'), stats.patterns),
    n(_('Symbols'), stats.symbols),
    n(_('Markers'), stats.markers),
    n(_('Filters'), stats.filters),
    n(_('Images'), stats.images),
    n(_('SVG fonts'), stats.svg_fonts),
    n(_('Layers'), stats.layers),
    n(_('Total elements'), stats.nodes),
    n(_('Groups'), stats.groups),
    n(_('Paths'), stats.paths),
    n(_('External URIs'), stats.external_uris),
  ];
}

/** Whether the text matches the search, ignoring case. */
export const matches_search = (text: string, search: string): boolean =>
  !search || text.toLowerCase().includes(search.toLowerCase());

/** Delete the resource (upstream delete_object): patterns and gradients directly, other objects as a selection would. */
export function delete_object(object: SPObject | null, desktop: SPDesktop | null): void {
  if (!object) return;
  const document = object.document;
  if (object instanceof SPPattern) {
    object.deleteObject(true);
    DocumentUndo.done(document, C_('Undo', 'Delete pattern'), 'document-resources');
  } else if (object instanceof SPGradient) {
    object.deleteObject(true);
    DocumentUndo.done(document, C_('Undo', 'Delete gradient'), 'document-resources');
  } else if (desktop) {
    const selection = desktop.getSelection();
    selection.set(object);
    selection.deleteItems();
  } else {
    object.deleteObject(true);
    DocumentUndo.done(document, C_('Undo', 'Delete'), 'document-resources');
  }
}

/** The text of a GIMP palette file with the colors (24 bit RGB) and name (upstream save_gimp_palette). */
export function gimp_palette(colors: readonly number[], name: string | null): string {
  const lines = ['GIMP Palette'];
  if (name) lines.push(`Name: ${name}`);
  lines.push('#');
  for (const c of colors) lines.push(`${(c >> 16) & 0xff} ${(c >> 8) & 0xff} ${c & 0xff}`);
  return `${lines.join('\n')}\n`;
}
