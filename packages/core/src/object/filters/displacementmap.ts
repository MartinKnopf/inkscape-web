// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/filters/displacementmap.cpp, src/object/filters/displacementmap.h
/*
 * SVG <feDisplacementMap> implementation.
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

export enum FilterDisplacementMapChannelSelector {
  DISPLACEMENTMAP_CHANNEL_RED,
  DISPLACEMENTMAP_CHANNEL_GREEN,
  DISPLACEMENTMAP_CHANNEL_BLUE,
  DISPLACEMENTMAP_CHANNEL_ALPHA,
  DISPLACEMENTMAP_CHANNEL_ENDTYPE,
}

const CHANNELS = ['R', 'G', 'B', 'A'];

function read_channel_selector(value: string | null): FilterDisplacementMapChannelSelector {
  const i = value ? CHANNELS.indexOf(value[0] ?? '') : -1;
  return i >= 0 ? i : FilterDisplacementMapChannelSelector.DISPLACEMENTMAP_CHANNEL_ALPHA; // default is Alpha Channel
}

/** svg:feDisplacementMap (upstream SPFeDisplacementMap). */
export class SPFeDisplacementMap extends SPFilterPrimitive {
  scale = 0.0;
  xChannelSelector = FilterDisplacementMapChannelSelector.DISPLACEMENTMAP_CHANNEL_ALPHA;
  yChannelSelector = FilterDisplacementMapChannelSelector.DISPLACEMENTMAP_CHANNEL_ALPHA;
  in2_name: string | null = null;
  in2_slot: number = FilterSlotType.NR_FILTER_SLOT_NOT_SET;

  get_in2(): number {
    return this.in2_slot;
  }

  protected override build(document: SPDocument, repr: Node): void {
    super.build(document, repr);
    this.readAttr(SPAttr.SCALE);
    this.readAttr(SPAttr.IN2);
    this.readAttr(SPAttr.XCHANNELSELECTOR);
    this.readAttr(SPAttr.YCHANNELSELECTOR);
  }

  override set(key: SPAttr, value: string | null): void {
    switch (key) {
      case SPAttr.XCHANNELSELECTOR: {
        const n = read_channel_selector(value);
        if (n !== this.xChannelSelector) {
          this.xChannelSelector = n;
          this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        }
        break;
      }
      case SPAttr.YCHANNELSELECTOR: {
        const n = read_channel_selector(value);
        if (n !== this.yChannelSelector) {
          this.yChannelSelector = n;
          this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        }
        break;
      }
      case SPAttr.SCALE: {
        const n_num = value ? read_number(value) : 0.0;
        if (n_num !== this.scale) {
          this.scale = n_num;
          this.requestModified(SP_OBJECT_MODIFIED_FLAG);
        }
        break;
      }
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
    repr ??= xmlDoc.createElement('svg:feDisplacementMap');
    repr.setAttributeOrRemoveIfEmpty('in2', this.in2_name);
    repr.setAttributeSvgDouble('scale', this.scale);
    repr.setAttribute('xChannelSelector', CHANNELS[this.xChannelSelector] ?? null);
    repr.setAttribute('yChannelSelector', CHANNELS[this.yChannelSelector] ?? null);
    return super.write(xmlDoc, repr, flags);
  }

  override resolve_slots(resolver: SlotResolver): void {
    this.in2_slot = resolver.read(this.in2_name);
    super.resolve_slots(resolver);
  }
}
