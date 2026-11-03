// SPDX-License-Identifier: GPL-2.0-or-later
// The pixels of an <image> for Trace Bitmap. Upstream has them decoded in SPImage::pixbuf; here
// the browser decodes the image (asynchronously) and draws it into a canvas.
import type { RgbaImage, SPImage } from '@inkscape-web/core';

/** The RGBA pixels of the image at its pixel size; null if it cannot be decoded. */
export async function load_image_pixels(image: SPImage): Promise<RgbaImage | null> {
  const pixbuf = image.pixbuf;
  if (!pixbuf) return null;
  const width = pixbuf.width();
  const height = pixbuf.height();
  if (!(width >= 1 && height >= 1)) return null;
  const img = new Image(width, height);
  img.src = pixbuf.href;
  try {
    await img.decode();
  } catch {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}
