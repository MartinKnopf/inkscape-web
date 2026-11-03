// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/filters/turbulence.cpp, src/object/filters/turbulence.h
/*
 * SVG <feTurbulence> implementation.
 *
 * Authors:
 *   Felipe Corrêa da Silva Sanches <juca@members.fsf.org>
 *   hugo Rodrigues <haa.rodrigues@gmail.com>
 *   Abhishek Sharma
 *
 * Copyright (C) 2007 Felipe Sanches
 * Copyright (C) 2006 Hugo Rodrigues
 */
import { SPAttr } from '../../attributes.ts';
import { FilterTurbulenceType } from '../../display/nr-filter-types.ts';
import type { SPDocument } from '../../document.ts';
import { NumberOptNumber } from '../../number-opt-number.ts';
import { read_number } from '../../util/numeric/converters.ts';
import type { XmlDocument } from '../../xml/document.ts';
import type { Node } from '../../xml/node.ts';
import { SP_OBJECT_MODIFIED_FLAG } from '../sp-object.ts';
import { SPFilterPrimitive } from './sp-filter-primitive.ts';

/** svg:feTurbulence (upstream SPFeTurbulence). */
export class SPFeTurbulence extends SPFilterPrimitive {
  numOctaves = 0;
  seed = 0.0;
  stitchTiles = false;
  type = FilterTurbulenceType.TURBULENCE_FRACTALNOISE;
  updated = false;
  baseFrequency = new NumberOptNumber();

  protected override build(document: SPDocument, repr: Node): void {
    super.build(document, repr);
    this.readAttr(SPAttr.BASEFREQUENCY);
    this.readAttr(SPAttr.NUMOCTAVES);
    this.readAttr(SPAttr.SEED);
    this.readAttr(SPAttr.STITCHTILES);
    this.readAttr(SPAttr.TYPE);
  }

  override set(key: SPAttr, value: string | null): void {
    const changed = () => {
      this.updated = false;
      this.requestModified(SP_OBJECT_MODIFIED_FLAG);
    };
    switch (key) {
      case SPAttr.BASEFREQUENCY:
        this.baseFrequency.set(value);
        // From SVG spec: If two <number>s are provided, the first number represents
        // a base frequency in the X direction and the second value represents a base
        // frequency in the Y direction. If one number is provided, then that value is
        // used for both X and Y.
        if (!this.baseFrequency.optNumIsSet())
          this.baseFrequency.setOptNumber(this.baseFrequency.getNumber());
        changed();
        break;
      case SPAttr.NUMOCTAVES: {
        const n_int = value ? Math.floor(read_number(value)) : 1;
        if (n_int !== this.numOctaves) {
          this.numOctaves = n_int;
          changed();
        }
        break;
      }
      case SPAttr.SEED: {
        const n_num = value ? read_number(value) : 0;
        if (n_num !== this.seed) {
          this.seed = n_num;
          changed();
        }
        break;
      }
      case SPAttr.STITCHTILES: {
        const n_bool = value === 'stitch'; // 'noStitch' is default
        if (n_bool !== this.stitchTiles) {
          this.stitchTiles = n_bool;
          changed();
        }
        break;
      }
      case SPAttr.TYPE: {
        // 'turbulence' is default
        const n_type =
          value === 'fractalNoise'
            ? FilterTurbulenceType.TURBULENCE_FRACTALNOISE
            : FilterTurbulenceType.TURBULENCE_TURBULENCE;
        if (n_type !== this.type) {
          this.type = n_type;
          changed();
        }
        break;
      }
      default:
        super.set(key, value);
        break;
    }
  }

  override write(xmlDoc: XmlDocument, repr: Node | null, flags: number): Node | null {
    repr ??= this.getRepr().duplicate(xmlDoc);
    super.write(xmlDoc, repr, flags);
    /* turbulence doesn't take input */
    repr.removeAttribute('in');
    return repr;
  }
}
