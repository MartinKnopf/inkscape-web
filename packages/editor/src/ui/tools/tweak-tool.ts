// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tools/tweak-tool.cpp, src/ui/tools/tweak-tool.h
/*
 * tweaking paths without node editing
 *
 * Authors:
 *   bulia byak
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *
 * Copyright (C) 2007 authors
 */
import {
  C_,
  Colors,
  DocumentUndo,
  FillRule,
  getGradient,
  modify_filter_gaussian_blur_from_item,
  PaintTarget,
  Preferences,
  pathBoolopBackend,
  remove_filter,
  type Selection,
  SPFlowtext,
  SPGaussianBlur,
  type SPGradient,
  SPGradientSpread,
  SPGroup,
  type SPIScale24,
  SPItem,
  SPLinearGradient,
  SPPath,
  SPRadialGradient,
  SPShape,
  SPStop,
  SPText,
  sp_gradient_get_forked_vector_if_necessary,
  sp_item_list_to_curves,
  sp_selected_item_to_curved_repr,
  spCssAttrUnsetUris,
  spReprCssAttr,
  spReprCssProperty,
  spReprCssWriteString,
  spStyleSetPropertyUrl,
  type Node as XmlNode,
} from '@inkscape-web/core';
import { L2, Path, Point, Rect, Rotate, Scale, Translate, write_svg_path } from '@inkscape-web/geom';
import { have_viable_layer } from '../../context-fns.ts';
import type { SPDesktop } from '../../desktop.ts';
import { sp_desktop_get_color_tool, sp_desktop_get_master_opacity_tool } from '../../desktop-style.ts';
import { CanvasItemBpath } from '../../display/control/canvas-item-bpath.ts';
import { type ExtendedInput, extinput_from_event } from './dynamic-base.ts';
import { type ModifierState, mod_ctrl_only, mod_shift, mod_shift_only, ToolBase } from './tool-base.ts';

const TC_MIN_PRESSURE = 0.0;
const TC_MAX_PRESSURE = 1.0;
const TC_DEFAULT_PRESSURE = 0.35;

export enum TweakMode {
  TWEAK_MODE_MOVE,
  TWEAK_MODE_MOVE_IN_OUT,
  TWEAK_MODE_MOVE_JITTER,
  TWEAK_MODE_SCALE,
  TWEAK_MODE_ROTATE,
  TWEAK_MODE_MORELESS,
  TWEAK_MODE_PUSH,
  TWEAK_MODE_SHRINK_GROW,
  TWEAK_MODE_ATTRACT_REPEL,
  TWEAK_MODE_ROUGHEN,
  TWEAK_MODE_COLORPAINT,
  TWEAK_MODE_COLORJITTER,
  TWEAK_MODE_BLUR,
}

/** Upstream: src/livarot/Shape.h tweak modes (the values of Geom.tweakPath of @inkscape-web/wasm). */
enum LivarotTweakMode {
  tweak_mode_grow = 0,
  tweak_mode_push = 1,
  tweak_mode_repel = 2,
  tweak_mode_roughen = 3,
}

// Modifiers (upstream Modifiers::Modifier).
/** tweak-invert: Shift */
const mod_tweak_invert = (s: ModifierState): boolean => mod_shift(s);

const clamp = (v: number, min: number, max: number): number => Math.min(Math.max(v, min), max);

/** A random number in [min, max) (upstream g_random_double_range). */
const random_range = (min: number, max: number): number => min + Math.random() * (max - min);

function is_transform_mode(mode: TweakMode): boolean {
  return (
    mode === TweakMode.TWEAK_MODE_MOVE ||
    mode === TweakMode.TWEAK_MODE_MOVE_IN_OUT ||
    mode === TweakMode.TWEAK_MODE_MOVE_JITTER ||
    mode === TweakMode.TWEAK_MODE_SCALE ||
    mode === TweakMode.TWEAK_MODE_ROTATE ||
    mode === TweakMode.TWEAK_MODE_MORELESS
  );
}

function is_color_mode(mode: TweakMode): boolean {
  return (
    mode === TweakMode.TWEAK_MODE_COLORPAINT ||
    mode === TweakMode.TWEAK_MODE_COLORJITTER ||
    mode === TweakMode.TWEAK_MODE_BLUR
  );
}

/** The undo descriptions of the modes. */
const DESCRIPTIONS: Record<TweakMode, string> = {
  [TweakMode.TWEAK_MODE_MOVE]: 'Move tweak',
  [TweakMode.TWEAK_MODE_MOVE_IN_OUT]: 'Move in/out tweak',
  [TweakMode.TWEAK_MODE_MOVE_JITTER]: 'Move jitter tweak',
  [TweakMode.TWEAK_MODE_SCALE]: 'Scale tweak',
  [TweakMode.TWEAK_MODE_ROTATE]: 'Rotate tweak',
  [TweakMode.TWEAK_MODE_MORELESS]: 'Duplicate/delete tweak',
  [TweakMode.TWEAK_MODE_PUSH]: 'Push path tweak',
  [TweakMode.TWEAK_MODE_SHRINK_GROW]: 'Shrink/grow path tweak',
  [TweakMode.TWEAK_MODE_ATTRACT_REPEL]: 'Attract/repel path tweak',
  [TweakMode.TWEAK_MODE_ROUGHEN]: 'Roughen path tweak',
  [TweakMode.TWEAK_MODE_COLORPAINT]: 'Color paint tweak',
  [TweakMode.TWEAK_MODE_COLORJITTER]: 'Color jitter tweak',
  [TweakMode.TWEAK_MODE_BLUR]: 'Blur tweak',
};

/** The mode keys (with Shift): the letter and the digit of each mode. */
const MODE_KEYS: readonly [keys: string, mode: TweakMode][] = [
  ['mM0', TweakMode.TWEAK_MODE_MOVE],
  ['iI1', TweakMode.TWEAK_MODE_MOVE_IN_OUT],
  ['zZ2', TweakMode.TWEAK_MODE_MOVE_JITTER],
  ['<,>.3', TweakMode.TWEAK_MODE_SCALE],
  ['[]4', TweakMode.TWEAK_MODE_ROTATE],
  ['dD5', TweakMode.TWEAK_MODE_MORELESS],
  ['pP6', TweakMode.TWEAK_MODE_PUSH],
  ['sS7', TweakMode.TWEAK_MODE_SHRINK_GROW],
  ['aA8', TweakMode.TWEAK_MODE_ATTRACT_REPEL],
  ['rR9', TweakMode.TWEAK_MODE_ROUGHEN],
  ['cC', TweakMode.TWEAK_MODE_COLORPAINT],
  ['jJ', TweakMode.TWEAK_MODE_COLORJITTER],
  ['bB', TweakMode.TWEAK_MODE_BLUR],
];

/**
 * The key of a keyboard event as the unshifted keyboard layout gives it
 * (upstream get_latin_keyval): Shift+1 gives "!" in event.key, so the digit is
 * taken from event.code.
 */
function latin_key(event: KeyboardEvent): string {
  const digit = /^Digit(\d)$/.exec(event.code);
  return digit ? (digit[1] as string) : event.key;
}

/** The weight of the brush at dist from its center (upstream tweak_profile). */
export function tweak_profile(dist: number, radius: number): number {
  if (radius === 0) return 0;
  const x = dist / radius;
  const alpha = 1;
  if (x >= 1) return 0;
  if (x <= 0) return 1;
  return 0.5 * Math.cos(Math.PI * x ** alpha) + 0.5;
}

/**
 * The color moved towards goal (paint) or randomized (jitter) in HSL, by
 * force; channels whose flag is off do not change (upstream tweak_color).
 */
export function tweak_color(
  mode: TweakMode,
  color: Colors.Color,
  goal: Colors.Color,
  force: number,
  do_h: boolean,
  do_s: boolean,
  do_l: boolean,
): Colors.Color {
  // Tweak colors are entirely based on HSL values;
  const hsl = color.converted(Colors.SpaceType.HSL);
  if (!hsl) return color; // Bad conversion
  // Always pin alpha, this tool works on item opacity instead
  const pin = (do_h ? 0 : 1) + (do_s ? 0 : 2) + (do_l ? 0 : 4) + 8;
  if (mode === TweakMode.TWEAK_MODE_COLORPAINT) hsl.average(goal, force, pin);
  else if (mode === TweakMode.TWEAK_MODE_COLORJITTER) hsl.jitter(force, pin);
  return hsl;
}

function tweak_stop_color(
  mode: TweakMode,
  stop: SPStop,
  goal: Colors.Color,
  force: number,
  do_h: boolean,
  do_s: boolean,
  do_l: boolean,
): void {
  stop.setColor(tweak_color(mode, stop.getColor(), goal, force, do_h, do_s, do_l));
}

function tweak_opacity(
  mode: TweakMode,
  style_opacity: SPIScale24,
  opacity_goal: number,
  force: number,
): void {
  let opacity = style_opacity.as_double();
  if (mode === TweakMode.TWEAK_MODE_COLORPAINT) {
    const d = opacity_goal - opacity;
    opacity += d * force;
  } else if (mode === TweakMode.TWEAK_MODE_COLORJITTER) {
    opacity += random_range(-opacity, 1 - opacity) * force;
  }
  style_opacity.set_double(opacity);
}

function tweak_colors_in_gradient(
  item: SPItem,
  fill_or_stroke: PaintTarget,
  goal: Colors.Color,
  p_w: Point,
  radius: number,
  force: number,
  mode: TweakMode,
  do_h: boolean,
  do_s: boolean,
  do_l: boolean,
): void {
  const gradient = getGradient(item, fill_or_stroke);
  if (!gradient) return;

  const i2d = item.i2docAffine();
  // now p is in gradient's original coordinates
  const p = p_w.transformed(i2d.inverse()).transformed(gradient.gradientTransform.inverse());

  if (!(gradient instanceof SPLinearGradient || gradient instanceof SPRadialGradient)) {
    // TODO: mesh gradients.
    return;
  }
  let pos = 0;
  let r = 0;
  if (gradient instanceof SPLinearGradient) {
    const p1 = new Point(gradient.x1.computed, gradient.y1.computed);
    const p2 = new Point(gradient.x2.computed, gradient.y2.computed);
    const pdiff = p2.sub(p1);
    const vl = L2(pdiff);

    // This is the matrix which moves and rotates the gradient line
    // so it's oriented along the X axis:
    const norm = Translate(p1.neg()).multiply(Rotate(-Math.atan2(pdiff.y, pdiff.x)));

    // Transform the mouse point by it to find out its projection onto the gradient line:
    const pnorm = p.transformed(norm);

    // Scale its X coordinate to match the length of the gradient line:
    pos = pnorm.x / vl;
    // Calculate radius in length-of-gradient-line units
    r = radius / vl;
  } else {
    const c = new Point(gradient.cx.computed, gradient.cy.computed);
    pos = L2(p.sub(c)) / gradient.r.computed;
    r = radius / gradient.r.computed;
  }

  // Normalize pos to 0..1, taking into account gradient spread:
  let pos_e = pos;
  const spread = gradient.getSpread();
  if (spread === SPGradientSpread.SP_GRADIENT_SPREAD_PAD) {
    if (pos > 1) pos_e = 1;
    if (pos < 0) pos_e = 0;
  } else if (spread === SPGradientSpread.SP_GRADIENT_SPREAD_REPEAT) {
    if (pos > 1 || pos < 0) pos_e = pos - Math.floor(pos);
  } else if (spread === SPGradientSpread.SP_GRADIENT_SPREAD_REFLECT) {
    if (pos > 1 || pos < 0) {
      const odd = Math.floor(pos) % 2 === 1;
      pos_e = pos - Math.floor(pos);
      if (odd) pos_e = 1 - pos_e;
    }
  }

  const vector: SPGradient = sp_gradient_get_forked_vector_if_necessary(gradient, false);

  let offset_l = 0;
  let offset_h = 0;
  let child_prev: SPStop | null = null;
  for (const child of vector.children) {
    if (!(child instanceof SPStop)) continue;
    const stop = child;
    offset_h = stop.offset;

    if (child_prev) {
      const prevStop = child_prev;
      if (offset_h - offset_l > r && pos_e >= offset_l && pos_e <= offset_h) {
        // the summit falls in this interstop, and the radius is small,
        // so it only affects the ends of this interstop;
        // distribute the force between the two endstops so that they
        // get all the painting even if they are not touched by the brush
        tweak_stop_color(
          mode,
          stop,
          goal,
          (force * (pos_e - offset_l)) / (offset_h - offset_l),
          do_h,
          do_s,
          do_l,
        );
        tweak_stop_color(
          mode,
          prevStop,
          goal,
          (force * (offset_h - pos_e)) / (offset_h - offset_l),
          do_h,
          do_s,
          do_l,
        );
        stop.updateRepr();
        child_prev.updateRepr();
        break;
      }
      // wide brush, may affect more than 2 stops,
      // paint each stop by the force from the profile curve
      if (offset_l <= pos_e && offset_l > pos_e - r) {
        tweak_stop_color(
          mode,
          prevStop,
          goal,
          force * tweak_profile(Math.abs(pos_e - offset_l), r),
          do_h,
          do_s,
          do_l,
        );
        child_prev.updateRepr();
      }
      if (offset_h >= pos_e && offset_h < pos_e + r) {
        tweak_stop_color(
          mode,
          stop,
          goal,
          force * tweak_profile(Math.abs(pos_e - offset_h), r),
          do_h,
          do_s,
          do_l,
        );
        stop.updateRepr();
      }
    }

    offset_l = offset_h;
    child_prev = stop;
  }
}

/**
 * The tweak tool (upstream TweakTool): drag over the selected objects to
 * move, move in/out, jitter, scale, rotate, duplicate/delete them, push,
 * shrink/grow, attract/repel or roughen their paths, paint or jitter their
 * colors, or blur them. Shift inverts the mode; Ctrl shrinks/grows while held.
 * The force falls off from the brush center (tweak_profile); with pressure,
 * the pen pressure scales it.
 * TODO: 3D boxes, mesh gradients, LPE items (inkscape:original-d), status
 * bar messages and cursors, Alt+X, the gradient drag (/tools/tweak/gradientdrag).
 */
export class TweakTool extends ToolBase {
  /* extended input data */
  pressure = TC_DEFAULT_PRESSURE;

  /* attributes */
  usepressure = false;
  usetilt = false;

  width = 0.2;
  force = 0.2;
  fidelity = 0;

  mode = TweakMode.TWEAK_MODE_MOVE;

  is_drawing = false;

  is_dilating = false;
  has_dilated = false;
  last_push = new Point(0, 0);
  dilate_area: CanvasItemBpath;

  do_h = true;
  do_s = true;
  do_l = true;
  do_o = false;

  readonly #disconnectSetStyle: () => void;

  constructor(desktop: SPDesktop) {
    super(desktop, '/tools/tweak');
    this.dilate_area = new CanvasItemBpath(desktop.getCanvasTemp());
    this.dilate_area.set_stroke(0xff9900ff);
    this.dilate_area.set_fill(0x0);
    this.dilate_area.set_visible(false);

    for (const name of ['width', 'mode', 'fidelity', 'force', 'usepressure', 'doh', 'dol', 'dos', 'doo']) {
      this.sp_event_context_read(name);
    }

    // catch style-setting signal in this tool
    this.#disconnectSetStyle = desktop.connectSetStyle((css) => this.set_style(css));

    if (Preferences.get().getBool('/tools/tweak/selcue')) this.enableSelectionCue();
    this._element.addEventListener('pointerleave', this.#onLeave);
  }

  override destroy(): void {
    this.#disconnectSetStyle();
    this._element.removeEventListener('pointerleave', this.#onLeave);
    this.dilate_area.unlink();
    super.destroy();
  }

  readonly #onLeave = (): void => {
    this.dilate_area.set_visible(false);
  };

  /** In color paint mode, take the style set in Fill and Stroke etc. as the tool's color. */
  set_style(css: Parameters<typeof spCssAttrUnsetUris>[0]): boolean {
    if (this.mode === TweakMode.TWEAK_MODE_COLORPAINT) {
      // intercept color setting only in this mode
      // we cannot store properties with uris
      Preferences.get().setString('/tools/tweak/style', spReprCssWriteString(spCssAttrUnsetUris(css)));
      return true;
    }
    return false;
  }

  override set(name: string): void {
    const prefs = Preferences.get();
    const path = `/tools/tweak/${name}`;
    if (name === 'width') {
      this.width = clamp(prefs.getDouble(path, 0.1), -1000.0, 1000.0);
    } else if (name === 'mode') {
      this.mode = prefs.getInt(path);
    } else if (name === 'fidelity') {
      this.fidelity = clamp(prefs.getDouble(path), 0.0, 1.0);
    } else if (name === 'force') {
      this.force = clamp(prefs.getDouble(path, 1.0), 0, 1.0);
    } else if (name === 'usepressure') {
      this.usepressure = prefs.getBool(path);
    } else if (name === 'doh' || name === 'dos' || name === 'dol' || name === 'doo') {
      // Default on, as upstream's toolbar writes them at startup.
      const on = prefs.getBool(path, true);
      if (name === 'doh') this.do_h = on;
      else if (name === 'dos') this.do_s = on;
      else if (name === 'dol') this.do_l = on;
      else this.do_o = on;
    }
  }

  extinput(ext: ExtendedInput): void {
    this.pressure =
      ext.pressure !== undefined
        ? clamp(ext.pressure, TC_MIN_PRESSURE, TC_MAX_PRESSURE)
        : TC_DEFAULT_PRESSURE;
  }

  /** 10 times the pen width (upstream get_dilate_radius). */
  get_dilate_radius(): number {
    return (500 * this.width) / this._desktop.current_zoom();
  }

  get_path_force(): number {
    let force =
      (8 * (this.usepressure ? this.pressure : TC_DEFAULT_PRESSURE)) /
      Math.sqrt(this._desktop.current_zoom());
    if (force > 3) force += 4 * (force - 3);
    return force * this.force;
  }

  get_move_force(): number {
    const force = this.usepressure ? this.pressure : TC_DEFAULT_PRESSURE;
    return force * this.force;
  }

  /**
   * Apply the mode at p (document coordinates) to the selected objects; vector
   * is the drag since the press. Returns whether anything changed (upstream sp_tweak_dilate).
   */
  dilate(event_p: Point, p: Point, vector: Point, reverse: boolean): boolean {
    const desktop = this._desktop;
    const selection = desktop.getSelection();
    if (selection.isEmpty()) return false;

    let did = false;
    const radius = this.get_dilate_radius();

    const item_at_point = desktop.getItemAtPoint(event_p, true);

    const fill_goal = sp_desktop_get_color_tool(desktop, '/tools/tweak', true);
    const stroke_goal = sp_desktop_get_color_tool(desktop, '/tools/tweak', false);
    let { value: opacity_goal, has_opacity: do_opacity } = sp_desktop_get_master_opacity_tool(
      desktop,
      '/tools/tweak',
    );
    if (reverse) {
      fill_goal?.invert();
      stroke_goal?.invert();
      opacity_goal = 1 - opacity_goal;
    }

    const path_force = this.get_path_force();
    if (radius === 0 || path_force === 0) return false;
    const move_force = this.get_move_force();
    const color_force = Math.min(Math.sqrt(path_force) / 20.0, 1);

    for (const item of selection.items()) {
      if (is_color_mode(this.mode)) {
        if (fill_goal || stroke_goal || do_opacity) {
          if (
            this.#colorRecursive(
              item,
              item_at_point,
              fill_goal,
              stroke_goal,
              opacity_goal,
              do_opacity,
              this.mode === TweakMode.TWEAK_MODE_BLUR,
              reverse,
              p,
              radius,
              color_force,
            )
          ) {
            did = true;
          }
        }
      } else if (is_transform_mode(this.mode)) {
        if (this.#dilateRecursive(selection, item, p, vector, radius, move_force, reverse)) did = true;
      } else {
        if (this.#dilateRecursive(selection, item, p, vector, radius, path_force, reverse)) did = true;
      }
    }
    return did;
  }

  /** Transform or reshape item (and the items in a group); upstream sp_tweak_dilate_recursive. */
  #dilateRecursive(
    selection: Selection,
    item: SPItem,
    p: Point,
    vector: Point,
    radius: number,
    force: number,
    reverse: boolean,
  ): boolean {
    const mode = this.mode;
    let did = false;

    // TODO: convert 3D boxes to ordinary groups before tweaking their shapes

    if (item instanceof SPText || item instanceof SPFlowtext) {
      const doc = item.document;
      const selected: SPItem[] = [];
      const to_select: XmlNode[] = [];
      sp_item_list_to_curves([item], selected, to_select);
      const newObj = to_select[0] ? doc.getObjectByRepr(to_select[0]) : null;
      if (newObj instanceof SPItem) {
        item = newObj;
        selection.add(item);
      }
    }

    if (item instanceof SPGroup) {
      const children = item.children.filter((c): c is SPItem => c instanceof SPItem);
      for (const child of children.reverse()) {
        if (this.#dilateRecursive(selection, child, p, vector, radius, force, reverse)) did = true;
      }
      return did;
    }

    const a = item.documentVisualBounds();
    /** The weight of the brush at the item (raised cosine of the distance of the bbox center). */
    const weight = (): number | null => {
      if (!a) return null;
      let x = L2(a.midpoint().sub(p)) / radius;
      if (a.contains(p)) x = 0;
      return x < 1 ? 0.5 * (Math.cos(Math.PI * x) + 1) : null;
    };
    const doc2dt = this._desktop.doc2dt().withoutTranslation();

    if (mode === TweakMode.TWEAK_MODE_MOVE) {
      const w = weight();
      if (w !== null) {
        const move = vector.mul(force * w);
        item.move_rel(Translate(move.transformed(doc2dt)));
        did = true;
      }
    } else if (mode === TweakMode.TWEAK_MODE_MOVE_IN_OUT) {
      const w = weight();
      if (w !== null && a) {
        const move = (reverse ? a.midpoint().sub(p) : p.sub(a.midpoint())).mul(force * w);
        item.move_rel(Translate(move.transformed(doc2dt)));
        did = true;
      }
    } else if (mode === TweakMode.TWEAK_MODE_MOVE_JITTER) {
      const dp = random_range(0, Math.PI * 2);
      const dr = random_range(0, radius);
      const w = weight();
      if (w !== null) {
        const move = new Point(Math.cos(dp) * dr, Math.sin(dp) * dr).mul(force * w);
        item.move_rel(Translate(move.transformed(doc2dt)));
        did = true;
      }
    } else if (mode === TweakMode.TWEAK_MODE_SCALE) {
      const w = weight();
      if (w !== null) {
        const scale = 1 + (reverse ? force : -force) * 0.1 * w;
        item.scale_rel(Scale(scale, scale));
        did = true;
      }
    } else if (mode === TweakMode.TWEAK_MODE_ROTATE) {
      const w = weight();
      if (w !== null) {
        let angle = (reverse ? force : -force) * 0.1 * w * Math.PI;
        angle *= -this._desktop.yaxisdir();
        item.rotate_rel(Rotate(angle));
        did = true;
      }
    } else if (mode === TweakMode.TWEAK_MODE_MORELESS) {
      const w = weight();
      if (w !== null) {
        const prob = force * w;
        const chance = random_range(0, 1);
        if (chance <= prob) {
          if (reverse) {
            // delete
            item.deleteObject(true);
          } else {
            // duplicate
            const doc = item.document;
            const old_repr = item.getRepr();
            const old_obj = doc.getObjectByRepr(old_repr);
            const copy = old_repr.duplicate(doc.getReprDoc());
            old_repr.parent()?.appendChild(copy);
            const new_obj = doc.getObjectByRepr(copy);
            if (old_obj && new_obj && selection.includes(old_obj)) selection.add(new_obj);
          }
          did = true;
        }
      }
    } else if (item instanceof SPShape) {
      did = this.#tweakPath(selection, item, p, vector, radius, force, reverse);
    }
    return did;
  }

  /** The path modes: reshape the path of item with livarot (WASM). Shapes are converted to paths. */
  #tweakPath(
    selection: Selection,
    item: SPShape,
    p: Point,
    vector: Point,
    radius: number,
    force: number,
    reverse: boolean,
  ): boolean {
    let newrepr: XmlNode | null = null;
    let pos = 0;
    let parent: XmlNode | null = null;
    let id: string | null = null;
    if (!(item instanceof SPPath)) {
      newrepr = sp_selected_item_to_curved_repr(item);
      if (!newrepr) return false;

      // remember the position of the item
      pos = item.getRepr().position();
      // remember parent
      parent = item.getRepr().parent();
      // remember id
      id = item.getRepr().attribute('id');
    }

    // skip those paths whose bboxes are entirely out of reach with our radius
    const bbox = item.documentVisualBounds();
    if (bbox && !bbox.expandBy(radius).contains(p)) return false;

    const orig = item.curve();
    if (!orig) return false;

    const i2doc = item.i2docAffine();

    const css = spReprCssAttr(item.getRepr(), 'style');
    const val = spReprCssProperty(css, 'fill-rule', null);
    const fill_rule = val === 'evenodd' ? FillRule.fill_oddEven : FillRule.fill_nonZero;

    if (L2(vector) !== 0) vector = vector.mul(1 / L2(vector));

    let livarot_mode: LivarotTweakMode;
    let power: number;
    let push = new Point(0, 0);
    if (this.mode === TweakMode.TWEAK_MODE_SHRINK_GROW) {
      livarot_mode = LivarotTweakMode.tweak_mode_grow;
      power = reverse ? force : -force;
    } else if (this.mode === TweakMode.TWEAK_MODE_ATTRACT_REPEL) {
      livarot_mode = LivarotTweakMode.tweak_mode_repel;
      power = reverse ? force : -force;
    } else if (this.mode === TweakMode.TWEAK_MODE_PUSH) {
      livarot_mode = LivarotTweakMode.tweak_mode_push;
      power = 1.0;
      push = vector.mul(force * 2);
    } else {
      livarot_mode = LivarotTweakMode.tweak_mode_roughen;
      power = force;
    }

    const res = pathBoolopBackend().tweakPath(write_svg_path(orig), {
      mode: livarot_mode,
      power,
      fillRule: fill_rule,
      center: [p.x, p.y],
      vector: [push.x, push.y],
      radius,
      i2doc: [i2doc.at(0), i2doc.at(1), i2doc.at(2), i2doc.at(3), i2doc.at(4), i2doc.at(5)],
      fidelity: this.fidelity,
      force,
      zoom: this._desktop.current_zoom(),
    });

    // the rest only makes sense if we actually changed the path
    if (!res.changed) return false;

    if (newrepr && parent) {
      // converting to path, need to replace the repr
      const is_selected = selection.includes(item);
      if (is_selected) selection.remove(item);

      // It's going to resurrect, so we delete without notifying listeners.
      item.deleteObject(false);

      // restore id
      newrepr.setAttribute('id', id);
      // add the new repr to the parent
      // move to the saved position
      parent.addChildAtPos(newrepr, pos);

      const new_obj = item.document.getObjectByRepr(newrepr);
      if (is_selected && new_obj) selection.add(new_obj);
    }

    if (res.d) {
      // TODO: items with LPEs get inkscape:original-d.
      (newrepr ?? item.getRepr()).setAttribute('d', res.d);
    }
    // TODO: if there's 0 or 1 node left, delete this path altogether
    return true;
  }

  /** The color modes and blur (upstream sp_tweak_color_recursive). */
  #colorRecursive(
    item: SPItem,
    item_at_point: SPItem | null,
    fill_goal: Colors.Color | undefined,
    stroke_goal: Colors.Color | undefined,
    opacity_goal: number,
    do_opacity: boolean,
    do_blur: boolean,
    reverse: boolean,
    p: Point,
    radius: number,
    force: number,
  ): boolean {
    const mode = this.mode;
    let did = false;

    if (item instanceof SPGroup) {
      for (const child of item.children) {
        if (
          child instanceof SPItem &&
          this.#colorRecursive(
            child,
            item_at_point,
            fill_goal,
            stroke_goal,
            opacity_goal,
            do_opacity,
            do_blur,
            reverse,
            p,
            radius,
            force,
          )
        ) {
          did = true;
        }
      }
      return did;
    }

    const style = item.style;
    if (!style) return false;
    const bbox = item.documentGeometricBounds();
    if (!bbox) return false;

    const brush = new Rect(p.sub(new Point(radius, radius)), p.add(new Point(radius, radius)));

    const center = bbox.midpoint();
    let this_force: number;

    if (item === item_at_point) {
      // if item == item_at_point, use max force
      this_force = force;
    } else if (!bbox.intersects(brush)) {
      // else if no overlap of bbox and brush box, skip:
      return false;
      //TODO:
      // else if object > 1.5 brush: test 4/8/16 points in the brush on hitting the object, choose max
      //} else if (bbox->maxExtent() > 3 * radius) {
      //}
      // else if object > 0.5 brush: test 4 corners of bbox and center on being in the brush, choose max
      // else if still smaller, then check only the object center:
    } else {
      this_force = force * tweak_profile(L2(p.sub(center)), radius);
    }

    if (this_force > 0.002) {
      if (do_blur) {
        let blur_now = 0;
        const i2dt = item.i2dtAffine();
        const filter = style.filter.set ? style.getFilter() : null;
        if (filter) {
          //cycle through filter primitives
          for (const primitive of filter.children) {
            //if primitive is gaussianblur
            if (primitive instanceof SPGaussianBlur) {
              const num = primitive.get_std_deviation().getNumber();
              blur_now += num * i2dt.descrim(); // sum all blurs in the filter
            }
          }
        }
        const perimeter = bbox.width() + bbox.height();
        blur_now = blur_now / perimeter;

        let blur_new = reverse ? blur_now - 0.06 * force : blur_now + 0.06 * force;
        if (blur_new < 0.0005 && blur_new < blur_now) blur_new = 0;
        if (blur_new === 0) {
          remove_filter(item, false);
        } else {
          const blur_radius = blur_new * perimeter;
          const new_filter = modify_filter_gaussian_blur_from_item(item.document, item, blur_radius);
          spStyleSetPropertyUrl(item, 'filter', new_filter, false);
        }
        return true; // do not do colors, blur is a separate mode
      }

      if (fill_goal) {
        if (style.fill.isPaintserver()) {
          tweak_colors_in_gradient(
            item,
            PaintTarget.FOR_FILL,
            fill_goal,
            p,
            radius,
            this_force,
            mode,
            this.do_h,
            this.do_s,
            this.do_l,
          );
          did = true;
        } else if (style.fill.isColor()) {
          style.fill.setColor(
            tweak_color(mode, style.fill.getColor(), fill_goal, this_force, this.do_h, this.do_s, this.do_l),
          );
          item.updateRepr();
          did = true;
        }
      }
      if (stroke_goal) {
        if (style.stroke.isPaintserver()) {
          tweak_colors_in_gradient(
            item,
            PaintTarget.FOR_STROKE,
            stroke_goal,
            p,
            radius,
            this_force,
            mode,
            this.do_h,
            this.do_s,
            this.do_l,
          );
          did = true;
        } else if (style.stroke.isColor()) {
          style.stroke.setColor(
            tweak_color(
              mode,
              style.stroke.getColor(),
              stroke_goal,
              this_force,
              this.do_h,
              this.do_s,
              this.do_l,
            ),
          );
          item.updateRepr();
          did = true;
        }
      }
      if (do_opacity && this.do_o) {
        tweak_opacity(mode, style.opacity, opacity_goal, this_force);
        item.updateRepr();
      }
    }
    return did;
  }

  /** Draw the brush circle at p (desktop). */
  #updateArea(p: Point): void {
    const radius = this.get_dilate_radius();
    this.dilate_area.set_bpath([Path.fromCircle(p, radius)]);
    this.dilate_area.set_visible(true);
  }

  /** Set the mode (upstream sp_tweak_switch_mode: through the toolbar, which writes the preference). */
  switch_mode(mode: TweakMode): void {
    Preferences.get().setInt('/tools/tweak/mode', mode);
    // need to set explicitly, because the prefs may not have changed by the previous
    this.mode = mode;
  }

  override root_handler(event: Event): boolean {
    let ret = false;
    switch (event.type) {
      case 'pointerdown': {
        const e = event as PointerEvent;
        if (e.button === 0) {
          if (!have_viable_layer(this._desktop)) {
            ret = true;
          } else {
            const button_dt = this._desktopPoint(this._windowPoint(e));
            this.last_push = button_dt.transformed(this._desktop.dt2doc());

            this.extinput(extinput_from_event(e));

            this.is_drawing = true;
            this.is_dilating = true;
            this.has_dilated = false;
            this.grabCanvasEvents(e);
            ret = true;
          }
        }
        break;
      }
      case 'pointermove': {
        const e = event as PointerEvent;
        const w = this._windowPoint(e);
        const motion_dt = this._desktopPoint(w);
        const motion_doc = motion_dt.transformed(this._desktop.dt2doc());
        this.extinput(extinput_from_event(e));

        // Draw the dilating cursor.
        this.#updateArea(motion_dt);

        // TODO: flash "<b>Nothing selected!</b> Select objects to tweak." if the selection is empty.

        // dilating:
        if (this.is_drawing && e.buttons & 1) {
          this.dilate(w, motion_doc, motion_doc.sub(this.last_push), mod_tweak_invert(e));
          //this->last_push = motion_doc;
          this.has_dilated = true;
          ret = true;
        }
        break;
      }
      case 'pointerup': {
        const e = event as PointerEvent;
        const w = this._windowPoint(e);
        const motion_dt = this._desktopPoint(w);
        this.is_drawing = false;
        this.ungrabCanvasEvents(e);

        if (this.is_dilating && e.button === 0) {
          if (!this.has_dilated) {
            // If we did not rub, do a light tap.
            this.pressure = 0.03;
            this.dilate(
              w,
              motion_dt.transformed(this._desktop.dt2doc()),
              new Point(0, 0),
              mod_tweak_invert(e),
            );
          }
          this.is_dilating = false;
          this.has_dilated = false;
          DocumentUndo.done(this._desktop.getDocument(), C_('Undo', DESCRIPTIONS[this.mode]), 'tool-tweak');
          ret = true;
        }
        break;
      }
      case 'keydown':
        ret = this.#onKeyPress(event as KeyboardEvent);
        if (ret) event.preventDefault();
        break;
      case 'keyup': {
        const e = event as KeyboardEvent;
        if (e.key !== 'Shift') {
          // Control (and any other key): back to the mode of the preferences.
          this.mode = Preferences.get().getInt('/tools/tweak/mode');
        }
        break;
      }
    }
    return ret || super.root_handler(event);
  }

  #onKeyPress(event: KeyboardEvent): boolean {
    const key = latin_key(event);
    for (const [keys, mode] of MODE_KEYS) {
      if (keys.includes(key) && key.length === 1) {
        if (mod_shift_only(event)) {
          this.switch_mode(mode);
          return true;
        }
        return false;
      }
    }

    const prefs = Preferences.get();
    switch (event.key) {
      case 'ArrowUp':
        if (!mod_ctrl_only(event)) {
          this.force = Math.min(this.force + 0.05, 1.0);
          prefs.setDouble('/tools/tweak/force', this.force);
          return true;
        }
        break;
      case 'ArrowDown':
        if (!mod_ctrl_only(event)) {
          this.force = Math.max(this.force - 0.05, 0.0);
          prefs.setDouble('/tools/tweak/force', this.force);
          return true;
        }
        break;
      case 'ArrowRight':
        if (!mod_ctrl_only(event)) {
          this.width = Math.min(this.width + 0.01, 1.0);
          prefs.setDouble('/tools/tweak/width', this.width); // the same spinbutton is for alt+x
          this.#updateArea(this._desktop.point());
          return true;
        }
        break;
      case 'ArrowLeft':
        if (!mod_ctrl_only(event)) {
          this.width = Math.max(this.width - 0.01, 0.01);
          prefs.setDouble('/tools/tweak/width', this.width);
          this.#updateArea(this._desktop.point());
          return true;
        }
        break;
      case 'Home':
        this.width = 0.01;
        prefs.setDouble('/tools/tweak/width', this.width);
        this.#updateArea(this._desktop.point());
        return true;
      case 'End':
        this.width = 1.0;
        prefs.setDouble('/tools/tweak/width', this.width);
        this.#updateArea(this._desktop.point());
        return true;
      case 'Control':
        // shrink/grow while Ctrl is held; the preference keeps the mode
        this.mode = TweakMode.TWEAK_MODE_SHRINK_GROW;
        break;
      case 'Delete':
      case 'Backspace':
        return this.deleteSelectedDrag(mod_ctrl_only(event));
    }
    return false;
  }
}
