// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/filters/blend.cpp, src/object/filters/blend.h
/*
 * SVG <feBlend> implementation.
 *
 * Authors:
 *   Hugo Rodrigues <haa.rodrigues@gmail.com>
 *   Niko Kiirala <niko@kiirala.com>
 *   Abhishek Sharma
 *
 * Copyright (C) 2006,2007 authors
 */
import { SPAttr } from '../../attributes.ts';
import { FilterSlotType } from '../../display/nr-filter-types.ts';
import type { SPDocument } from '../../document.ts';
import { SPBlendMode } from '../../style-enums.ts';
import type { XmlDocument } from '../../xml/document.ts';
import type { Node } from '../../xml/node.ts';
import { SP_OBJECT_MODIFIED_FLAG, SP_OBJECT_WRITE_BUILD } from '../sp-object.ts';
import type { SlotResolver } from './slot-resolver.ts';
import { SPFilterPrimitive } from './sp-filter-primitive.ts';

const MODES: readonly [string, SPBlendMode][] = [
  ['normal', SPBlendMode.SP_CSS_BLEND_NORMAL],
  ['multiply', SPBlendMode.SP_CSS_BLEND_MULTIPLY],
  ['screen', SPBlendMode.SP_CSS_BLEND_SCREEN],
  ['darken', SPBlendMode.SP_CSS_BLEND_DARKEN],
  ['lighten', SPBlendMode.SP_CSS_BLEND_LIGHTEN],
  ['overlay', SPBlendMode.SP_CSS_BLEND_OVERLAY],
  ['color-dodge', SPBlendMode.SP_CSS_BLEND_COLORDODGE],
  ['color-burn', SPBlendMode.SP_CSS_BLEND_COLORBURN],
  ['hard-light', SPBlendMode.SP_CSS_BLEND_HARDLIGHT],
  ['soft-light', SPBlendMode.SP_CSS_BLEND_SOFTLIGHT],
  ['difference', SPBlendMode.SP_CSS_BLEND_DIFFERENCE],
  ['exclusion', SPBlendMode.SP_CSS_BLEND_EXCLUSION],
  ['hue', SPBlendMode.SP_CSS_BLEND_HUE],
  ['saturation', SPBlendMode.SP_CSS_BLEND_SATURATION],
  ['color', SPBlendMode.SP_CSS_BLEND_COLOR],
  ['luminosity', SPBlendMode.SP_CSS_BLEND_LUMINOSITY],
];

/**
 * The blend mode of the mode attribute. As upstream, soft-light is not read (it is written).
 */
function read_mode(value: string | null): SPBlendMode {
  if (value === 'soft-light' || !value) return SPBlendMode.SP_CSS_BLEND_NORMAL;
  return MODES.find(([name]) => name === value)?.[1] ?? SPBlendMode.SP_CSS_BLEND_NORMAL;
}

/** svg:feBlend (upstream SPFeBlend). */
export class SPFeBlend extends SPFilterPrimitive {
  blend_mode = SPBlendMode.SP_CSS_BLEND_NORMAL;
  in2_name: string | null = null;
  in2_slot: number = FilterSlotType.NR_FILTER_SLOT_NOT_SET;

  get_blend_mode(): SPBlendMode {
    return this.blend_mode;
  }
  get_in2(): number {
    return this.in2_slot;
  }

  protected override build(document: SPDocument, repr: Node): void {
    super.build(document, repr);
    this.readAttr(SPAttr.MODE);
    this.readAttr(SPAttr.IN2);
  }

  override set(key: SPAttr, value: string | null): void {
    switch (key) {
      case SPAttr.MODE: {
        const mode = read_mode(value);
        if (mode !== this.blend_mode) {
          this.blend_mode = mode;
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
    if (flags & SP_OBJECT_WRITE_BUILD && !repr) repr = xmlDoc.createElement('svg:feBlend');
    repr ??= this.getRepr();
    repr.setAttributeOrRemoveIfEmpty('in2', this.in2_name);
    repr.setAttribute('mode', MODES.find(([, mode]) => mode === this.blend_mode)?.[0] ?? null);
    return super.write(xmlDoc, repr, flags);
  }

  override resolve_slots(resolver: SlotResolver): void {
    this.in2_slot = resolver.read(this.in2_name);
    super.resolve_slots(resolver);
  }
}
