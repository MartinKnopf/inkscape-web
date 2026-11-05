// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/internal/template-base.cpp, src/extension/internal/template-base.h
/*
 * Contain internal sizes of paper which can be used in various functions to make and size pages.
 *
 * Authors:
 *   Martin Owens <doctormo@geek-2.com>
 *
 * Copyright (C) 2022 Authors
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { convertUnit, type SPDocument, type SPPage } from '@inkscape-web/core';
import { are_near, Point, Rect } from '@inkscape-web/geom';
import { Implementation } from '../implementation/implementation.ts';
import type { Template } from '../template.ts';

/**
 * Set the document scale (user units to real world units) by changing the viewBox, with equal x
 * and y scaling (upstream SPDocument::setDocumentScale).
 */
function setDocumentScale(doc: SPDocument, scale: number): void {
  if (scale <= 0) {
    console.warn(`setDocumentScale: Invalid scale, has to be positive: ${scale}`);
    return;
  }
  const root = doc.getRoot();
  // since scale is doc size / viewbox size, then it follows that viewbox size is doc size / scale
  root.vb.viewBox = Rect.fromXywh(
    root.viewBox.left(),
    root.viewBox.top(),
    root.width.computed / scale,
    root.height.computed / scale,
  );
  root.vb.viewBox_set = true;
  root.updateRepr();
}

/** The value of an optional string parameter. */
function param_or(f: () => string, def: string): string {
  try {
    return f();
  } catch {
    return def;
  }
}

/** The implementation of the templates that have a width, height and unit (upstream TemplateBase). */
export class TemplateBase extends Implementation {
  override check(): boolean {
    return true;
  }

  /** The width and height of the new page, the default is a fixed orientation. */
  get_template_size(tmod: Template): Point {
    try {
      return new Point(tmod.get_param_float('width'), tmod.get_param_float('height'));
    } catch {
      console.warn('Template type should provide height and width params!');
    }
    return new Point(100, 100);
  }

  /** The template size in the required unit. */
  get_template_size_in(tmod: Template, unit: string): Point {
    const size = this.get_template_size(tmod);
    const t_unit = this.get_template_unit(tmod);
    return new Point(convertUnit(size.x, t_unit, unit), convertUnit(size.y, t_unit, unit));
  }

  /** The unit the size is given in (the abbreviation). */
  get_template_unit(tmod: Template): string {
    return param_or(
      () => tmod.get_param_optiongroup('unit'),
      param_or(() => tmod.get_param_string('unit'), 'cm'),
    );
  }

  override async new_from_template(tmod: Template): Promise<SPDocument | null> {
    const unit = this.get_template_unit(tmod);
    const size = this.get_template_size(tmod);

    // If it was a template file, modify the document according to user's input.
    const doc = tmod.get_template_document();
    if (!doc) return null;
    const nv = doc.getNamedView();

    // Set the width, height and default display units for the selected template
    doc.setWidthAndHeight(size.x, unit, size.y, unit, true);
    nv.setAttribute('inkscape:document-units', unit);
    setDocumentScale(doc, 1.0);
    return doc;
  }

  override async resize_to_template(tmod: Template, doc: SPDocument, page: SPPage | null): Promise<void> {
    const size = this.get_template_size_in(tmod, 'px');
    doc.getPageManager().resizePage(page, size.x, size.y);
  }

  override match_template_size(tmod: Template, width: number, height: number): boolean {
    const temp_size = this.get_template_size_in(tmod, 'px');
    // We want a half a pixel tolerance to catch floating point errors. We also check the
    // rotated size, as this is a valid match (for now).
    const near = (a: Point, b: Point) => are_near(a.x, b.x, 0.5) && are_near(a.y, b.y, 0.5);
    return near(temp_size, new Point(width, height)) || near(temp_size, new Point(height, width));
  }
}
