// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/widget/object-composite-settings.cpp, src/ui/widget/object-composite-settings.h, src/ui/widget/filter-effect-chooser.cpp, src/desktop-style.cpp
/*
 * A widget for controlling object compositing (filter, opacity, etc.): the logic of the blur
 * slider and the blend mode of the Fill and Stroke dialog.
 *
 * Authors:
 *   Bryce W. Harrington <bryce@bryceharrington.org>
 *   Gustav Broberg <broberg@kth.se>
 *   Niko Kiirala <niko@kiirala.com>
 *   Abhishek Sharma
 *
 * Copyright (C) 2004--2008 Authors
 */
import {
  BLUR_MULTIPLIER,
  C_,
  DocumentUndo,
  filter_is_single_gaussian_blur,
  modify_filter_gaussian_blur_from_item,
  NC_,
  remove_filter,
  SP_OBJECT_MODIFIED_FLAG,
  SP_OBJECT_STYLE_MODIFIED_FLAG,
  SPBlendMode,
  SPGaussianBlur,
  type SPItem,
  set_blend_mode,
  spStyleSetPropertyUrl,
} from '@inkscape-web/core';
import type { SPDesktop } from '../../desktop.ts';

const ICON = 'dialog-fill-and-stroke';

/** The blend modes of the blend mode combo, in groups (upstream SPBlendModeData); null is a separator. */
export const BLEND_MODES: readonly ({ mode: SPBlendMode; label: string } | null)[] = [
  { mode: SPBlendMode.SP_CSS_BLEND_NORMAL, label: NC_('BlendMode', 'Normal') },
  null,
  { mode: SPBlendMode.SP_CSS_BLEND_DARKEN, label: NC_('BlendMode', 'Darken') },
  { mode: SPBlendMode.SP_CSS_BLEND_MULTIPLY, label: NC_('BlendMode', 'Multiply') },
  { mode: SPBlendMode.SP_CSS_BLEND_COLORBURN, label: NC_('BlendMode', 'Color Burn') },
  null,
  { mode: SPBlendMode.SP_CSS_BLEND_LIGHTEN, label: NC_('BlendMode', 'Lighten') },
  { mode: SPBlendMode.SP_CSS_BLEND_SCREEN, label: NC_('BlendMode', 'Screen') },
  { mode: SPBlendMode.SP_CSS_BLEND_COLORDODGE, label: NC_('BlendMode', 'Color Dodge') },
  null,
  { mode: SPBlendMode.SP_CSS_BLEND_OVERLAY, label: NC_('BlendMode', 'Overlay') },
  { mode: SPBlendMode.SP_CSS_BLEND_SOFTLIGHT, label: NC_('BlendMode', 'Soft Light') },
  { mode: SPBlendMode.SP_CSS_BLEND_HARDLIGHT, label: NC_('BlendMode', 'Hard Light') },
  null,
  { mode: SPBlendMode.SP_CSS_BLEND_DIFFERENCE, label: NC_('BlendMode', 'Difference') },
  { mode: SPBlendMode.SP_CSS_BLEND_EXCLUSION, label: NC_('BlendMode', 'Exclusion') },
  null,
  { mode: SPBlendMode.SP_CSS_BLEND_HUE, label: NC_('BlendMode', 'Hue') },
  { mode: SPBlendMode.SP_CSS_BLEND_SATURATION, label: NC_('BlendMode', 'Saturation') },
  { mode: SPBlendMode.SP_CSS_BLEND_COLOR, label: NC_('BlendMode', 'Color') },
  { mode: SPBlendMode.SP_CSS_BLEND_LUMINOSITY, label: NC_('BlendMode', 'Luminosity') },
];
/** The undo key of blur and blend changes: the steps of one slider drag are one undo step. */
const BLUR_TAG = 'fillstroke:blur';

/**
 * The average blur radius (desktop units) of the items with a gaussian blur, or null if no item
 * has one (upstream objects_query_blur).
 */
export function objects_query_blur(items: readonly SPItem[]): number | null {
  let blur_sum = 0;
  let blur_items = 0;
  for (const item of items) {
    const filter = item.style.filter.set ? item.style.getFilter() : null;
    if (!filter) continue;
    //cycle through filter primitives
    for (const primitive of filter.children) {
      //if primitive is gaussianblur
      if (primitive instanceof SPGaussianBlur) {
        const num = primitive.get_std_deviation().getNumber();
        const radius = num * item.i2dtAffine().descrim();
        if (!Number.isNaN(radius)) {
          blur_sum += radius;
          //TODO: deal with opt number, for the moment it's not necessary to the ui.
          blur_items++;
        }
      }
    }
  }
  return blur_items > 0 ? blur_sum / blur_items : null;
}

/** Half the perimeter of the geometric bounds of the selection (the scale of the blur slider). */
function selectionPerimeter(desktop: SPDesktop): number | null {
  const bbox = desktop.getSelection().geometricBounds();
  // fixme: this is only half the perimeter, is that correct?
  return bbox ? bbox.width() + bbox.height() : null;
}

/** The blur of the selection in percent (0..100) of the slider, or null if nothing is selected. */
export function queryBlur(desktop: SPDesktop): number | null {
  const items = desktop.getSelection().items();
  if (!items.length) return null;
  const radius = objects_query_blur(items);
  const perimeter = selectionPerimeter(desktop);
  if (radius === null || !perimeter) return 0;
  return Math.sqrt((radius * BLUR_MULTIPLIER) / perimeter) * 100;
}

/** The mix-blend-mode of the first selected item, or null if nothing is selected. */
export function queryBlendMode(desktop: SPDesktop): SPBlendMode | null {
  const item = desktop.getSelection().items()[0];
  if (!item) return null;
  return item.style.mix_blend_mode.set ? item.style.mix_blend_mode.value : SPBlendMode.SP_CSS_BLEND_NORMAL;
}

/**
 * Apply the blur (percent of the slider, 0..100) and the blend mode to the selected items
 * (upstream _blendBlurValueChanged). Steps of one slider drag are one undo step.
 */
export function setBlendBlur(desktop: SPDesktop, blurPercent: number, blend: SPBlendMode): void {
  const document = desktop.getDocument();
  const perimeter = selectionPerimeter(desktop);
  const blur_value = blurPercent / 100;
  const radius = perimeter ? (blur_value * blur_value * perimeter) / BLUR_MULTIPLIER : 0;

  //apply created filter to every selected item
  for (const item of desktop.getSelection().items()) {
    const change_blend = set_blend_mode(item, blend);
    const filter = item.style.filter.set ? item.style.getFilter() : null;
    if (radius === 0 && filter && filter_is_single_gaussian_blur(filter)) {
      remove_filter(item, false);
    } else if (radius !== 0) {
      const f = modify_filter_gaussian_blur_from_item(document, item, radius);
      f.update_filter_region(item);
      spStyleSetPropertyUrl(item, 'filter', f, false);
    }
    // with change_blend, the update is done already
    if (!change_blend) item.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_STYLE_MODIFIED_FLAG);
  }
  DocumentUndo.maybeDone(document, BLUR_TAG, C_('Undo', 'Change blur/blend filter'), ICON);
}
