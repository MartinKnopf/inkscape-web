// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-element-image.cpp, src/actions/actions-element-image.h, src/object/sp-image.cpp
/*
 * Gio::Actions for use with <image>.
 *
 * Copyright (C) 2022 Tavmjong Bah
 */
import {
  _,
  C_,
  DocumentUndo,
  getHrefAttribute,
  N_,
  NC_,
  ngettext,
  Pixbuf,
  SPImage,
  SPRect,
  SPUse,
  sp_embed_image,
} from '@inkscape-web/core';
import { type OptRect, type Rect, Scale, Translate } from '@inkscape-web/geom';
import type { InkscapeApplication } from '../inkscape-application.ts';
import { format_size } from '../ui/widget/memory.ts';
import { show_output } from './actions-helper.ts';

/**
 * Edit the selected images with an external program (app.element-image-edit). Upstream starts the
 * program of the preferences with the file name of the image. The browser cannot start programs or
 * see the files of an href, so the action only gives the messages of upstream for images that
 * cannot be edited (embedded images, other schemes) and the failure message for the others.
 * Note that edits are external and thus we cannot undo them!
 */
export function image_edit(app: InkscapeApplication): void {
  const selection = app.get_active_selection();
  if (!selection || selection.isEmpty()) return; // Nothing to do.

  for (let item of selection.items()) {
    // In the case of a clone of an image, edit the original image.
    if (item instanceof SPUse) {
      const original = item.trueOriginal();
      if (!original) continue;
      item = original;
    }
    if (!(item instanceof SPImage)) continue;

    const href = getHrefAttribute(item.getRepr())[1];
    if (!href) {
      show_output('image_edit: no xlink:href');
      continue;
    }
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href)?.[1]?.toLowerCase();
    if (scheme === 'data') {
      // data URL scheme, see https://www.ietf.org/rfc/rfc2397.txt
      show_output('Edit Externally: Editing embedded images (data URL) is not supported');
      continue;
    }
    if (scheme && scheme !== 'file') {
      show_output(`Edit Externally: Cannot edit image (scheme '${scheme}' not supported)`);
      continue;
    }
    show_output(
      `image_edit: ${_('Failed to edit external image.')} (the browser cannot start an image editor)`,
    );
  }
}

/**
 * The pixels of image (left, top, width, height) that area (document coordinates) covers, or null
 * if there is nothing to crop: the area covers no pixel or all of them (upstream
 * SPImage::cropToArea(Geom::Rect), which retains more pixels when in doubt).
 */
export function image_pixel_area(
  image: SPImage,
  area: Rect,
): { left: number; top: number; width: number; height: number } | null {
  const pixbuf = image.pixbuf;
  if (!pixbuf || !(image.width.computed > 0) || !(image.height.computed > 0)) return null;

  // Apply the image's position and scale to get image pixels.
  const to_pixels = image
    .i2docAffine()
    .inverse()
    .multiply(Translate(-image.x.computed, -image.y.computed))
    .multiply(Scale(pixbuf.width() / image.width.computed, pixbuf.height() / image.height.computed));
  const px = area.transformed(to_pixels);
  // Any precision problems and we choose to retain more pixels (round outwards), constrained to
  // the available pixels.
  const left = Math.max(0, Math.floor(px.left()));
  const top = Math.max(0, Math.floor(px.top()));
  const right = Math.min(pixbuf.width(), Math.ceil(px.right()));
  const bottom = Math.min(pixbuf.height(), Math.ceil(px.bottom()));
  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0) return null;
  if (width === pixbuf.width() && height === pixbuf.height()) return null;
  return { left, top, width, height };
}

/**
 * Crop the pixels of image to area (document coordinates) and change x, y, width and height so that
 * the picture stays in place (upstream SPImage::cropToArea). The browser decodes the image, so this
 * is asynchronous. Returns whether any pixels were removed.
 */
export async function image_crop_to_area(image: SPImage, area: Rect): Promise<boolean> {
  const pixbuf = image.pixbuf;
  const crop = image_pixel_area(image, area);
  if (!pixbuf || !crop) return false;
  const { left, top, width, height } = crop;

  const img = new Image();
  img.src = pixbuf.href;
  try {
    await img.decode();
  } catch {
    return false;
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  ctx.drawImage(img, left, top, width, height, 0, 0, width, height);
  const cropped = Pixbuf.create_from_data_uri(canvas.toDataURL('image/png'));
  if (!cropped || cropped.width() <= 0 || cropped.height() <= 0) return false;

  // Cropping is done, now embed this image back into image tag.
  sp_embed_image(image.getRepr(), cropped);

  // Our new image has new sizes, so adjust image tag's internal viewbox.
  const repr = image.getRepr();
  const scale_x = pixbuf.width() / image.width.computed;
  const scale_y = pixbuf.height() / image.height.computed;
  repr.setAttributeSvgDouble('x', image.x.computed + left / scale_x);
  repr.setAttributeSvgDouble('y', image.y.computed + top / scale_y);
  repr.setAttributeSvgDouble('width', width / scale_x);
  repr.setAttributeSvgDouble('height', height / scale_y);
  return true;
}

/**
 * Crop the pixels of the selected images to the first selected rectangle or, if there is none, to
 * their clipping object (app.element-image-crop). The rectangle is deleted. The promise resolves
 * when the images are cropped.
 */
export async function image_crop(app: InkscapeApplication): Promise<void> {
  const doc = app.get_active_document();
  const selection = app.get_active_selection();
  if (!doc || !selection) return;
  if (selection.isEmpty()) {
    show_output('Nothing selected.');
    return;
  }

  // Find a target rectangle, if provided.
  let target: OptRect = null;
  let rect: SPRect | null = null;
  for (const item of selection.items()) {
    if (item instanceof SPRect) {
      rect = item;
      target = rect.geometricBounds(rect.i2docAffine());
      break;
    }
  }

  // For each selected item, we loop through and attempt to crop the raster image to the geometric
  // bounds of the clipping object.
  let done = 0;
  let bytes = 0;
  for (const item of selection.items()) {
    if (!(item instanceof SPImage)) continue;
    bytes -= item.href?.length ?? 0;
    let area: OptRect = null;
    if (target) {
      // MODE A. Crop to selected rectangle.
      area = target;
    } else {
      // MODE B. Crop to image's existing clip region
      area = item.getClipObject()?.geometricBounds(item.i2docAffine()) ?? null;
    }
    if (area && (await image_crop_to_area(item, area))) done++;
    bytes += item.href?.length ?? 0;
  }
  rect?.deleteObject();

  // Tell the user what happened, since so many things could have changed.
  if (done) {
    let message = ngettext('<b>%d</b> image cropped', '<b>%d</b> images cropped', done).replace(
      '%d',
      `${done}`,
    );
    if (bytes < 0) {
      message += `, ${ngettext('%s byte removed', '%s bytes removed', Math.abs(bytes)).replace('%s', format_size(Math.abs(bytes)))}`;
    } else if (bytes > 0) {
      message += `, <b>${ngettext('%s byte added!', '%s bytes added!', bytes).replace('%s', format_size(bytes))}</b>`;
    }
    show_output(message, false);
    DocumentUndo.done(doc, C_('Undo', 'Crop Images'), 'ActionImageCrop');
  } else {
    show_output('No images cropped!');
  }
}

const SECTION = NC_('Action Section', 'Images');

/** Action id, label, section and tooltip (untranslated). */
export const raw_data_element_image: readonly (readonly [string, string, string, string])[] = [
  [
    'app.element-image-crop',
    N_('Crop image to clip'),
    SECTION,
    N_('Remove parts of the image outside the applied clipping area.'),
  ],
  [
    'app.element-image-edit',
    N_('Edit externally'),
    SECTION,
    N_('Edit image externally (image must be selected and not embedded).'),
  ],
];

export function add_actions_element_image(app: InkscapeApplication): void {
  app.actions.app.add_action('element-image-crop', () => void image_crop(app));
  app.actions.app.add_action('element-image-edit', () => image_edit(app));
  app.get_action_extra_data().add_data(raw_data_element_image);
}
