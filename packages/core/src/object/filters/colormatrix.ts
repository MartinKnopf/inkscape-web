// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/filters/colormatrix.cpp, src/object/filters/colormatrix.h
/*
 * SVG <feColorMatrix> implementation.
 *
 * Authors:
 *   Felipe Sanches <juca@members.fsf.org>
 *   hugo Rodrigues <haa.rodrigues@gmail.com>
 *   Abhishek Sharma
 *
 * Copyright (C) 2007 Felipe C. da S. Sanches
 * Copyright (C) 2006 Hugo Rodrigues
 */
import { SPAttr } from '../../attributes.ts';
import { FilterColorMatrixType } from '../../display/nr-filter-types.ts';
import type { SPDocument } from '../../document.ts';
import { read_number, read_vector } from '../../util/numeric/converters.ts';
import type { Node } from '../../xml/node.ts';
import { SP_OBJECT_MODIFIED_FLAG } from '../sp-object.ts';
import { SPFilterPrimitive } from './sp-filter-primitive.ts';

function read_type(str: string | null): FilterColorMatrixType {
  switch (str) {
    case 'saturate':
      return FilterColorMatrixType.COLORMATRIX_SATURATE;
    case 'hueRotate':
      return FilterColorMatrixType.COLORMATRIX_HUEROTATE;
    case 'luminanceToAlpha':
      return FilterColorMatrixType.COLORMATRIX_LUMINANCETOALPHA;
    default:
      return FilterColorMatrixType.COLORMATRIX_MATRIX; //matrix is default
  }
}

/** svg:feColorMatrix (upstream SPFeColorMatrix). */
export class SPFeColorMatrix extends SPFilterPrimitive {
  type = FilterColorMatrixType.COLORMATRIX_MATRIX;
  value = 0.0;
  values: number[] = [];
  value_set = false;

  get_type(): FilterColorMatrixType {
    return this.type;
  }
  get_values(): readonly number[] {
    return this.values;
  }
  get_value(): number {
    return this.value;
  }

  protected override build(document: SPDocument, repr: Node): void {
    super.build(document, repr);
    this.readAttr(SPAttr.TYPE);
    this.readAttr(SPAttr.VALUES);
  }

  #set_default_value(): void {
    switch (this.type) {
      case FilterColorMatrixType.COLORMATRIX_MATRIX:
        this.values = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];
        break;
      case FilterColorMatrixType.COLORMATRIX_SATURATE:
        // Default value for saturate is 1.0 ("values" not used).
        this.value = 1;
        break;
      case FilterColorMatrixType.COLORMATRIX_HUEROTATE:
        this.value = 0;
        break;
      default:
        // value, values not used.
        break;
    }
  }

  override set(key: SPAttr, str: string | null): void {
    switch (key) {
      case SPAttr.TYPE: {
        const n_type = read_type(str);
        if (this.type !== n_type) {
          this.type = n_type;
          if (!this.value_set) this.#set_default_value();
          this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        }
        break;
      }
      case SPAttr.VALUES:
        if (str) {
          this.values = read_vector(str);
          this.value = read_number(str);
          this.value_set = true;
        } else {
          this.#set_default_value();
          this.value_set = false;
        }
        this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        break;
      default:
        super.set(key, str);
        break;
    }
  }
}
