// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tools/spray-tool.cpp, src/ui/tools/spray-tool.h
/*
 * Spray Tool
 *
 * Authors:
 *   Pierre-Antoine MARC
 *   Pierre CACLIN
 *   Aurel-Aimé MARMION
 *   Julien LERAY
 *   Benoît LAVORATA
 *   Vincent MONTAGNE
 *   Pierre BARBRY-BLOT
 *   Steren GIANNINI (steren.giannini@gmail.com)
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *   Jabiertxo Arraiza <jabier.arraiza@marker.es>
 *   Adrian Boguszewski
 *
 * Copyright (C) 2009 authors
 */
import {
  C_,
  DocumentUndo,
  ObjectSet,
  Preferences,
  pathUnion,
  SPGroup,
  SPItem,
  SPShape,
  SPUse,
} from '@inkscape-web/core';
import {
  type Affine,
  type OptRect,
  Path,
  type PathVector,
  Point,
  PathVector as PV,
  Rect,
  Rotate,
  Scale,
  Translate,
} from '@inkscape-web/geom';
import { have_viable_layer } from '../../context-fns.ts';
import type { SPDesktop } from '../../desktop.ts';
import { CanvasItemBpath } from '../../display/control/canvas-item-bpath.ts';
import { type ExtendedInput, extinput_from_event } from './dynamic-base.ts';
import { mod_ctrl_only, mod_shift_only, ToolBase } from './tool-base.ts';

const TC_MIN_PRESSURE = 0.0;
const TC_MAX_PRESSURE = 1.0;
const TC_DEFAULT_PRESSURE = 0.35;

export enum SprayMode {
  SPRAY_MODE_COPY,
  SPRAY_MODE_CLONE,
  SPRAY_MODE_SINGLE_PATH,
  SPRAY_MODE_ERASER,
  SPRAY_OPTION,
}

const clamp = (v: number, min: number, max: number): number => Math.min(Math.max(v, min), max);

/** A random number in [min, max) (upstream g_random_double_range). */
const random_range = (min: number, max: number): number => min + Math.random() * (max - min);

/**
 * This function returns pseudo-random numbers from a normal distribution
 * @param mu : mean
 * @param sigma : standard deviation ( > 0 )
 */
function NormalDistribution(mu: number, sigma: number): number {
  // use Box Muller's algorithm
  return (
    mu +
    sigma * Math.sqrt(-2.0 * Math.log(1 - random_range(0, 1))) * Math.cos(2.0 * Math.PI * random_range(0, 1))
  );
}

/**
 * Transform the affine around the point. For example if it's a rotation, scale and/or skew it will be applied relative to the center point.
 */
function transform_around_point(center: Point, affine: Affine): Affine {
  const translate = Translate(center);
  return translate.inverse().multiply(affine).multiply(translate);
}

function transform_keep_center(item: SPItem, affine: Affine, center: Point): void {
  // This order allows us to avoid more reprUpdates than needed
  item.setI2dAffine(item.i2dtAffine().multiply(affine));
  // upstream SPItem::updateCenterIfSet
  if (item.isCenterSet()) item.setCenter(center);
  item.doWriteTransform(item.transform);
}

/** The outlines of item in document coordinates, centered at (0, 0) for the root item (upstream get_paths). */
function get_paths(item: SPItem, res: PathVector, root = true): PathVector {
  let bbox = item.documentVisualBounds();
  if (!bbox) return res;
  const clone = item instanceof SPUse ? item : null;
  if (item instanceof SPGroup) {
    for (const ig of item.children) if (ig instanceof SPItem) res = get_paths(ig, res, false);
  } else if (item instanceof SPShape) {
    const trans = item.i2docAffine();
    for (const path of item.curve() ?? []) res.push(path.transformed(trans));
  } else if (clone && !root) {
    const orig = clone.trueOriginal();
    if (orig) res = get_paths(orig, res, false);
  }
  if (root) {
    const orig = clone?.trueOriginal();
    if (clone && orig) {
      res = get_paths(orig, res, false);
      res = PV.transformed(res, orig.transform.inverse().multiply(clone.get_root_transform()));
      bbox = PV.boundsFast(res);
    }
    if (bbox) res = PV.transformed(res, Translate(bbox.midpoint()).inverse());
  }
  return res;
}

/**
 * Method to handle the distribution of the items
 * @returns radius and angle of the position of the sprayed object; a: mean, s: standard deviation
 */
export function random_position(a: number, s: number): { radius: number; angle: number } {
  // angle is taken from an uniform distribution
  const angle = random_range(0, Math.PI * 2.0);

  // radius is taken from a Normal Distribution
  let radius_temp = -1;
  while (!(radius_temp >= 0 && radius_temp <= 1)) radius_temp = NormalDistribution(a, s);
  // Because we are in polar coordinates, a special treatment has to be done to the radius.
  // Otherwise, positions taken from an uniform repartition on radius and angle will not seam to
  // be uniformily distributed on the disk (more at the center and less at the boundary).
  // We counter this effect with a 0.5 exponent. This is empiric.
  return { radius: radius_temp ** 0.5, angle };
}

function sp_spray_transform_path(item: SPItem, path: Path, affine: Affine, center: Point): Path {
  const parent = item.parent instanceof SPItem ? item.parent : null;
  const i2anc = parent ? parent.i2docAffine() : null;
  if (i2anc) path = path.transformed(i2anc.inverse());
  path = path.transformed(item.transform.inverse());
  const dt2p = parent ? parent.i2dtAffine().inverse() : item.document.dt2doc();
  const i2dt = item
    .i2dtAffine()
    .multiply(Translate(center).inverse())
    .multiply(affine)
    .multiply(Translate(center));
  path = path.transformed(i2dt.multiply(dt2p));
  if (i2anc) path = path.transformed(i2anc);
  return path;
}

/** The spray origin of item: its inkscape:spray-origin, else "#id". */
function spray_origin_of(item: SPItem): string {
  return item.getAttribute('inkscape:spray-origin') ?? `#${item.getId()}`;
}

/** The parameters of a spray step (upstream: the arguments of sp_spray_recursive). */
interface SprayParams {
  mode: SprayMode;
  radius: number;
  population: number;
  scale: number;
  scale_variation: number;
  mean: number;
  standard_deviation: number;
  ratio: number;
  tilt: number;
  rotation_variation: number;
  no_overlap: boolean;
  offset: number;
  usepressurescale: boolean;
  pressure: number;
  single_click: boolean;
  single_angle: number;
  single_scale: number;
}

/**
 * Whether the copy of item, moved by move and transformed around center, may be
 * placed (upstream fit_item): with no_overlap not over another copy of the
 * same original; in eraser mode it deletes the copies there and returns false.
 * TODO: the color picker (picker, pick_*, over_transparent, over_no_transparent):
 * it needs the colors of the rendered drawing.
 */
function fit_item(
  desktop: SPDesktop,
  set: ObjectSet,
  item: SPItem,
  bbox: Rect,
  move: Point,
  center: Point,
  angle: number,
  _scale: number,
  p: SprayParams,
): boolean {
  if (set.isEmpty()) return false;
  const width = bbox.width();
  const height = bbox.height();
  let offset_width = Math.max((p.offset * width) / 100.0 - width, 0);
  let offset_height = Math.max((p.offset * height) / 100.0 - height, 0);
  let path = Path.fromRect(
    new Rect(
      bbox.left() - offset_width,
      bbox.top() - offset_height,
      bbox.right() + offset_width,
      bbox.bottom() + offset_height,
    ),
  );
  path = sp_spray_transform_path(item, path, Scale(_scale), center);
  path = sp_spray_transform_path(item, path, Scale(p.scale), center);
  path = sp_spray_transform_path(item, path, Rotate(angle), center);
  path = path.transformed(Translate(move)).transformed(desktop.doc2dt());
  const bbox_procesed = path.boundsFast();
  if (!bbox_procesed) return false;
  const bbox_left_main = bbox_procesed.left();
  const bbox_top_main = bbox_procesed.top();
  const width_transformed = bbox_procesed.width();
  const height_transformed = bbox_procesed.height();
  if (p.offset < 100) {
    offset_width = ((99.0 - p.offset) * width_transformed) / 100.0 - width_transformed;
    offset_height = ((99.0 - p.offset) * height_transformed) / 100.0 - height_transformed;
  } else {
    offset_width = 0;
    offset_height = 0;
  }
  const items_down = desktop.getDocument().getItemsPartiallyInBox(desktop.dkey, bbox_procesed);
  for (const item_down of items_down) {
    const bbox_down = item_down.documentVisualBounds();
    if (!bbox_down) continue;
    const item_down_sharp = `#${item_down.getId()}`;
    for (const item_selected of set.items()) {
      const spray_origin = spray_origin_of(item_selected);
      if (
        item_down_sharp === spray_origin ||
        item_down.getAttribute('inkscape:spray-origin') === spray_origin
      ) {
        if (p.mode === SprayMode.SPRAY_MODE_ERASER) {
          if (item_down_sharp !== spray_origin && !set.includes(item_down)) {
            item_down.deleteObject();
            break;
          }
        } else if (p.no_overlap) {
          if (
            !(
              offset_width < 0 &&
              offset_height < 0 &&
              Math.abs(bbox_down.left() - bbox_left_main) > Math.abs(offset_width) &&
              Math.abs(bbox_down.top() - bbox_top_main) > Math.abs(offset_height)
            )
          ) {
            return false;
          }
        }
      }
    }
  }
  return p.mode !== SprayMode.SPRAY_MODE_ERASER;
}

/**
 * The spray tool (upstream SprayTool): drag or click to spray copies or clones
 * of the selected objects around the pointer, or to union them into a single
 * path; the eraser mode deletes sprayed copies. Width, amount (population),
 * rotation and scale variation, scatter (standard deviation) and focus (mean)
 * shape the spray; pressure can change width, amount and scale. A click sprays
 * one item, shown under the pointer before; the right button picks another.
 * Shift+J/K/L switch the mode.
 * TODO: the color picker options (need the rendered colors), the clone tiler
 * trace options, 3D boxes, LPE items, status bar messages and cursor.
 */
export class SprayTool extends ToolBase {
  /* extended input data */
  pressure = TC_DEFAULT_PRESSURE;

  /* attributes */
  usepressurewidth = false;
  usepressurepopulation = false;
  usepressurescale = false;

  width = 0.2;
  ratio = 0.0;
  tilt = 0.0;
  rotation_variation = 0.0;
  population = 0.0;
  scale_variation = 1.0;
  scale = 1.0;
  mean = 0.2;
  standard_deviation = 0.2;

  mode = SprayMode.SPRAY_MODE_COPY;

  is_drawing = false;
  is_dilating = false;
  has_dilated = false;
  last_push = new Point(0, 0);
  dilate_area: CanvasItemBpath;
  shapes_area: CanvasItemBpath;
  items: SPItem[] = [];
  no_overlap = false;
  offset = 0.0;
  single_click = false;
  single_scale = 0;
  single_angle = 0;
  last_pressure = 0;
  shapes: PathVector = [];
  single_path_output: SPItem | null = null;

  /** The objects to spray: the selection when the tool was activated. */
  readonly object_set: ObjectSet;

  constructor(desktop: SPDesktop) {
    super(desktop, '/tools/spray');
    this.dilate_area = new CanvasItemBpath(desktop.getCanvasControls());
    this.dilate_area.set_stroke(0xff9900ff);
    this.dilate_area.set_fill(0x0);
    this.dilate_area.set_visible(false);

    this.shapes_area = new CanvasItemBpath(desktop.getCanvasControls());
    this.shapes_area.set_stroke(0x333333ff);
    this.shapes_area.set_fill(0x0);
    this.shapes_area.set_visible(false);

    const prefs = Preferences.get();
    prefs.setBool('/dialogs/clonetiler/dotrace', false);
    if (prefs.getBool('/tools/spray/selcue')) this.enableSelectionCue();
    for (const name of [
      'width',
      'ratio',
      'tilt',
      'rotation_variation',
      'scale_variation',
      'mode',
      'population',
      'mean',
      'standard_deviation',
      'usepressurewidth',
      'usepressurepopulation',
      'usepressurescale',
      'offset',
      'no_overlap',
    ]) {
      this.sp_event_context_read(name);
    }

    // Construct the object_set we'll be using for this spray operation
    this.object_set = new ObjectSet(desktop);
    this.object_set.addList(desktop.getSelection().objects());
    this._element.addEventListener('pointerleave', this.#onLeave);
    this._element.addEventListener('contextmenu', this.#onContextMenu);
  }

  override destroy(): void {
    this._element.removeEventListener('pointerleave', this.#onLeave);
    this._element.removeEventListener('contextmenu', this.#onContextMenu);
    this.dilate_area.unlink();
    this.shapes_area.unlink();
    super.destroy();
  }

  readonly #onLeave = (): void => {
    this.dilate_area.set_visible(false);
    this.shapes_area.set_visible(false);
  };

  /** The right button picks another item to spray with a click; no context menu. */
  readonly #onContextMenu = (event: Event): void => {
    if (this._desktop.getTool() === this) event.preventDefault();
  };

  override set(name: string): void {
    const prefs = Preferences.get();
    const path = `/tools/spray/${name}`;
    if (name === 'mode') {
      this.mode = prefs.getInt(path);
    } else if (name === 'width') {
      this.width = 0.01 * clamp(prefs.getInt(path, 10), 1, 100);
    } else if (name === 'usepressurewidth') {
      this.usepressurewidth = prefs.getBool(path);
    } else if (name === 'usepressurepopulation') {
      this.usepressurepopulation = prefs.getBool(path);
    } else if (name === 'usepressurescale') {
      this.usepressurescale = prefs.getBool(path);
    } else if (name === 'population') {
      this.population = 0.01 * clamp(prefs.getInt(path, 10), 1, 100);
    } else if (name === 'rotation_variation') {
      this.rotation_variation = clamp(prefs.getDouble(path, 0.0), 0, 100.0);
    } else if (name === 'scale_variation') {
      this.scale_variation = clamp(prefs.getDouble(path, 1.0), 0, 100.0);
    } else if (name === 'standard_deviation') {
      this.standard_deviation = 0.01 * clamp(prefs.getInt(path, 10), 1, 100);
    } else if (name === 'mean') {
      this.mean = 0.01 * clamp(prefs.getInt(path, 10), 1, 100);
    } else if (name === 'tilt') {
      // Not implemented in the toolbar and preferences yet
      this.tilt = clamp(prefs.getDouble(path, 0.1), 0, 1000.0);
    } else if (name === 'ratio') {
      this.ratio = clamp(prefs.getDouble(path), 0.0, 0.9);
    } else if (name === 'offset') {
      this.offset = clamp(prefs.getDouble(path, 100.0), 0, 1000.0);
    } else if (name === 'no_overlap') {
      this.no_overlap = prefs.getBool(path, false);
    }
  }

  extinput(ext: ExtendedInput): void {
    this.pressure =
      ext.pressure !== undefined
        ? clamp(ext.pressure, TC_MIN_PRESSURE, TC_MAX_PRESSURE)
        : TC_DEFAULT_PRESSURE;
  }

  get_width(): number {
    const pressure = this.usepressurewidth ? this.pressure / TC_DEFAULT_PRESSURE : 1;
    return pressure * this.width;
  }

  get_dilate_radius(): number {
    return (250 * this.get_width()) / this._desktop.current_zoom();
  }

  get_population(): number {
    const pressure = this.usepressurepopulation ? this.pressure / TC_DEFAULT_PRESSURE : 1;
    return pressure * this.population;
  }

  get_pressure(): number {
    return this.pressure / TC_DEFAULT_PRESSURE;
  }

  /** Spray around p (document coordinates); force sprays even with population 0 (upstream sp_spray_dilate). */
  dilate(p: Point, force = false): boolean {
    const set = this.object_set;
    if (set.isEmpty()) return false;

    let did = false;
    const radius = this.get_dilate_radius();
    const population = this.get_population();
    if (radius === 0 || (population === 0 && !force)) return false;
    if (this.mean === 0 || this.standard_deviation === 0) return false;

    const params: SprayParams = {
      mode: this.mode,
      radius,
      population,
      scale: this.scale,
      scale_variation: this.scale_variation,
      mean: this.mean,
      standard_deviation: this.standard_deviation,
      ratio: this.ratio,
      tilt: this.tilt,
      rotation_variation: this.rotation_variation,
      no_overlap: this.no_overlap,
      offset: this.offset,
      usepressurescale: this.usepressurescale,
      pressure: this.get_pressure(),
      single_click: this.single_click,
      single_angle: this.single_angle,
      single_scale: this.single_scale,
    };
    for (const item of [...this.items]) {
      if (this.#sprayRecursive(set, item, p, params)) did = true;
    }
    return did;
  }

  /** Spray one copy of item (upstream sp_spray_recursive). */
  #sprayRecursive(set: ObjectSet, item: SPItem, p: Point, s: SprayParams): boolean {
    const desktop = this._desktop;
    // TODO: convert 3D boxes to ordinary groups before spraying their shapes

    const _fid = s.single_click ? 0 : random_range(0, 1);
    const angle = s.single_click
      ? s.single_angle
      : random_range((-s.rotation_variation / 100.0) * Math.PI, (s.rotation_variation / 100.0) * Math.PI);
    let _scale = s.single_click
      ? s.single_scale
      : random_range(1.0 - s.scale_variation / 100.0, 1.0 + s.scale_variation / 100.0);
    if (!s.single_click && s.usepressurescale) _scale = s.pressure;
    const pos = random_position(s.mean, s.standard_deviation);
    const dr = pos.radius * s.radius;
    const dp = pos.angle;
    const { tilt, ratio } = s;
    const scatter = new Point(
      (Math.cos(tilt) * Math.cos(dp) * dr) / (1 - ratio) + (Math.sin(tilt) * Math.sin(dp) * dr) / (1 + ratio),
      (-Math.sin(tilt) * Math.cos(dp) * dr) / (1 - ratio) +
        (Math.cos(tilt) * Math.sin(dp) * dr) / (1 + ratio),
    );
    const doc2dt = desktop.doc2dt().withoutTranslation();

    const bbox = item.documentVisualBounds();
    if (!bbox) return false;
    const doc = item.document;
    const old_repr = item.getRepr();
    const parent = old_repr.parent();
    if (!parent) return false;

    if (s.mode !== SprayMode.SPRAY_MODE_SINGLE_PATH) {
      if (!(_fid <= s.population || s.no_overlap)) return false;
      const spray_origin = spray_origin_of(item);
      let center = item.getCenter(false);
      let move = scatter.add(p.sub(bbox.midpoint()));
      if (s.single_click) move = p.sub(bbox.midpoint());

      if (s.mode === SprayMode.SPRAY_MODE_ERASER || s.no_overlap) {
        let stop = false;
        for (const i of [0, 1]) {
          if (!fit_item(desktop, set, item, bbox, move, center, angle, _scale, s)) {
            if (s.no_overlap && i === 0) {
              move = p.sub(bbox.midpoint().transformed(doc2dt));
              continue;
            }
            stop = true;
            break;
          }
        }
        if (stop) return false;
      }

      let item_copied: SPItem | null;
      // Duplicate
      if (s.mode === SprayMode.SPRAY_MODE_CLONE) {
        // Creation of the clone
        const clone = doc.getReprDoc().createElement('svg:use');
        // Ad the clone to the list of the parent's children
        parent.appendChild(clone);
        // Generates the link between parent and child attributes
        if (!clone.attribute('inkscape:spray-origin'))
          clone.setAttribute('inkscape:spray-origin', spray_origin);
        clone.setAttribute('xlink:href', `#${old_repr.attribute('id')}`);
        const clone_object = doc.getObjectByRepr(clone);
        item_copied = clone_object instanceof SPItem ? clone_object : null;
      } else {
        const copy = old_repr.duplicate(doc.getReprDoc());
        if (!copy.attribute('inkscape:spray-origin'))
          copy.setAttribute('inkscape:spray-origin', spray_origin);
        parent.appendChild(copy);
        const new_obj = doc.getObjectByRepr(copy);
        item_copied = new_obj instanceof SPItem ? new_obj : null; // Conversion object->item
      }
      if (!item_copied) return false;

      if (s.single_click && item.isCenterSet()) {
        item_copied.unsetCenter();
        item_copied.updateRepr();
        center = bbox.midpoint();
      }

      const translate = Translate(move.transformed(doc2dt));
      const affine = transform_around_point(center, Scale(_scale * s.scale).multiply(Rotate(angle)));
      transform_keep_center(
        item_copied,
        affine.multiply(translate),
        s.single_click ? center.transformed(translate) : center,
      );
      return true;
    }

    // SPRAY_MODE_SINGLE_PATH
    if (!(_fid <= s.population)) return false; // Rules the population of objects sprayed
    // Duplicates the parent item
    const copy = old_repr.duplicate(doc.getReprDoc());
    const spray_origin = copy.attribute('inkscape:spray-origin') ?? `#${old_repr.attribute('id')}`;
    parent.appendChild(copy);
    const item_copied = doc.getObjectByRepr(copy);
    if (!(item_copied instanceof SPItem)) return false;

    // Move around the cursor
    const move = scatter.add(p.sub(bbox.midpoint()));

    const center = item.getCenter(false);
    const translate = Translate(move.transformed(doc2dt));
    const affine = transform_around_point(center, Scale(_scale * s.scale).multiply(Rotate(angle)));
    transform_keep_center(item_copied, affine.multiply(translate), center);

    // Union
    // only works if no groups in selection
    const object_set_tmp = new ObjectSet(desktop);
    object_set_tmp.add(item_copied);
    // TODO: object_set_tmp.removeLPESRecursive(true);
    if (object_set_tmp.objects()[0] instanceof SPUse) object_set_tmp.unlinkRecursive(true);
    if (this.single_path_output?.parent) {
      // Previous result
      object_set_tmp.add(this.single_path_output);
    }
    pathUnion(object_set_tmp, true);
    this.single_path_output = object_set_tmp.items()[0] ?? null;
    for (const i of object_set_tmp.items()) i.getRepr().setAttribute('inkscape:spray-origin', spray_origin);
    return true;
  }

  /** Draw the spray area at p (desktop) and the outline of the item of a click. */
  #updateArea(p: Point): void {
    const radius = this.get_dilate_radius();
    const sm = Scale(radius / (1 - this.ratio), radius / (1 + this.ratio))
      .multiply(Rotate(this.tilt))
      .multiply(Translate(p));
    this.dilate_area.set_bpath([Path.fromCircle(new Point(0, 0), 1).transformed(sm)]);
    this.dilate_area.set_visible(true);
    if (
      !this.has_dilated &&
      this.items.length === 1 &&
      this.mode !== SprayMode.SPRAY_MODE_SINGLE_PATH &&
      this.mode !== SprayMode.SPRAY_MODE_ERASER
    ) {
      this.shapes_area.set_bpath(PV.transformed(this.shapes, Translate(p)));
      this.shapes_area.set_visible(true);
    } else {
      this.shapes_area.set_visible(false);
    }
  }

  /** Pick a random item of the selection to spray with a click and its outline (upstream: in the motion handler). */
  #pickSingleItem(): void {
    if (this.object_set.isEmpty()) return;
    // select a random item from the ones selected to spay to preview and apply on single click
    const all = this.object_set.items();
    const randitem = all[Math.floor(random_range(0, all.length))];
    if (!randitem) return;
    this.items = [randitem];
    this.single_angle = random_range(
      (-this.rotation_variation / 100.0) * Math.PI,
      (this.rotation_variation / 100.0) * Math.PI,
    );
    this.single_scale = random_range(1.0 - this.scale_variation / 100.0, 1.0 + this.scale_variation / 100.0);
    if (this.usepressurescale && this.last_pressure) this.single_scale = this.last_pressure;
    let shapes = get_paths(randitem, []);
    const a: OptRect = PV.boundsFast(shapes);
    if (a) {
      const s = Translate(a.midpoint());
      shapes = PV.transformed(shapes, s.inverse().multiply(Scale(this.single_scale)).multiply(s));
      shapes = PV.transformed(shapes, s.inverse().multiply(Scale(this.scale)).multiply(s));
      shapes = PV.transformed(shapes, s.inverse().multiply(Rotate(this.single_angle)).multiply(s));
    }
    this.shapes = shapes;
  }

  /** Set the mode (upstream sp_spray_switch_mode: through the toolbar, which writes the preference). */
  switch_mode(mode: SprayMode): void {
    Preferences.get().setInt('/tools/spray/mode', mode);
    // Need to set explicitly, because the prefs may not have changed by the previous
    this.mode = mode;
  }

  #done(): void {
    const doc = this._desktop.getDocument();
    switch (this.mode) {
      case SprayMode.SPRAY_MODE_COPY:
        DocumentUndo.done(doc, C_('Undo', 'Spray with copies'), 'tool-spray');
        break;
      case SprayMode.SPRAY_MODE_CLONE:
        DocumentUndo.done(doc, C_('Undo', 'Spray with clones'), 'tool-spray');
        break;
      case SprayMode.SPRAY_MODE_SINGLE_PATH:
        DocumentUndo.done(doc, C_('Undo', 'Spray in single path'), 'tool-spray');
        break;
      default:
        // As upstream, the eraser mode adds no undo step of its own.
        break;
    }
  }

  override root_handler(event: Event): boolean {
    let ret = false;
    this.tolerance = clamp(Preferences.get().getInt('/options/dragtolerance/value', 0), 0, 100);
    switch (event.type) {
      case 'pointerdown': {
        const e = event as PointerEvent;
        if (e.button === 0 && have_viable_layer(this._desktop)) {
          const w = this._windowPoint(e);
          this.saveDragOrigin(w);
          const motion_dt = this._desktopPoint(w);
          this.last_push = motion_dt.transformed(this._desktop.dt2doc());

          this.extinput(extinput_from_event(e));

          this.is_dilating = true;
          this.has_dilated = false;
          this.is_drawing = false;
          if (this.mode === SprayMode.SPRAY_MODE_SINGLE_PATH) this.single_path_output = null;
          this.grabCanvasEvents(e);

          ret = true;
          this.within_tolerance = true;
          this.single_click = true;
        }
        if (e.button === 2) {
          //reset preview on right click
          this.items = [];
          ret = true;
        }
        break;
      }
      case 'pointermove': {
        const e = event as PointerEvent;
        const w = this._windowPoint(e);
        const motion_dt = this._desktopPoint(w);
        const motion_doc = motion_dt.transformed(this._desktop.dt2doc());
        if (!this.has_dilated && this.items.length === 0 && this.mode !== SprayMode.SPRAY_MODE_SINGLE_PATH) {
          this.#pickSingleItem();
        }
        // To fix https://bugs.launchpad.net/inkscape/+bug/1458200
        // we increase the tolerance because no sensible data for panning
        if (
          this.within_tolerance &&
          this.xyp &&
          Math.max(Math.abs(Math.floor(w.x) - this.xyp.x), Math.abs(Math.floor(w.y) - this.xyp.y)) <
            this.tolerance * 3
        ) {
          // do not drag if we're within tolerance from origin
          break;
        }
        if (!this.is_drawing && this.is_dilating) this.items = this.object_set.items();

        // Once the user has moved farther than tolerance from
        // the original location (indicating they intend to move
        // the object, not click), then always process the motion
        // notify coordinates as given (no snapping back to origin)
        this.within_tolerance = false;
        this.single_click = false;
        this.extinput(extinput_from_event(e));

        // Draw the dilating cursor
        this.#updateArea(motion_dt);

        // TODO: flash "<b>Nothing selected!</b> Select objects to spray." if there are no items.

        // Dilating:
        if (this.is_dilating && e.buttons & 1) {
          this.dilate(motion_doc);
          //this->last_push = motion_doc;
          this.is_drawing = true;
          this.has_dilated = true;
          ret = true;
        }
        break;
      }
      case 'wheel': {
        const e = event as WheelEvent;
        if (e.buttons === 1) {
          /* Spray with the scroll */
          e.preventDefault();
          const temp = this.population;
          this.population = 1.0;
          const scroll_dt = this._desktop.point();
          if (e.deltaY !== 0 && have_viable_layer(this._desktop)) {
            this.last_push = scroll_dt.transformed(this._desktop.dt2doc());
            if (this.is_dilating) this.dilate(scroll_dt.transformed(this._desktop.dt2doc()));
            ret = true;
          }
          this.population = temp;
          return true;
        }
        break;
      }
      case 'pointerup': {
        const e = event as PointerEvent;
        const motion_dt = this._desktopPoint(this._windowPoint(e));
        const motion_doc = motion_dt.transformed(this._desktop.dt2doc());
        this.is_drawing = false;
        this.ungrabCanvasEvents(e);

        if ((this.single_click || this.is_dilating) && e.button === 0) {
          if (this.single_click) {
            this.dilate(motion_doc, true);
          } else if (!this.has_dilated) {
            // If we did not rub, do a light tap
            this.pressure = 0.03;
            this.dilate(motion_doc);
          }
          this.last_pressure = this.pressure;
          this.items = [];
          this.is_dilating = false;
          this.is_drawing = false;
          this.has_dilated = false;
          this.single_click = false;
          this.#done();
          ret = true;
        }
        break;
      }
      case 'keydown':
        ret = this.#onKeyPress(event as KeyboardEvent);
        if (ret) event.preventDefault();
        break;
    }
    return ret || super.root_handler(event);
  }

  #onKeyPress(event: KeyboardEvent): boolean {
    const prefs = Preferences.get();
    switch (event.key) {
      case 'j':
      case 'J':
        if (mod_shift_only(event)) {
          this.switch_mode(SprayMode.SPRAY_MODE_COPY);
          return true;
        }
        break;
      case 'k':
      case 'K':
        if (mod_shift_only(event)) {
          this.switch_mode(SprayMode.SPRAY_MODE_CLONE);
          return true;
        }
        break;
      case 'l':
      case 'L':
        if (mod_shift_only(event)) {
          this.switch_mode(SprayMode.SPRAY_MODE_SINGLE_PATH);
          return true;
        }
        break;
      case 'ArrowUp':
        if (!mod_ctrl_only(event)) {
          this.population = Math.min(this.population + 0.01, 1.0);
          prefs.setDouble('/tools/spray/population', this.population * 100);
          return true;
        }
        break;
      case 'ArrowDown':
        if (!mod_ctrl_only(event)) {
          this.population = Math.max(this.population - 0.01, 0.0);
          prefs.setDouble('/tools/spray/population', this.population * 100);
          return true;
        }
        break;
      case 'ArrowRight':
        if (!mod_ctrl_only(event)) {
          this.width = Math.min(this.width + 0.01, 1.0);
          // The same spinbutton is for alt+x
          prefs.setDouble('/tools/spray/width', this.width * 100);
          this.#updateArea(this._desktop.point());
          return true;
        }
        break;
      case 'ArrowLeft':
        if (!mod_ctrl_only(event)) {
          this.width = Math.max(this.width - 0.01, 0.01);
          prefs.setDouble('/tools/spray/width', this.width * 100);
          this.#updateArea(this._desktop.point());
          return true;
        }
        break;
      case 'Home':
        this.width = 0.01;
        prefs.setDouble('/tools/spray/width', this.width * 100);
        this.#updateArea(this._desktop.point());
        return true;
      case 'End':
        this.width = 1.0;
        prefs.setDouble('/tools/spray/width', this.width * 100);
        this.#updateArea(this._desktop.point());
        return true;
      case 'Delete':
      case 'Backspace':
        return this.deleteSelectedDrag(mod_ctrl_only(event));
    }
    return false;
  }
}
