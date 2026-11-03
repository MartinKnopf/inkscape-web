// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/filters/morphology.cpp, src/object/filters/morphology.h
/*
 * SVG <feMorphology> implementation.
 *
 * Authors:
 *   Felipe Sanches <juca@members.fsf.org>
 *   Hugo Rodrigues <haa.rodrigues@gmail.com>
 *   Abhishek Sharma
 *
 * Copyright (C) 2006 Hugo Rodrigues
 */
import type { Rect } from '@inkscape-web/geom';
import { SPAttr } from '../../attributes.ts';
import { FilterMorphologyOperator } from '../../display/nr-filter-types.ts';
import type { SPDocument } from '../../document.ts';
import { NumberOptNumber } from '../../number-opt-number.ts';
import type { Node } from '../../xml/node.ts';
import { SP_OBJECT_MODIFIED_FLAG } from '../sp-object.ts';
import { SPFilterPrimitive } from './sp-filter-primitive.ts';

function read_operator(value: string | null): FilterMorphologyOperator {
  return value === 'dilate'
    ? FilterMorphologyOperator.MORPHOLOGY_OPERATOR_DILATE
    : FilterMorphologyOperator.MORPHOLOGY_OPERATOR_ERODE; // erode is default
}

/** svg:feMorphology (upstream SPFeMorphology). */
export class SPFeMorphology extends SPFilterPrimitive {
  Operator = FilterMorphologyOperator.MORPHOLOGY_OPERATOR_ERODE;
  radius = new NumberOptNumber();

  protected override build(document: SPDocument, repr: Node): void {
    super.build(document, repr);
    this.readAttr(SPAttr.OPERATOR);
    this.readAttr(SPAttr.RADIUS);
  }

  override set(key: SPAttr, value: string | null): void {
    switch (key) {
      case SPAttr.OPERATOR: {
        const n_op = read_operator(value);
        if (n_op !== this.Operator) {
          this.Operator = n_op;
          this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        }
        break;
      }
      case SPAttr.RADIUS:
        this.radius.set(value);
        //From SVG spec: If <y-radius> is not provided, it defaults to <x-radius>.
        if (!this.radius.optNumIsSet()) this.radius.setOptNumber(this.radius.getNumber());
        this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        break;
      default:
        super.set(key, value);
        break;
    }
  }

  override calculate_region(region: Rect): Rect {
    const sign = this.Operator === FilterMorphologyOperator.MORPHOLOGY_OPERATOR_DILATE ? 1 : -1;
    if (this.radius.optNumIsSet()) {
      return region.expandBy(sign * this.radius.getNumber(), sign * this.radius.getOptNumber());
    }
    return region.expandBy(sign * this.radius.getNumber());
  }
}
