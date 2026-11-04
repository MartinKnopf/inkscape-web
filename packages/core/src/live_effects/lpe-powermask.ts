// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-powermask.cpp, src/live_effects/lpe-powermask.h
/*
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { Path, type PathVector } from '@inkscape-web/geom';
import { Color } from '../colors/color.ts';
import { _ } from '../i18n.ts';
import type { ObjectSet } from '../object/object-set.ts';
import { SPItem } from '../object/sp-item.ts';
import { SPLPEItem } from '../object/sp-lpe-item.ts';
import { sp_svg_write_path } from '../svg/svg-path.ts';
import type { Node } from '../xml/node.ts';
import {
  spReprCssAttrAddFromString,
  spReprCssAttrNew,
  spReprCssChange,
  spReprCssProperty,
  spReprCssSetProperty,
  spReprCssSetPropertyDouble,
  spReprCssSetPropertyString,
  spReprCssWriteString,
} from '../xml/repr-css.ts';
import { Effect } from './effect.ts';
import { EffectType } from './effect-enum.ts';
import type { LivePathEffectObject } from './lpeobject.ts';
import { BoolParam } from './parameter/bool.ts';
import { ColorPickerParam } from './parameter/colorpicker.ts';

/** Power mask (upstream LPEPowerMask): invert or hide a mask, or use its negative. */
export class LPEPowerMask extends Effect {
  readonly invert: BoolParam;
  readonly hide_mask: BoolParam;
  readonly background: BoolParam;
  readonly background_color: ColorPickerParam;
  #mask_box_path: Path = new Path();

  constructor(lpeobject: LivePathEffectObject) {
    super(lpeobject);
    this.invert = new BoolParam(_('Invert mask'), _('Invert mask'), 'invert', this, true);
    this.hide_mask = new BoolParam(_('Hide mask'), _('Hide mask'), 'hide_mask', this, false);
    this.background = new BoolParam(
      _('Add background to mask'),
      _('Add background to mask'),
      'background',
      this,
      true,
    );
    this.background_color = new ColorPickerParam(
      _('Background color and opacity'),
      _('Set color and opacity of the background'),
      'background_color',
      this,
      new Color(0xffffffff),
    );
    // Register parameters (order matters for UI)
    this.registerParameter(this.invert);
    this.registerParameter(this.hide_mask);
    this.registerParameter(this.background);
    this.registerParameter(this.background_color);
  }

  #getId(): string {
    return `mask-powermask-${this.getLPEObj().getId()}`;
  }

  protected override doOnApply(_lpeitem: SPLPEItem): void {
    // Update the mask id
    const mask = this.sp_lpe_item?.getMaskObject();
    if (!mask) return;
    const new_mask_id = this.#getId();
    mask.setAttribute('id', new_mask_id);
    // Update the mask uri
    this.sp_lpe_item?.setAttribute('mask', `url(#${new_mask_id})`);
  }

  protected override doBeforeEffect(lpeitem: SPLPEItem): void {
    // Handle the hide_mask and visibility toggles
    if (!this.#update_mask_visibility(lpeitem)) return;
    // Make changes to mask if necessary
    this.#update_mask_box();
    // Prepare the filter
    const filter_uri = this.#prepare_color_inversion_filter();
    // Apply filter based on current parameters
    this.#handle_inverse_filter(filter_uri);
  }

  override doOnVisibilityToggled(lpeitem: SPLPEItem): void {
    this.#update_mask_visibility(lpeitem);
  }

  protected override doEffect_path(path_in: PathVector): PathVector {
    return path_in;
  }

  protected override doOnRemove(_lpeitem: SPLPEItem | null): void {
    const document = this.getSPDoc();
    if (!document) return;
    const mask_id = this.#getId();
    // 1. Remove the filter
    document.getObjectById(`${mask_id}_inverse`)?.deleteObject(true);
    // 2. Remove the background box
    document.getObjectById(`${mask_id}_box`)?.deleteObject(true);
  }

  #update_mask_visibility(lpeitem: SPLPEItem): boolean {
    const item = this.sp_lpe_item;
    if (!item) return false;
    const attached_uri = item.getMaskRef().getURI();
    item.getMaskRef().detach();

    // Prepare the bounding box
    const bbox = lpeitem.visualBounds();
    if (!bbox) return false;
    this.#mask_box_path = Path.fromRect(bbox);

    if (!this.hide_mask.get_value() && this.is_visible.get_value()) {
      return item.getMaskRef().try_attach(attached_uri);
    }
    return false;
  }

  #handle_inverse_filter(filter_uri: string): void {
    // Mask updates
    const mask = this.sp_lpe_item?.getMaskObject();
    if (!mask) return;

    for (const mask_child of mask.childList()) {
      if (!(mask_child instanceof SPItem)) continue;
      // Parse existing style attribute into CSS object
      const new_css = spReprCssAttrNew();
      const style_attr = mask_child.getAttribute('style');
      if (style_attr) spReprCssAttrAddFromString(new_css, style_attr);

      // Check for either empty filter or the inversion filter we defined earlier
      const current_filter = spReprCssProperty(new_css, 'filter', '');
      if (current_filter === '' || current_filter === filter_uri) {
        // Apply the inversion filter only if the "invert" parameter is checked and the lpe object
        // is visible. Otherwise, remove the inversion filter
        if (this.invert.get_value() && this.is_visible.get_value()) {
          spReprCssSetProperty(new_css, 'filter', filter_uri);
        } else {
          spReprCssSetProperty(new_css, 'filter', null);
        }
        // Write the updated CSS back to the mask child
        mask_child.setAttribute('style', spReprCssWriteString(new_css));
      }
    }
  }

  #prepare_color_inversion_filter(): string {
    const document = this.getSPDoc();
    if (!document) return '';

    const filter_id = `${this.#getId()}_inverse`;
    const filter_uri = `url(#${filter_id})`;
    if (document.getObjectById(filter_id)) return filter_uri;

    // Create only if the filter is not present
    const xml_doc = document.getReprDoc();
    const filter = xml_doc.createElement('svg:filter');
    filter.setAttribute('id', filter_id);
    filter.setAttribute('inkscape:label', `filter${this.#getId()}`);

    // Create CSS for the filter
    const css = spReprCssAttrNew();
    spReprCssSetProperty(css, 'color-interpolation-filters', 'sRGB');
    spReprCssChange(filter, css, 'style');

    // Transformation matrix to normalize the color space
    const primitive1 = xml_doc.createElement('svg:feColorMatrix');
    primitive1.setAttribute('id', `${this.#getId()}_primitive1`);
    primitive1.setAttribute('values', '1');
    primitive1.setAttribute('type', 'saturate');
    primitive1.setAttribute('result', 'fbSourceGraphic');

    // Transformation matrix to invert RGB
    const primitive2 = xml_doc.createElement('svg:feColorMatrix');
    primitive2.setAttribute('id', `${this.#getId()}_primitive2`);
    primitive2.setAttribute('in', 'fbSourceGraphic');
    primitive2.setAttribute('values', '-1 0 0 0 1 0 -1 0 0 1 0 0 -1 0 1 0 0 0 1 0');

    // Add the filter to the defs
    document.getDefs()?.appendChildRepr(filter);
    filter.appendChild(primitive1);
    filter.appendChild(primitive2);
    return filter_uri;
  }

  #update_mask_box(): void {
    const document = this.getSPDoc();
    const mask = this.sp_lpe_item?.getMaskObject();
    if (!document || !mask) return;

    const box_id = `${this.#getId()}_box`;
    const box_ref = document.getObjectById(box_id);

    if (!this.background.get_value() && box_ref) {
      // Hide the background box
      if (box_ref instanceof SPItem) box_ref.setHidden(true);
      return;
    }

    // Prepare the background box
    let box: Node;
    if (box_ref) {
      if (box_ref instanceof SPItem) box_ref.setHidden(false);
      box = box_ref.getRepr();
    } else {
      // Initialize a box node if not present
      box = document.getReprDoc().createElement('svg:path');
      box.setAttribute('id', box_id);
      mask.appendChildRepr(box);
    }

    // Add CSS
    const css = spReprCssAttrNew();
    const color = this.background_color.get_value();
    spReprCssSetPropertyString(css, 'fill', color.toString(false));
    spReprCssSetPropertyDouble(css, 'fill-opacity', color.getOpacity());
    spReprCssSetPropertyString(css, 'stroke', 'none');
    spReprCssChange(box, css, 'style');

    box.setAttribute('d', sp_svg_write_path([this.#mask_box_path]));
    box.setPosition(0);
  }
}

/** Apply the Power mask effect to the selected items that have a mask (Object > Set Inverse Mask). */
export function sp_inverse_powermask(sel: ObjectSet): void {
  const document = sel.document();
  if (sel.isEmpty() || !document) return;
  for (const lpeitem of [...sel.items()].reverse()) {
    if (lpeitem instanceof SPLPEItem && lpeitem.getMaskObject()) {
      Effect.createAndApply(EffectType.POWERMASK, document, lpeitem);
    }
  }
}

/** Remove the Power mask effect from the selected items (Object > Release Object Mask). */
export function sp_remove_powermask(sel: ObjectSet): void {
  if (sel.isEmpty()) return;
  for (const lpeitem of [...sel.items()].reverse()) {
    if (!(lpeitem instanceof SPLPEItem) || !(lpeitem.hasPathEffect() && lpeitem.pathEffectsEnabled()))
      continue;
    for (const lperef of lpeitem.path_effect_list) {
      const lpeobj = lperef.lpeobject;
      if (!lpeobj) {
        console.warn('SPLPEItem::performPathEffect - NULL lpeobj in list!');
        return;
      }
      if (lpeobj.effecttype === EffectType.POWERMASK) {
        // TODO: upstream does not select the reference first either.
        lpeitem.removeCurrentPathEffect(false);
        break;
      }
    }
  }
}
