// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/filters/composite.cpp, src/object/filters/composite.h
/*
 * SVG <feComposite> implementation.
 *
 * Authors:
 *   hugo Rodrigues <haa.rodrigues@gmail.com>
 *   Abhishek Sharma
 *
 * Copyright (C) 2006 Hugo Rodrigues
 */
import { SPAttr } from '../../attributes.ts';
import { FilterSlotType } from '../../display/nr-filter-types.ts';
import type { SPDocument } from '../../document.ts';
import { read_number } from '../../util/numeric/converters.ts';
import type { XmlDocument } from '../../xml/document.ts';
import type { Node } from '../../xml/node.ts';
import { SP_OBJECT_MODIFIED_FLAG } from '../sp-object.ts';
import type { SlotResolver } from './slot-resolver.ts';
import { SPFilterPrimitive } from './sp-filter-primitive.ts';

export enum FeCompositeOperator {
  COMPOSITE_DEFAULT,
  COMPOSITE_OVER,
  COMPOSITE_IN,
  COMPOSITE_OUT,
  COMPOSITE_ATOP,
  COMPOSITE_XOR,
  COMPOSITE_ARITHMETIC,
  COMPOSITE_LIGHTER,
  COMPOSITE_ENDOPERATOR,
}

const OPERATORS: readonly [string, FeCompositeOperator][] = [
  ['over', FeCompositeOperator.COMPOSITE_OVER],
  ['in', FeCompositeOperator.COMPOSITE_IN],
  ['out', FeCompositeOperator.COMPOSITE_OUT],
  ['atop', FeCompositeOperator.COMPOSITE_ATOP],
  ['xor', FeCompositeOperator.COMPOSITE_XOR],
  ['arithmetic', FeCompositeOperator.COMPOSITE_ARITHMETIC],
  ['lighter', FeCompositeOperator.COMPOSITE_LIGHTER],
];

/** svg:feComposite (upstream SPFeComposite). */
export class SPFeComposite extends SPFilterPrimitive {
  composite_operator = FeCompositeOperator.COMPOSITE_DEFAULT;
  k1 = 0.0;
  k2 = 0.0;
  k3 = 0.0;
  k4 = 0.0;
  in2_name: string | null = null;
  in2_slot: number = FilterSlotType.NR_FILTER_SLOT_NOT_SET;

  get_composite_operator(): FeCompositeOperator {
    return this.composite_operator;
  }
  get_in2(): number {
    return this.in2_slot;
  }

  protected override build(document: SPDocument, repr: Node): void {
    super.build(document, repr);
    this.readAttr(SPAttr.OPERATOR);
    this.readAttr(SPAttr.K1);
    this.readAttr(SPAttr.K2);
    this.readAttr(SPAttr.K3);
    this.readAttr(SPAttr.K4);
    this.readAttr(SPAttr.IN2);
  }

  override set(key: SPAttr, value: string | null): void {
    const k = (name: 'k1' | 'k2' | 'k3' | 'k4') => {
      const n_k = value ? read_number(value) : 0.0;
      if (n_k !== this[name]) {
        this[name] = n_k;
        if (this.composite_operator === FeCompositeOperator.COMPOSITE_ARITHMETIC) {
          this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        }
      }
    };
    switch (key) {
      case SPAttr.OPERATOR: {
        const n_op = OPERATORS.find(([name]) => name === value)?.[1] ?? FeCompositeOperator.COMPOSITE_DEFAULT;
        if (n_op !== this.composite_operator) {
          this.composite_operator = n_op;
          this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        }
        break;
      }
      case SPAttr.K1:
        k('k1');
        break;
      case SPAttr.K2:
        k('k2');
        break;
      case SPAttr.K3:
        k('k3');
        break;
      case SPAttr.K4:
        k('k4');
        break;
      case SPAttr.IN2:
        if (this.in2_name !== value) {
          this.in2_name = value;
          this.requestModified(SP_OBJECT_MODIFIED_FLAG);
          this.invalidate_parent_slots();
        }
        break;
      default:
        super.set(key, value);
        break;
    }
  }

  override write(xmlDoc: XmlDocument, repr: Node | null, flags: number): Node | null {
    repr ??= xmlDoc.createElement('svg:feComposite');
    repr.setAttributeOrRemoveIfEmpty('in2', this.in2_name);
    repr.setAttribute('operator', OPERATORS.find(([, op]) => op === this.composite_operator)?.[0] ?? null);
    for (const name of ['k1', 'k2', 'k3', 'k4'] as const) {
      if (this.composite_operator === FeCompositeOperator.COMPOSITE_ARITHMETIC) {
        repr.setAttributeSvgDouble(name, this[name]);
      } else {
        repr.removeAttribute(name);
      }
    }
    return super.write(xmlDoc, repr, flags);
  }

  override resolve_slots(resolver: SlotResolver): void {
    this.in2_slot = resolver.read(this.in2_name);
    super.resolve_slots(resolver);
  }
}
