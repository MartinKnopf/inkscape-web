// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/filters/convolvematrix.cpp, src/object/filters/convolvematrix.h
/*
 * SVG <feConvolveMatrix> implementation.
 *
 * Authors:
 *   Felipe Corrêa da Silva Sanches <juca@members.fsf.org>
 *   hugo Rodrigues <haa.rodrigues@gmail.com>
 *   Abhishek Sharma
 *
 * Copyright (C) 2006 Hugo Rodrigues
 */
import { SPAttr } from '../../attributes.ts';
import { FilterConvolveMatrixEdgeMode } from '../../display/nr-filter-types.ts';
import type { SPDocument } from '../../document.ts';
import { NumberOptNumber } from '../../number-opt-number.ts';
import { read_bool, read_number, read_vector } from '../../util/numeric/converters.ts';
import type { Node } from '../../xml/node.ts';
import { SP_OBJECT_MODIFIED_FLAG } from '../sp-object.ts';
import { SPFilterPrimitive } from './sp-filter-primitive.ts';

function read_edgemode(value: string | null): FilterConvolveMatrixEdgeMode {
  switch (value) {
    case 'wrap':
      return FilterConvolveMatrixEdgeMode.CONVOLVEMATRIX_EDGEMODE_WRAP;
    case 'none':
      return FilterConvolveMatrixEdgeMode.CONVOLVEMATRIX_EDGEMODE_NONE;
    default:
      return FilterConvolveMatrixEdgeMode.CONVOLVEMATRIX_EDGEMODE_DUPLICATE; //duplicate is default
  }
}

/** svg:feConvolveMatrix (upstream SPFeConvolveMatrix). */
export class SPFeConvolveMatrix extends SPFilterPrimitive {
  bias = 0.0;
  edgeMode = FilterConvolveMatrixEdgeMode.CONVOLVEMATRIX_EDGEMODE_DUPLICATE;
  preserveAlpha = false;
  divisor = 0.0;
  targetX = 1;
  targetY = 1;
  kernelMatrix: number[] = [];
  divisorIsSet = false;
  targetXIsSet = false;
  targetYIsSet = false;
  kernelMatrixIsSet = false;
  order = new NumberOptNumber(3, 3);
  kernelUnitLength = new NumberOptNumber();

  get_order(): NumberOptNumber {
    return this.order;
  }
  get_kernel_matrix(): readonly number[] {
    return this.kernelMatrix;
  }

  protected override build(document: SPDocument, repr: Node): void {
    super.build(document, repr);
    this.readAttr(SPAttr.ORDER);
    this.readAttr(SPAttr.KERNELMATRIX);
    this.readAttr(SPAttr.DIVISOR);
    this.readAttr(SPAttr.BIAS);
    this.readAttr(SPAttr.TARGETX);
    this.readAttr(SPAttr.TARGETY);
    this.readAttr(SPAttr.EDGEMODE);
    this.readAttr(SPAttr.KERNELUNITLENGTH);
    this.readAttr(SPAttr.PRESERVEALPHA);
  }

  override set(key: SPAttr, value: string | null): void {
    switch (key) {
      case SPAttr.ORDER:
        this.order.set(value);
        if (!this.order.optNumIsSet()) this.order.setOptNumber(this.order.getNumber());
        if (!this.targetXIsSet) this.targetX = Math.floor(this.order.getNumber() / 2);
        if (!this.targetYIsSet) this.targetY = Math.floor(this.order.getOptNumber() / 2);
        this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.KERNELMATRIX:
        if (value) {
          this.kernelMatrixIsSet = true;
          this.kernelMatrix = read_vector(value);
          if (!this.divisorIsSet) {
            this.divisor = this.kernelMatrix.reduce((a, b) => a + b, 0);
            if (this.divisor === 0) this.divisor = 1;
          }
          this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        }
        break;
      case SPAttr.DIVISOR:
        if (value) {
          let n_num = read_number(value);
          if (n_num === 0) {
            if (this.kernelMatrixIsSet) n_num = this.kernelMatrix.reduce((a, b) => a + b, 0);
            if (n_num === 0) n_num = 1;
            if (this.divisorIsSet || this.divisor !== n_num) {
              this.divisorIsSet = false;
              this.divisor = n_num;
              this.requestModified(SP_OBJECT_MODIFIED_FLAG);
            }
          } else if (!this.divisorIsSet || this.divisor !== n_num) {
            this.divisorIsSet = true;
            this.divisor = n_num;
            this.requestModified(SP_OBJECT_MODIFIED_FLAG);
          }
        }
        break;
      case SPAttr.BIAS: {
        const n_num = value ? read_number(value) : 0;
        if (n_num !== this.bias) {
          this.bias = n_num;
          this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        }
        break;
      }
      case SPAttr.TARGETX:
        if (value) {
          let n_int = Math.trunc(read_number(value));
          if (n_int < 0 || n_int > this.order.getNumber()) {
            // targetX must be a value between 0 and orderX! Assuming floor(orderX/2) as default value.
            n_int = Math.floor(this.order.getNumber() / 2.0);
          }
          this.targetXIsSet = true;
          if (n_int !== this.targetX) {
            this.targetX = n_int;
            this.requestModified(SP_OBJECT_MODIFIED_FLAG);
          }
        }
        break;
      case SPAttr.TARGETY:
        if (value) {
          let n_int = Math.trunc(read_number(value));
          if (n_int < 0 || n_int > this.order.getOptNumber()) {
            n_int = Math.floor(this.order.getOptNumber() / 2.0);
          }
          this.targetYIsSet = true;
          if (n_int !== this.targetY) {
            this.targetY = n_int;
            this.requestModified(SP_OBJECT_MODIFIED_FLAG);
          }
        }
        break;
      case SPAttr.EDGEMODE: {
        const n_mode = read_edgemode(value);
        if (n_mode !== this.edgeMode) {
          this.edgeMode = n_mode;
          this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        }
        break;
      }
      case SPAttr.KERNELUNITLENGTH:
        this.kernelUnitLength.set(value);
        if (!this.kernelUnitLength.optNumIsSet()) {
          this.kernelUnitLength.setOptNumber(this.kernelUnitLength.getNumber());
        }
        this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.PRESERVEALPHA: {
        const b = read_bool(value, false);
        if (b !== this.preserveAlpha) {
          this.preserveAlpha = b;
          this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        }
        break;
      }
      default:
        super.set(key, value);
        break;
    }
  }
}
