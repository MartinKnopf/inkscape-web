// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/effect.cpp, src/live_effects/effect.h
/*
 * Copyright (C) Johan Engelen 2007-2012 <j.b.c.engelen@alumnus.utwente.nl>
 *   Abhishek Sharma
 */
import { type Affine, are_near, type PathVector, type Point } from '@inkscape-web/geom';
import type { SPDocument } from '../document.ts';
import { DocumentUndo } from '../document-undo.ts';
import { count_pathvector_curves } from '../helper/geom.ts';
import { _, C_ } from '../i18n.ts';
import type { SPItem } from '../object/sp-item.ts';
import { type SPLPEItem, sp_lpe_item_update_patheffect } from '../object/sp-lpe-item.ts';
import type { SPObject } from '../object/sp-object.ts';
import type { SPShape } from '../object/sp-shape.ts';
import { Preferences } from '../preferences.ts';
import type { KnotHolder } from '../ui/knot/knot-holder-entity.ts';
import type { Node } from '../xml/node.ts';
import { EffectType, LPETypeConverter } from './effect-enum.ts';
import type { LivePathEffectObject } from './lpeobject.ts';
import { BoolParam } from './parameter/bool.ts';
import { HiddenParam } from './parameter/hidden.ts';
import type { Parameter, ParamWidget } from './parameter/parameter.ts';

export const LPE_CONVERSION_TOLERANCE = 0.01; // FIXME: find good solution for this.

export enum LPEAction {
  LPE_NONE = 0,
  LPE_ERASE,
  LPE_TO_OBJECTS,
  LPE_VISIBILITY,
  LPE_UPDATE,
}

// maybe can grow in the future with more SPItemData
interface LPEItemShapesNumbers {
  nchildshapes: number;
  nsubpaths: number;
  ncurves: number;
}

type EffectFactory = (lpenr: EffectType, lpeobj: LivePathEffectObject) => Effect | null;
let effectFactory: EffectFactory | null = null;

/**
 * Set the function that makes the effect of a type (upstream: the switch in Effect::New). The
 * effects import the object classes, so live_effects/effect-new.ts sets it.
 */
export function setEffectFactory(factory: EffectFactory): void {
  effectFactory = factory;
}

/**
 * A live path effect (upstream Inkscape::LivePathEffect::Effect): computes the path of an item
 * from its original path. Parameters are stored as attributes of the inkscape:path-effect
 * element (the LivePathEffectObject).
 */
export abstract class Effect {
  static New(lpenr: EffectType, lpeobj: LivePathEffectObject): Effect | null {
    const neweffect = effectFactory?.(lpenr, lpeobj) ?? null;
    if (!neweffect)
      console.warn(`LivePathEffect::Effect::New called with invalid patheffect type (${lpenr})`);
    neweffect?.readallParameters(lpeobj.getRepr());
    return neweffect;
  }

  /** Create an inkscape:path-effect element with the effect key name in defs and apply it to item. */
  static createAndApply(name: string | EffectType, doc: SPDocument, item: SPItem): void {
    const key = typeof name === 'string' ? name : LPETypeConverter.get_key(name);
    // Path effect definition
    const xml_doc = doc.getReprDoc();
    const repr = xml_doc.createElement('inkscape:path-effect');
    repr.setAttribute('effect', key);
    doc.getDefs()?.getRepr().appendChild(repr); // adds to <defs> and assigns the 'id' attribute
    const repr_id = repr.attribute('id');
    (item as SPLPEItem).addPathEffect(`#${repr_id}`, true);
  }

  static acceptsNumClicks(type: EffectType): number {
    switch (type) {
      case EffectType.INVALID_LPE:
        return -1; // in case we want to distinguish between invalid LPE and valid ones that expect zero clicks
      case EffectType.ANGLE_BISECTOR:
        return 3;
      case EffectType.CIRCLE_3PTS:
        return 3;
      case EffectType.CIRCLE_WITH_RADIUS:
        return 2;
      case EffectType.LINE_SEGMENT:
        return 2;
      case EffectType.PERP_BISECTOR:
        return 2;
      default:
        return 0;
    }
  }

  apply_to_clippath_and_mask = false;
  keep_paths = false; // set this to false allow retain extra generated objects, see measure line LPE
  is_load = true;
  is_applied = false;
  on_remove_all = false;
  refresh_widgets = false;
  finishiddle = false;
  satellitestoclipboard = false;
  helperLineSatellites = false;
  spinbutton_width_chars = 7;
  has_exception = false;
  readonly is_visible: BoolParam;
  readonly lpeversion: HiddenParam;
  pathvector_before_effect: PathVector = [];
  pathvector_after_effect: PathVector = [];
  // these get stored in doBeforeEffect_impl, and derived classes may do as they please with them.
  sp_lpe_item: SPLPEItem | null = null;
  current_shape: SPShape | null = null; // these get stored in performPathEffects.
  readonly param_vector: Parameter[] = [];

  // adjust path study make public if grow
  protected _adjust_path = false;
  protected _provides_knotholder_entities = false;
  protected _provides_path_adjustment = false;
  protected _lpe_action = LPEAction.LPE_NONE;
  protected oncanvasedit_it = 0;
  // set this to true in derived effects to automatically have the original path displayed as helperpath
  protected show_orig_path = false;
  // this boolean defaults to false, it concatenates the input path to one pwd2,
  // instead of normally 'splitting' the path into continuous pwd2 paths and calling doEffect_pwd2 for each.
  protected concatenate_before_pwd2 = false;
  protected current_zoom = 0;
  protected selectedNodesPoints: Point[] = [];

  readonly #lpeobj: LivePathEffectObject;
  #provides_own_flash_paths = true; // if true, the standard flash path is suppressed
  #lpenumbers: LPEItemShapesNumbers = { nchildshapes: 0, nsubpaths: 0, ncurves: 0 };
  #is_ready = false;
  #before_commit_connection: () => void;

  protected constructor(lpeobject: LivePathEffectObject) {
    this.#lpeobj = lpeobject;
    this.is_visible = new BoolParam(
      _('Is visible?'),
      _('If unchecked, the effect remains applied to the object but is temporarily disabled on canvas'),
      'is_visible',
      this,
      true,
    );
    this.lpeversion = new HiddenParam(_('Version'), _('LPE version'), 'lpeversion', this, '0', true);
    this.registerParameter(this.is_visible);
    this.registerParameter(this.lpeversion);
    this.is_visible.widget_is_visible = false;
    this.#before_commit_connection = lpeobject.document.commitSignal.connect(() => this.doOnBeforeCommit());
  }

  /** Disconnect from the document (upstream destructor). */
  destroy(): void {
    this.#before_commit_connection();
  }

  effectType(): EffectType {
    return this.#lpeobj.effecttype;
  }

  getName(): string {
    if (this.#lpeobj.effecttype_set && LPETypeConverter.is_valid_id(this.#lpeobj.effecttype)) {
      return C_('path effect', LPETypeConverter.get_label(this.#lpeobj.effecttype));
    }
    return _('No effect');
  }

  getCurrrentLPEItems(): SPLPEItem[] {
    const result: SPLPEItem[] = [];
    if (!this.#lpeobj.deleted) {
      for (const item of this.#lpeobj.hrefList) {
        if (isLPEItem(item)) result.push(item);
      }
    }
    return result;
  }

  /** Is performed a single time when the effect is freshly applied to a path */
  protected doOnApply(_lpeitem: SPLPEItem): void {}

  setCurrentZoom(cZ: number): void {
    this.current_zoom = cZ;
  }

  /** Overridden function to apply transforms for example to powerstroke, jointtype or tapperstroke */
  protected transform_multiply(_postmul: Affine, _set: boolean): void {}

  transform_multiply_impl(postmul: Affine, lpeitem: SPLPEItem): void {
    this.sp_lpe_item = lpeitem;
    this.transform_multiply(postmul, false);
  }

  setSelectedNodePoints(sNP: Point[]): void {
    this.selectedNodesPoints = sNP;
  }

  isOnClipboard(): boolean {
    return this.#lpeobj.isOnClipboard();
  }

  isNodePointSelected(nodePoint: Point): boolean {
    if (this.selectedNodesPoints.length > 0 && this.sp_lpe_item) {
      const transformCoordinate = this.sp_lpe_item.i2dtAffine();
      const p2 = nodePoint.transformed(transformCoordinate);
      for (const p of this.selectedNodesPoints) {
        if (are_near(p, p2, 0.01)) return true;
      }
    }
    return false;
  }

  /**
   * this is done in each action committed to undo and allow do things when all operations pending are done in this
   * undo stack. TODO: the satellite actions (LPE_ERASE, LPE_TO_OBJECTS, LPE_VISIBILITY) of split modes.
   */
  doOnBeforeCommit(): void {
    const document = this.getSPDoc();
    if (!document || this.#lpeobj.hrefList.length === 0 || this._lpe_action === LPEAction.LPE_NONE) {
      this._lpe_action = LPEAction.LPE_NONE;
      return;
    }
    if (!this.sp_lpe_item?.document) {
      const first = this.#lpeobj.hrefList[0];
      this.sp_lpe_item = first && isLPEItem(first) ? first : null;
      if (!this.sp_lpe_item) {
        this._lpe_action = LPEAction.LPE_NONE;
        return;
      }
    }
    if (this.sp_lpe_item && this._lpe_action === LPEAction.LPE_UPDATE) {
      if (this.sp_lpe_item.getCurrentLPE() === this) {
        const item = this.sp_lpe_item;
        DocumentUndo.scopedInsensitive(item.document, () => sp_lpe_item_update_patheffect(item, false, true));
      }
    }
    this._lpe_action = LPEAction.LPE_NONE;
  }

  // we delay till current operation is done to aboid deleted items crashes
  processObjects(lpe_action: LPEAction): void {
    this._lpe_action = lpe_action;
  }

  /**
   * Is performed on load document or revert
   * If the item is fixed legacy return true
   */
  protected doOnOpen(_lpeitem: SPLPEItem): boolean {
    // Do nothing for simple effects
    this.update_satellites();
    return false;
  }

  update_satellites(): void {
    for (const p of this.param_vector) p.update_satellites();
  }

  /** Is performed each time before the effect is updated. */
  protected doBeforeEffect(_lpeitem: SPLPEItem): void {
    //Do nothing for simple effects
  }

  /**
   * Is performed at the end of the LPE only one time per "lpeitem"
   * in paths/shapes is called in middle of the effect so we add the
   * "curve" param to allow updates in the LPE results at this stage
   * for groups dont need to send "curve" parameter because is applied
   * when the LPE process finish, we can update LPE results without "curve" parameter
   */
  protected doAfterEffect(_lpeitem: SPLPEItem, _curve: PathVector | null): void {
    // Do nothing for simple effects
    this.update_satellites();
  }

  doOnException(_lpeitem: SPLPEItem): void {
    this.has_exception = true;
    this.pathvector_after_effect = this.pathvector_before_effect;
  }

  protected doOnRemove(_lpeitem: SPLPEItem | null): void {}

  doOnVisibilityToggled(_lpeitem: SPLPEItem): void {}

  adjustForNewPath(): void {
    this._adjust_path = true;
  }

  //secret impl methods (shhhh!)
  doAfterEffect_impl(lpeitem: SPLPEItem, curve: PathVector | null): void {
    this.doAfterEffect(lpeitem, curve);
    this.is_load = false;
    this.is_applied = false;
    this._adjust_path = false;
  }

  doOnRemove_impl(_lpeitem: SPLPEItem): void {
    const document = this.getSPDoc();
    if (!document) return;
    if (!this.sp_lpe_item?.document) {
      const first = this.#lpeobj.hrefList[0];
      this.sp_lpe_item = first && isLPEItem(first) && first.document ? first : null;
    }
    if (!this.keep_paths) {
      for (const satellite of this.effect_get_satellites()) satellite.deleteObject();
    }
    this.doOnRemove(this.sp_lpe_item);
    this.#lpeobj.deleted = true;
  }

  /** Is performed on document open allow things like fix legacy LPE in a undo insensitive way */
  doOnOpen_impl(): void {
    const lpeitems = this.getCurrrentLPEItems();
    if (lpeitems.length === 1 && !this.isReady()) {
      this.is_load = true;
      this.doOnOpen(lpeitems[0] as SPLPEItem);
      this.setReady(true);
    }
  }

  /** Write the parameters and close the undo step (when the effect is used by one item). */
  makeUndoDone(message: string): void {
    const lpeitems = this.getCurrrentLPEItems();
    if (lpeitems.length === 1) {
      this.refresh_widgets = true;
      this.sp_lpe_item = lpeitems[0] as SPLPEItem;
      this.writeParamsToSVG(); // if the value change the LPEs become updated
      const doc = this.getSPDoc();
      if (doc) DocumentUndo.done(doc, message, LPETypeConverter.get_icon(this.effectType()));
    }
    this.setReady();
  }

  doOnApply_impl(lpeitem: SPLPEItem): void {
    this.sp_lpe_item = lpeitem;
    this.is_applied = true;
    // we can override "lpeversion" value in each LPE using doOnApply
    // this allow to handle legacy LPE and some times update to newest definitions
    // In BBB Martin, Mc and Jabiertxof make decision
    // to only update this value per each LPE when changes.
    // and use the Inkscape release version that has this new LPE change
    // LPE without lpeversion are created in an inkscape lower than 1.0
    this.lpeversion.param_setValue('1', true);
    this.doOnApply(lpeitem);
    this.setReady();
    // this allow keep items stored as LPE items (paths instead ellipses...)
    // (upstream updateRepr(SP_OBJECT_CHILD_MODIFIED_FLAG), which is SP_OBJECT_WRITE_EXT)
    this.sp_lpe_item.updateRepr();
    this.has_exception = false;
  }

  doBeforeEffect_impl(lpeitem: SPLPEItem): void {
    this.sp_lpe_item = lpeitem;
    if (this._provides_path_adjustment) {
      // By the moment we not handle LPEItem groups. see here how to add to
      // https://pastebin.com/e5AesES9
      const lpenumbers: LPEItemShapesNumbers = {
        nchildshapes: 0,
        nsubpaths: this.pathvector_before_effect.length,
        ncurves: count_pathvector_curves(this.pathvector_before_effect),
      };
      const old = this.#lpenumbers;
      if (
        !this.is_load &&
        (lpenumbers.nchildshapes !== old.nchildshapes ||
          lpenumbers.nsubpaths !== old.nsubpaths ||
          lpenumbers.ncurves !== old.ncurves)
      ) {
        this.adjustForNewPath();
      }
      this.#lpenumbers = lpenumbers;
    }
    this.doBeforeEffect(lpeitem);
    if (this.is_load) this.update_satellites();
  }

  writeParamsToSVG(): void {
    for (const p of this.param_vector) p.write_to_SVG();
  }

  read_from_SVG(): void {
    for (const p of this.param_vector) p.read_from_SVG();
  }

  effect_get_satellites(force = true): SPObject[] {
    const satellites: SPObject[] = [];
    if (!force && !this.satellitestoclipboard) return satellites;
    for (const p of this.param_vector) satellites.unshift(...p.param_get_satellites());
    return satellites;
  }

  /**
   * If the effect expects a path parameter (specified by a number of mouse clicks) before it is
   * applied, this is the method that processes the resulting path. Override it to customize it for
   * your LPE. But don't forget to call the parent method so that is_ready is set to true!
   */
  acceptParamPath(_param_path: SPObject): void {
    this.setReady();
  }

  getCurrentShape(): SPShape | null {
    return this.current_shape;
  }
  setCurrentShape(shape: SPShape | null): void {
    this.current_shape = shape;
  }

  /*
   * isReady() indicates whether all preparations which are necessary to apply the LPE are done,
   * e.g., waiting for a parameter path either before the effect is created or when it needs a
   * path as argument. This is set in SPLPEItem::addPathEffect().
   */
  isReady(): boolean {
    return this.#is_ready;
  }
  setReady(ready = true): void {
    this.#is_ready = ready;
  }

  /*
   *  Here be the doEffect function chain:
   */
  doEffect(curve: PathVector): PathVector {
    return this.doEffect_path(curve);
  }

  /**
   * The effect on a path vector. Upstream converts each path to a Piecewise<D2<SBasis>> and calls
   * doEffect_pwd2(); the effects that use pwd2 here override this method instead.
   */
  protected doEffect_path(path_in: PathVector): PathVector {
    console.warn('Effect has no doEffect implementation');
    return path_in;
  }

  readallParameters(repr: Node): void {
    const prefs = Preferences.get();
    for (const param of this.param_vector) {
      const key = param.param_key;
      const value = repr.attribute(key);
      if (value !== null) {
        const accepted = param.param_readSVGValue(value);
        if (!accepted) console.warn(`Effect::readallParameters - '${value}' not accepted for ${key}`);
      } else {
        const pref_path = `/live_effects/${LPETypeConverter.get_key(this.effectType())}/${key}`;
        if (prefs.isSet(pref_path)) param.param_update_default(prefs.getString(pref_path));
        param.param_set_default();
      }
    }
  }

  /* This function does not and SHOULD NOT write to XML */
  setParameter(key: string, new_value: string | null): void {
    const param = this.getParameter(key);
    if (!param) return;
    if (new_value !== null) {
      const accepted = param.param_readSVGValue(new_value);
      if (!accepted) console.warn(`Effect::setParameter - '${new_value}' not accepted for ${key}`);
    } else {
      // set default value
      param.param_set_default();
    }
  }

  protected registerParameter(param: Parameter): void {
    this.param_vector.push(param);
  }

  /** Add all registered LPE knotholder handles to the knotholder */
  addHandles(knotholder: KnotHolder, item: SPItem): void {
    // add handles provided by the effect itself
    this.addKnotHolderEntities(knotholder, item);
    // add handles provided by the effect's parameters (if any)
    for (const p of this.param_vector) p.addKnotHolderEntities(knotholder, item);
    if (this.is_load && isLPEItem(item)) sp_lpe_item_update_patheffect(item, false, false);
  }

  /**
   * Return a vector of PathVectors which contain all canvas indicators for this effect, in document
   * coordinates. This is the function called by external code to get all canvas indicators
   * (effect and its parameters).
   */
  getCanvasIndicators(lpeitem: SPLPEItem): PathVector[] {
    const hp_vec: PathVector[] = [];
    // add indicators provided by the effect itself
    this.addCanvasIndicators(lpeitem, hp_vec);
    // add indicators provided by the effect's parameters
    for (const p of this.param_vector) p.addCanvasIndicators(lpeitem, hp_vec);
    const scale = lpeitem.i2docAffine();
    return hp_vec.map((pv) => pv.map((p) => p.transformed(scale)));
  }

  /**
   * Add possible canvas indicators (i.e., helperpaths other than the original path) to hp_vec
   * This function should be overwritten by derived effects if they want to provide their own helperpaths.
   */
  protected addCanvasIndicators(_lpeitem: SPLPEItem, _hp_vec: PathVector[]): void {}

  protected addKnotHolderEntities(_knotholder: KnotHolder, _item: SPItem): void {}

  /**
   * The widgets of the parameters for the Path Effects dialog (upstream newWidget() builds a GTK
   * box with param_newWidget() of the visible parameters). Effects that add buttons override it.
   */
  newWidget(): { param: Parameter | null; widget: ParamWidget }[] {
    const widgets: { param: Parameter | null; widget: ParamWidget }[] = [];
    for (const param of this.param_vector) {
      if (!param.widget_is_visible) continue;
      const widget = param.param_newWidget();
      if (widget) widgets.push({ param, widget });
    }
    return widgets;
  }

  /**
   * Called after the dialog wrote a parameter value (upstream: some effects connect to the
   * value_changed signal of a widget, e.g. the radius of Corners).
   */
  onParamWidgetChanged(_param: Parameter): void {}

  /** Set this LPE defaults */
  setDefaultParameters(): void {
    const prefs = Preferences.get();
    const effectkey = LPETypeConverter.get_key(this.effectType());
    for (const param of this.param_vector) {
      if (!param.widget_is_visible || param.param_key === 'lpeversion') continue;
      prefs.setString(`/live_effects/${effectkey}/${param.param_key}`, param.param_getSVGValue());
    }
  }

  /** Get LPE has defaults */
  hasDefaultParameters(): boolean {
    const prefs = Preferences.get();
    const effectkey = LPETypeConverter.get_key(this.effectType());
    return this.param_vector.some(
      (param) =>
        param.param_key !== 'lpeversion' && prefs.isSet(`/live_effects/${effectkey}/${param.param_key}`),
    );
  }

  /** Reset this LPE defaults */
  resetDefaultParameters(): void {
    const prefs = Preferences.get();
    const effectkey = LPETypeConverter.get_key(this.effectType());
    for (const param of this.param_vector) {
      if (!param.widget_is_visible || param.param_key === 'lpeversion') continue;
      const pref_path = `/live_effects/${effectkey}/${param.param_key}`;
      if (prefs.isSet(pref_path)) prefs.remove(pref_path);
    }
  }

  getRepr(): Node | null {
    return this.#lpeobj.getRepr();
  }

  getSPDoc(): SPDocument | null {
    return this.#lpeobj.document ?? null;
  }

  getLPEObj(): LivePathEffectObject {
    return this.#lpeobj;
  }

  getParameter(key: string): Parameter | null {
    return this.param_vector.find((p) => p.param_key === key) ?? null;
  }

  /** The next parameter that can be edited on canvas (upstream getNextOncanvasEditableParam). */
  getNextOncanvasEditableParam(): Parameter | null {
    if (this.param_vector.length === 0) return null; // no parameters
    this.oncanvasedit_it++;
    if (this.oncanvasedit_it >= this.param_vector.length) this.oncanvasedit_it = 0;
    const old_it = this.oncanvasedit_it;
    do {
      const param = this.param_vector[this.oncanvasedit_it];
      if (param?.oncanvas_editable) return param;
      this.oncanvasedit_it++;
      if (this.oncanvasedit_it === this.param_vector.length) this.oncanvasedit_it = 0; // loop round the map
    } while (this.oncanvasedit_it !== old_it); // iterate until complete loop through map has been made
    return null;
  }

  isVisible(): boolean {
    return this.is_visible.get_value();
  }

  /**
   * This function should reset the defaults and is used for example to initialize an effect right after it has been applied to a path
   * The nice thing about this is that this function can use knowledge of the original path and set things accordingly for example to the size or origin of the original path!
   */
  resetDefaults(_item: SPItem): void {
    for (const p of this.param_vector) {
      p.param_set_default();
      p.write_to_SVG();
    }
  }

  providesKnotholder(): boolean {
    // does the effect actively provide any knotholder entities of its own?
    if (this._provides_knotholder_entities) return true;
    // otherwise: are there any parameters that have knotholderentities?
    return this.param_vector.some((p) => p.providesKnotHolderEntities());
  }

  providesOwnFlashPaths(): boolean {
    return this.#provides_own_flash_paths || this.show_orig_path;
  }
  showOrigPath(): boolean {
    return this.show_orig_path;
  }

  acceptsNumClicks(): number {
    return Effect.acceptsNumClicks(this.effectType());
  }

  getHolderRemove(): boolean {
    return false;
  }

  setLPEAction(lpe_action: LPEAction): void {
    this._lpe_action = lpe_action;
  }
}

/** Whether object is an SPLPEItem (upstream is<SPLPEItem>; the class cannot be imported here at run time). */
function isLPEItem(object: SPObject): object is SPLPEItem {
  return 'path_effect_list' in object;
}
