// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-image.cpp, src/object/sp-image.h
/*
 * SVG <image> implementation
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   Edward Flick (EAF)
 *   Abhishek Sharma
 *   Jon A. Cruz <jon@joncruz.org>
 *
 * Copyright (C) 1999-2005 Authors
 * Copyright (C) 2000-2001 Ximian, Inc.
 */
import { Affine, LineSegment, type OptRect, Path, Point, Rect } from '@inkscape-web/geom';
import { SPAttr } from '../attributes.ts';
import { Pixbuf } from '../display/cairo-utils.ts';
import type { Drawing, DrawingImage, DrawingItem } from '../display/drawing.ts';
import type { SPDocument } from '../document.ts';
import { _ } from '../i18n.ts';
import { Preferences } from '../preferences.ts';
import { SVGLengthUnit } from '../svg/svg-length.ts';
import type { XmlDocument } from '../xml/document.ts';
import { getHrefAttribute, setHrefAttribute } from '../xml/href-attribute-helper.ts';
import type { Node } from '../xml/node.ts';
import { SPDimensions } from './sp-dimensions.ts';
import { BBoxType, SPItem, type SPItemCtx } from './sp-item.ts';
import {
  SP_OBJECT_MODIFIED_FLAG,
  SP_OBJECT_STYLE_MODIFIED_FLAG,
  SP_OBJECT_USER_MODIFIED_FLAG_A,
  SP_OBJECT_VIEWPORT_MODIFIED_FLAG,
  SP_OBJECT_WRITE_BUILD,
  type SPCtx,
} from './sp-object.ts';
import { SPViewBox } from './viewbox.ts';

export const SP_IMAGE_HREF_MODIFIED_FLAG = SP_OBJECT_USER_MODIFIED_FLAG_A;

const MAGIC_EPSILON = 1e-9;
const MAGIC_EPSILON_TOO = 1e-18;

/**
 * svg:image (upstream SPImage). The image is read from href: data: URIs
 * directly, other URLs through Pixbuf.urlLoader. A missing image shows the
 * broken image.
 *
 * TODO: color profiles, sodipodi:absref, relative file hrefs (document base),
 * snap points, cropToArea, refresh_if_outdated, print, the "missing" image
 * description without pixbuf.
 */
export class SPImage extends SPItem {
  /** viewBox and preserveAspectRatio (upstream base class SPViewBox). */
  readonly vb = new SPViewBox();
  /** x, y, width, height (upstream base class SPDimensions). */
  readonly dims = new SPDimensions();

  clipbox = new Rect(0, 0, 0, 0);
  sx = 1.0;
  sy = 1.0;
  ox = 0.0;
  oy = 0.0;
  dpi = 96.0;
  prev_width = 0.0;
  prev_height = 0.0;
  /** This curve is at the image's boundary for snapping. */
  curve: Path[] | null = null;
  href: string | null = null;
  color_profile: string | null = null;
  pixbuf: Pixbuf | null = null;
  missing = true;

  get x() {
    return this.dims.x;
  }
  get y() {
    return this.dims.y;
  }
  get width() {
    return this.dims.width;
  }
  get height() {
    return this.dims.height;
  }

  protected override build(document: SPDocument, repr: Node): void {
    super.build(document, repr);
    this.readAttr(SPAttr.XLINK_HREF);
    this.readAttr(SPAttr.X);
    this.readAttr(SPAttr.Y);
    this.readAttr(SPAttr.WIDTH);
    this.readAttr(SPAttr.HEIGHT);
    this.readAttr(SPAttr.SVG_DPI);
    this.readAttr(SPAttr.PRESERVEASPECTRATIO);
    this.readAttr(SPAttr.COLOR_PROFILE);
    // TODO: document->addResource("image", this)
  }

  protected override release(): void {
    this.href = null;
    this.pixbuf = null;
    this.color_profile = null;
    this.curve = null;
    super.release();
  }

  override set(key: SPAttr, value: string | null): void {
    switch (key) {
      case SPAttr.XLINK_HREF:
        this.href = value;
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG | SP_IMAGE_HREF_MODIFIED_FLAG);
        break;
      case SPAttr.X:
        /* ex, em not handled correctly. */
        if (!this.x.read(value)) this.x.unset();
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.Y:
        /* ex, em not handled correctly. */
        if (!this.y.read(value)) this.y.unset();
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.WIDTH:
        /* ex, em not handled correctly. */
        if (!this.width.read(value)) this.width.unset();
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.HEIGHT:
        /* ex, em not handled correctly. */
        if (!this.height.read(value)) this.height.unset();
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.SVG_DPI:
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG | SP_IMAGE_HREF_MODIFIED_FLAG);
        break;
      case SPAttr.PRESERVEASPECTRATIO:
        this.vb.set_preserveAspectRatio(value);
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_VIEWPORT_MODIFIED_FLAG);
        break;
      case SPAttr.COLOR_PROFILE:
        this.color_profile = value;
        // TODO check on this HREF_MODIFIED flag
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG | SP_IMAGE_HREF_MODIFIED_FLAG);
        break;
      default:
        super.set(key, value);
        break;
    }
    this.#set_curve(); //creates a curve at the image's boundary for snapping
  }

  protected override update(ctx: SPCtx, flags: number): void {
    super.update(ctx, flags);

    if (flags & SP_IMAGE_HREF_MODIFIED_FLAG) {
      this.pixbuf = null;
      if (this.href) {
        let svgdpi = 96;
        const dpiAttr = this.getRepr().attribute('inkscape:svg-dpi');
        if (dpiAttr) svgdpi = Number.parseFloat(dpiAttr) || 96;
        this.dpi = svgdpi;
        let pb = this.#readImage(getHrefAttribute(this.getRepr())[1], svgdpi);
        if (!pb) {
          this.missing = true;
          // Passing in our previous size allows us to preserve the image's expected size.
          const broken_width = this.width._set ? this.width.computed : 640;
          const broken_height = this.height._set ? this.height.computed : 640;
          pb = SPImage.getBrokenImage(broken_width, broken_height);
        } else {
          this.missing = false;
        }
        // TODO: color profiles.
        this.pixbuf = pb;
      }
    }

    const ictx = ctx as SPItemCtx;

    // Why continue without a pixbuf? So we can display "Missing Image" png.
    const pixbuf = this.pixbuf;
    if (pixbuf) {
      if (!this.x._set) {
        this.x.unit = SVGLengthUnit.PX;
        this.x.computed = 0;
      }
      if (!this.y._set) {
        this.y.unit = SVGLengthUnit.PX;
        this.y.computed = 0;
      }
      if (!this.width._set) {
        this.width.unit = SVGLengthUnit.PX;
        this.width.computed = pixbuf.width();
      }
      if (!this.height._set) {
        this.height.unit = SVGLengthUnit.PX;
        this.height.computed = pixbuf.height();
      }
    }

    // Calculate x, y, width, height from parent/initial viewport, see sp-root.cpp
    this.dims.calcDimsFromParentViewport(ictx);

    // Image creates a new viewport
    const viewport = Rect.fromXywh(
      this.x.computed,
      this.y.computed,
      this.width.computed,
      this.height.computed,
    );
    this.clipbox = viewport;

    this.ox = this.x.computed;
    this.oy = this.y.computed;

    if (pixbuf) {
      // Viewbox is either from SVG (not supported) or dimensions of pixbuf (PNG, JPG)
      this.vb.viewBox = Rect.fromXywh(0, 0, pixbuf.width(), pixbuf.height());
      this.vb.viewBox_set = true;

      this.vb.get_rctx({ ...ictx, viewport }, 1.0);
      const c2p = this.vb.c2p;
      this.ox = c2p.c4;
      this.oy = c2p.c5;
      this.sx = c2p.c0;
      this.sy = c2p.c3;
    }

    // TODO: eliminate ox, oy, sx, sy

    this.#update_canvas_image();

    // don't crash with missing xlink:href attribute
    if (!pixbuf) return;

    let proportion_pixbuf = pixbuf.height() / pixbuf.width();
    let proportion_image = this.height.computed / this.width.computed;
    if (this.prev_width && (this.prev_width !== pixbuf.width() || this.prev_height !== pixbuf.height())) {
      if (Math.abs(this.prev_width - pixbuf.width()) > Math.abs(this.prev_height - pixbuf.height())) {
        proportion_pixbuf = pixbuf.width() / pixbuf.height();
        proportion_image = this.width.computed / this.height.computed;
        if (proportion_pixbuf !== proportion_image) {
          const new_height = this.height.computed * proportion_pixbuf;
          this.getRepr().setAttributeSvgDouble('width', new_height);
        }
      } else if (proportion_pixbuf !== proportion_image) {
        const new_width = this.width.computed * proportion_pixbuf;
        this.getRepr().setAttributeSvgDouble('height', new_width);
      }
    }
    this.prev_width = pixbuf.width();
    this.prev_height = pixbuf.height();
  }

  protected override modified(flags: number): void {
    if (flags & SP_OBJECT_STYLE_MODIFIED_FLAG) {
      for (const v of this.views) v.drawingitem.setStyle(this.style);
    }
  }

  override write(xmlDoc: XmlDocument, repr: Node | null, flags: number): Node | null {
    if (flags & SP_OBJECT_WRITE_BUILD && !repr) repr = xmlDoc.createElement('svg:image');
    if (!repr) return null;

    setHrefAttribute(repr, this.href);

    /* fixme: Reset attribute if needed (Lauris) */
    if (this.x._set) repr.setAttributeSvgDouble('x', this.x.computed);
    if (this.y._set) repr.setAttributeSvgDouble('y', this.y.computed);
    if (this.width._set) repr.setAttributeSvgDouble('width', this.width.computed);
    if (this.height._set) repr.setAttributeSvgDouble('height', this.height.computed);
    repr.setAttribute('inkscape:svg-dpi', this.getRepr().attribute('inkscape:svg-dpi'));

    this.vb.write_preserveAspectRatio(repr);

    if (this.color_profile) repr.setAttribute('color-profile', this.color_profile);

    super.write(xmlDoc, repr, flags);
    return repr;
  }

  override bbox(transform: Affine, _type: BBoxType): OptRect {
    if (this.width.computed > 0.0 && this.height.computed > 0.0) {
      return Rect.fromXywh(
        this.x.computed,
        this.y.computed,
        this.width.computed,
        this.height.computed,
      ).transformed(transform);
    }
    return null;
  }

  override typeName(): string {
    return 'image';
  }
  override displayName(): string {
    return _('Image');
  }
  override description(): string {
    const href_desc = this.href
      ? this.href.startsWith('data:')
        ? _('embedded')
        : escapeMarkup(this.href)
      : '(null_pointer)';
    if (!this.pixbuf) return _('[bad reference]: %s').replace('%s', href_desc);
    return _('%d &#215; %d: %s')
      .replace('%d', String(this.pixbuf.width()))
      .replace('%d', String(this.pixbuf.height()))
      .replace('%s', href_desc);
  }

  protected override show(drawing: Drawing, _key: number, _flags: number): DrawingItem {
    const ai = drawing.createImage();
    this.#update_arenaitem(ai);
    return ai;
  }

  /*
   * Initially we'll do:
   * Transform x, y, set x, y, clear translation
   */
  override setTransform(xform: Affine): Affine {
    /* Calculate position in parent coords. */
    let pos = new Point(this.x.computed, this.y.computed).transformed(xform);

    /* This function takes care of translation and scaling, we return whatever parts we can't
       handle. */
    let [r0, r1, r2, r3] = [xform.c0, xform.c1, xform.c2, xform.c3];
    const scale_x = Math.hypot(r0, r1);
    const scale_y = Math.hypot(r2, r3);
    if (scale_x > MAGIC_EPSILON) {
      r0 /= scale_x;
      r1 /= scale_x;
    } else {
      r0 = 1.0;
      r1 = 0.0;
    }
    if (scale_y > MAGIC_EPSILON) {
      r2 /= scale_y;
      r3 /= scale_y;
    } else {
      r2 = 0.0;
      r3 = 1.0;
    }
    const ret = new Affine(r0, r1, r2, r3, 0, 0);

    this.width.assign(this.width.computed * scale_x);
    this.height.assign(this.height.computed * scale_y);

    /* Find position in item coords */
    pos = pos.transformed(ret.inverse());
    this.x.assign(pos.x);
    this.y.assign(pos.y);

    return ret;
  }

  /** Return the curve at the image's boundary, or null. */
  get_curve(): Path[] | null {
    return this.curve;
  }

  /** The image of href: a data: URI or another URL (loaded by Pixbuf.urlLoader). */
  #readImage(href: string | null, svgdpi: number): Pixbuf | null {
    if (!href) return null;
    if (href.slice(0, 5).toLowerCase() === 'data:') {
      /* data URI - embedded image */
      return Pixbuf.create_from_data_uri(href, svgdpi);
    }
    // TODO: relative hrefs against the document base, sodipodi:absref.
    return Pixbuf.create_from_url(href, () => {
      if (this.document && this.href === href) {
        this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG | SP_IMAGE_HREF_MODIFIED_FLAG);
      }
    });
  }

  /** Load a standard broken image svg, used if we fail to load pixbufs from the href. */
  static getBrokenImage(width: number, height: number): Pixbuf {
    // Limit the size of the broken image raster. smaller than the size in cairo-utils.
    const dpi = Preferences.get().getDouble('/dialogs/import/defaultxdpi/value', 96.0);
    width = Math.max(Math.min(width, dpi * 20), 1.0);
    height = Math.max(Math.min(height, dpi * 20), 1.0);

    // Cheap templating for size allows for dynamic sized svg
    // Aspect attempts to make the image better for different ratios of images we might be dropped into
    const svg = BROKEN_IMAGE_SVG.replace('{width}', String(width))
      .replace('{height}', String(height))
      .replace('{aspect}', width > height ? 'xMinYMid' : 'xMidYMin');
    return new Pixbuf(`data:image/svg+xml,${encodeURIComponent(svg)}`, width, height, 'image/svg+xml');
  }

  #update_arenaitem(ai: DrawingImage): void {
    ai.setStyle(this.style);
    ai.setPixbuf(this.pixbuf);
    ai.setOrigin(new Point(this.ox, this.oy));
    ai.setScale(this.sx, this.sy);
    ai.setClipbox(this.clipbox);
  }

  #update_canvas_image(): void {
    for (const v of this.views) this.#update_arenaitem(v.drawingitem as DrawingImage);
  }

  #set_curve(): void {
    //create a curve at the image's boundary for snapping
    // TODO: no curve for clipped images.
    if (this.height.computed < MAGIC_EPSILON_TOO || this.width.computed < MAGIC_EPSILON_TOO) return;
    const rect = this.bbox(Affine.identity(), BBoxType.VISUAL_BBOX);
    if (rect) {
      // upstream rect_to_open_path
      const path = new Path(rect.corner(0));
      for (const i of [1, 2, 3, 0]) path.appendCurve(new LineSegment(path.finalPoint(), rect.corner(i)));
      this.curve = [path];
    }
  }
}

const BROKEN_IMAGE_SVG = `
<svg xmlns:xlink="http://www.w3.org/1999/xlink" xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}">
  <defs>
    <symbol id="nope" style="fill:none;stroke:#ffffff;stroke-width:3" viewBox="0 0 10 10" preserveAspectRatio="{aspect}">
      <circle cx="0" cy="0" r="10" style="fill:#a40000;stroke:#cc0000" />
      <line x1="0" x2="0" y1="-5" y2="5" transform="rotate(45)" />
      <line x1="0" x2="0" y1="-5" y2="5" transform="rotate(-45)" />
    </symbol>
  </defs>
  <rect width="100%" height="100%" style="fill:white;stroke:#cc0000;stroke-width:6%" />
  <use xlink:href="#nope" width="30%" height="30%" x="50%" y="50%" />
</svg>
`;

function escapeMarkup(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Embed the image of pb in image_node as a data: URI (upstream sp_embed_image). */
export function sp_embed_image(image_node: Node, pb: Pixbuf): void {
  // TODO: re-encode images that are no data: URI (upstream saves the pixbuf as PNG).
  setHrefAttribute(image_node, pb.href);
}
