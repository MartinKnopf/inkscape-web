// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/filters/componenttransfer-funcnode.cpp, src/object/filters/componenttransfer-funcnode.h
/*
 * SVG <funcR>, <funcG>, <funcB> and <funcA> implementations.
 *
 * Authors:
 *   Hugo Rodrigues <haa.rodrigues@gmail.com>
 *   Niko Kiirala <niko@kiirala.com>
 *   Felipe Corrêa da Silva Sanches <juca@members.fsf.org>
 *   Abhishek Sharma
 *
 * Copyright (C) 2006, 2007, 2008 Authors
 */
import { SPAttr } from '../../attributes.ts';
import { FilterComponentTransferType } from '../../display/nr-filter-types.ts';
import type { SPDocument } from '../../document.ts';
import { read_number, read_vector } from '../../util/numeric/converters.ts';
import type { Node } from '../../xml/node.ts';
import { SP_OBJECT_MODIFIED_FLAG, SPObject } from '../sp-object.ts';

function read_type(value: string | null): FilterComponentTransferType {
  switch (value) {
    case 'identity':
      return FilterComponentTransferType.COMPONENTTRANSFER_TYPE_IDENTITY;
    case 'table':
      return FilterComponentTransferType.COMPONENTTRANSFER_TYPE_TABLE;
    case 'discrete':
      return FilterComponentTransferType.COMPONENTTRANSFER_TYPE_DISCRETE;
    case 'linear':
      return FilterComponentTransferType.COMPONENTTRANSFER_TYPE_LINEAR;
    case 'gamma':
      return FilterComponentTransferType.COMPONENTTRANSFER_TYPE_GAMMA;
    default:
      return FilterComponentTransferType.COMPONENTTRANSFER_TYPE_ERROR; //type attribute is REQUIRED.
  }
}

/** svg:feFuncR, feFuncG, feFuncB and feFuncA (upstream SPFeFuncNode). */
export class SPFeFuncNode extends SPObject {
  static readonly R = 0;
  static readonly G = 1;
  static readonly B = 2;
  static readonly A = 3;

  type = FilterComponentTransferType.COMPONENTTRANSFER_TYPE_IDENTITY;
  tableValues: number[] = [];
  slope = 1;
  intercept = 0;
  amplitude = 1;
  exponent = 1;
  offset = 0;

  /** The channel: SPFeFuncNode.R, G, B or A. */
  constructor(readonly channel: number) {
    super();
  }

  protected override build(document: SPDocument, repr: Node): void {
    super.build(document, repr);
    this.readAttr(SPAttr.TYPE);
    this.readAttr(SPAttr.TABLEVALUES);
    this.readAttr(SPAttr.SLOPE);
    this.readAttr(SPAttr.INTERCEPT);
    this.readAttr(SPAttr.AMPLITUDE);
    this.readAttr(SPAttr.EXPONENT);
    this.readAttr(SPAttr.OFFSET);
    // TODO: document->addResource("fefuncnode", this)
  }

  override set(key: SPAttr, value: string | null): void {
    const number = (def: number) => (value ? read_number(value) : def);
    const assign = (name: 'slope' | 'intercept' | 'amplitude' | 'exponent' | 'offset', v: number) => {
      if (this[name] !== v) {
        this[name] = v;
        this.requestModified(SP_OBJECT_MODIFIED_FLAG);
      }
    };
    switch (key) {
      case SPAttr.TYPE: {
        const new_type = read_type(value);
        if (this.type !== new_type) {
          this.type = new_type;
          this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        }
        break;
      }
      case SPAttr.TABLEVALUES:
        this.tableValues = value ? read_vector(value) : [];
        this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        break;
      case SPAttr.SLOPE:
        assign('slope', number(1));
        break;
      case SPAttr.INTERCEPT:
        assign('intercept', number(0));
        break;
      case SPAttr.AMPLITUDE:
        assign('amplitude', number(1));
        break;
      case SPAttr.EXPONENT:
        assign('exponent', number(1));
        break;
      case SPAttr.OFFSET:
        assign('offset', number(0));
        break;
      default:
        super.set(key, value);
        break;
    }
  }
}
