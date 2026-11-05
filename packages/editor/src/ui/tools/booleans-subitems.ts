// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tools/booleans-subitems.cpp, src/ui/tools/booleans-subitems.h
/*
 * SubItem controls each fractured piece and links it to its original items.
 *
 * Authors:
 *   Martin Owens
 *   PBS
 *
 * Copyright (C) 2022 Authors
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import {
  BooleanOp,
  FillRule,
  flatten,
  pathBoolopBackend,
  SPGroup,
  SPImage,
  SPItem,
  SPShape,
  type SPStyle,
  SPText,
  SPUse,
  SPWindRule,
  sp_object_compare_position,
  sp_pathvector_boolop,
} from '@inkscape-web/core';
import {
  type Affine,
  Path as GeomPath,
  type OptRect,
  type Path,
  PathVector,
  Point,
  parse_svg_path,
  Translate,
  unify,
  write_svg_path,
} from '@inkscape-web/geom';

/** Upstream is_path_empty (helper/geom-pathstroke.cpp): whether the area of the path is about 0. */
export function is_path_empty(path: Path): boolean {
  // The area of the polygon of the path, with 16 samples per curve.
  let area = 0;
  let a = path.initialPoint();
  const curves = path.closed() ? path.curves() : [...path.curves(), path.closingSegment()];
  for (const c of curves) {
    const n = c.isLineSegment() ? 1 : 16;
    for (let i = 1; i <= n; i++) {
      const b = c.pointAt(i / n);
      area += a.x * b.y - b.x * a.y;
      a = b;
    }
  }
  return Math.abs(area / 2) < 1e-3;
}

/** Upstream to_livarot(): the livarot fill rule of a style fill rule. */
function to_livarot(fill_rule: SPWindRule): FillRule {
  return fill_rule === SPWindRule.SP_WIND_RULE_EVENODD ? FillRule.fill_oddEven : FillRule.fill_nonZero;
}

// Todo: (Wishlist) Remove this function when no longer necessary to remove boolops artifacts.
function clean_pathvector(pathv: PathVector): PathVector {
  return pathv.filter((path) => path.closed() && !is_path_empty(path));
}

/**
 * When an item is broken, each broken part is represented by
 * the SubItem class. This class hold information such as the
 * original items it originated from and the paths that it
 * consists of (in desktop coordinates).
 */
export class SubItem {
  #paths: PathVector;
  readonly #root: SPItem | null;
  readonly #item: SPItem | null;
  readonly #style: SPStyle | null;
  readonly #is_image: boolean;
  #selected = false;

  constructor(paths: PathVector, root: SPItem | null, item: SPItem | null, style: SPStyle | null) {
    this.#paths = paths;
    this.#root = root;
    this.#item = item;
    this.#style = style;
    this.#is_image = SubItem.#get_is_image(item);
  }

  /** A copy (not selected). */
  clone(): SubItem {
    return new SubItem(this.#paths, this.#root, this.#item, this.#style);
  }

  /**
   * Union operator, merges two subitems when requested by the user
   * The left hand side will retain priority for the resulting style
   * so you should be mindful of how you merge these shapes.
   */
  add(other: SubItem): this {
    this.#paths = clean_pathvector(
      flatten(
        sp_pathvector_boolop(
          this.#paths,
          other.#paths,
          BooleanOp.bool_op_union,
          FillRule.fill_nonZero,
          FillRule.fill_nonZero,
        ),
        FillRule.fill_nonZero,
      ),
    );
    return this;
  }

  /** Return true if this subitem contains the give point. */
  contains(pt: Point): boolean {
    return PathVector.winding(this.#paths, pt) % 2 !== 0;
  }

  get_pathv(): PathVector {
    return this.#paths;
  }
  get_root(): SPItem | null {
    return this.#root;
  }
  get_item(): SPItem | null {
    return this.#item;
  }
  getStyle(): SPStyle | null {
    return this.#style;
  }
  is_image(): boolean {
    return this.#is_image;
  }
  getSelected(): boolean {
    return this.#selected;
  }
  setSelected(selected: boolean): void {
    this.#selected = selected;
  }

  /** Test if this sub item is a special image type. */
  static #get_is_image(item: SPItem | null): boolean {
    return item instanceof SPImage || item instanceof SPUse;
  }

  /**
   * Take a list of items and fracture into a list of SubItems ready for
   * use inside the booleans interactive tool.
   */
  static build_mosaic(items: SPItem[]): SubItem[] {
    // Sort so that topmost items come first.
    items.sort((a, b) => sp_object_compare_position(b, a));

    // Extract all individual pathvectors within the collection of items,
    // keeping track of their associated item and style, again sorted topmost-first.
    let augmented: PathvectorItem[] = [];
    for (const item of items) {
      // Get the correctly-transformed pathvectors, together with their corresponding styles.
      extract_pathvectors_recursive(item, item, augmented, item.i2dtAffine());
    }

    // We want the images to be the first items in augmented, so they get the priority for the style.
    // Bubble them to the front, otherwise preserving order.
    const is_img = (pvi: PathvectorItem) => pvi.item instanceof SPImage || pvi.item instanceof SPUse;
    augmented = [...augmented.filter(is_img), ...augmented.filter((pvi) => !is_img(pvi))];

    // Compute a slightly expanded bounding box, collect together all lines, and cut the former by the latter.
    let found_bounds: OptRect = null;
    const lines: PathVector = [];
    for (const pvi of augmented) {
      found_bounds = unify(found_bounds, PathVector.boundsExact(pvi.pathv));
      lines.push(...pvi.pathv);
    }
    if (!found_bounds) return [];

    const expansion = 10.0;
    const bounds = found_bounds.expandBy(expansion);

    const bounds_pathv = [GeomPath.fromRect(bounds)];
    const pieces = pathBoolopBackend()
      .cutPath(write_svg_path(bounds_pathv), write_svg_path(lines))
      .map((d) => parse_svg_path(d));

    // Construct the SubItems, attempting to guess the corresponding augmented item for each piece.
    const result: SubItem[] = [];
    const near = (a: number, b: number) => Math.abs(a - b) <= expansion / 2;

    for (let piece of pieces) {
      // Skip the big enclosing piece that is touching the outer boundary.
      const rect = PathVector.boundsExact(piece);
      if (
        rect &&
        (near(rect.top(), bounds.top()) ||
          near(rect.bottom(), bounds.bottom()) ||
          near(rect.left(), bounds.left()) ||
          near(rect.right(), bounds.right()))
      ) {
        continue;
      }

      // Remove junk paths that are open and/or tiny.
      piece = piece.filter((path) => path.closed() && !is_path_empty(path));

      // Skip empty pathvectors.
      if (piece.length === 0 || !rect) continue;

      // Determine the corresponding augmented item.
      // Fixme: (Wishlist) This is done unreliably and hackily, but livarot/2geom seemingly offer no alternative.
      const hits = new Map<PathvectorItem | null, number>();
      const add_hit = (pt: Point) => {
        // Find an augmented item containing the point.
        for (const pvi of augmented) {
          const fill_rule = pvi.item.style.fill_rule.computed;
          const winding = PathVector.winding(pvi.pathv, pt);
          if (fill_rule === SPWindRule.SP_WIND_RULE_NONZERO ? winding : winding % 2) {
            hits.set(pvi, (hits.get(pvi) ?? 0) + 1);
            return;
          }
        }
        // If none exists, register a background hit with nullptr.
        hits.set(null, (hits.get(null) ?? 0) + 1);
      };

      for (let total_hits = 0, patience = 1000; total_hits < 20 && patience > 0; patience--) {
        // Attempt to generate a point strictly inside the piece.
        const pt = new Point(
          rect.left() + Math.random() * rect.width(),
          rect.top() + Math.random() * rect.height(),
        );
        if (PathVector.winding(piece, pt)) {
          add_hit(pt);
          total_hits++;
        }
      }

      // Pick the augmented item with the most hits.
      let found: PathvectorItem | null = null;
      let max_hits = 0;
      for (const [a, h] of hits) {
        if (h > max_hits) {
          max_hits = h;
          found = a;
        }
      }

      // Add the SubItem.
      const item = found?.item ?? null;
      result.push(new SubItem(piece, found?.root ?? null, item, item?.style ?? null));
    }

    return result;
  }

  /** Take a list of items and flatten into a list of SubItems. */
  static build_flatten(items: SPItem[]): SubItem[] {
    // Sort so that topmost items come first.
    items.sort((a, b) => sp_object_compare_position(b, a));

    const result: SubItem[] = [];
    let unioned: PathVector = [];

    for (const item of items) {
      // Get the correctly-transformed pathvectors, together with their corresponding styles.
      const extracted: PathvectorItem[] = [];
      extract_pathvectors_recursive(item, item, extracted, item.i2dtAffine());

      for (const { pathv: extracted_pathv, root, item: subitem } of extracted) {
        // Close any non closed objects
        const closed = extracted_pathv.map((path) => {
          const copy = path.clone();
          copy.close();
          return copy;
        });

        // Skip pathvectors that are empty
        if (closed.length === 0) continue;

        // Flatten the remaining pathvector according to its fill rule.
        const pathv = flatten(closed, to_livarot(subitem.style.fill_rule.computed));

        // Remove the union so far from the shape, then add the shape to the union so far.
        let uniq: PathVector;
        if (unioned.length === 0) {
          uniq = pathv;
          unioned = pathv;
        } else {
          const nz = FillRule.fill_nonZero;
          uniq = sp_pathvector_boolop(unioned, pathv, BooleanOp.bool_op_diff, nz, nz);
          unioned = sp_pathvector_boolop(unioned, pathv, BooleanOp.bool_op_union, nz, nz);
        }

        // Add the new SubItem.
        result.push(new SubItem(uniq, root, subitem, subitem.style));
      }
    }

    return result;
  }
}

/** A structure containing all the detected shapes and their respective spitems */
interface PathvectorItem {
  pathv: PathVector;
  root: SPItem;
  item: SPItem;
}

/** The paths of item and its descendants in desktop coordinates (transform: item to desktop). */
function extract_pathvectors_recursive(
  root: SPItem,
  item: SPItem,
  result: PathvectorItem[],
  transform: Affine,
): void {
  if (item instanceof SPGroup) {
    for (const child of [...item.children].reverse()) {
      if (child instanceof SPItem) {
        extract_pathvectors_recursive(root, child, result, child.transform.multiply(transform));
      }
    }
  } else if (item instanceof SPImage) {
    // TODO: use the clip path of the image (getClipPathVector).
    const curve = item.get_curve();
    if (curve) result.push({ pathv: PathVector.transformed(curve, transform), root, item });
  } else if (item instanceof SPShape) {
    const curve = item.curve();
    if (curve) result.push({ pathv: PathVector.transformed(curve, transform), root, item });
  } else if (item instanceof SPText) {
    result.push({ pathv: PathVector.transformed(item.getNormalizedBpath(), transform), root, item });
  } else if (item instanceof SPUse) {
    // TODO: a clipped clone of an image is consumed as a single object (getClipPathVector).
    const child = item.child;
    if (child) {
      const tr = child.transform
        .multiply(Translate(item.dims.x.computed, item.dims.y.computed))
        .multiply(transform);
      extract_pathvectors_recursive(root, child, result, tr);
    }
  }
}
