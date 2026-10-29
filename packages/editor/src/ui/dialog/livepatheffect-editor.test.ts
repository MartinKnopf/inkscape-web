// SPDX-License-Identifier: GPL-2.0-or-later
import { EffectType, LPECategory } from '@inkscape-web/core';
import { describe, expect, it } from 'vitest';
import { filter_lpes, get_list_of_applicable_lpes } from './livepatheffect-editor.ts';

describe('Path Effects gallery', () => {
  it('lists the ported effects by category with upstream labels and icons', () => {
    const lpes = get_list_of_applicable_lpes(null);
    expect(lpes.map((l) => l.label)).toEqual([
      'Offset',
      'Simplify',
      'Bend',
      'Roughen',
      'Mirror symmetry',
      'Rotate copies',
    ]);
    expect(lpes[0]?.category).toBe(LPECategory.EditTools);
    expect(lpes.find((l) => l.type === EffectType.MIRROR_SYMMETRY)?.icon_name).toBe('mirror-symmetry');
  });

  it('searches labels and descriptions', () => {
    const lpes = get_list_of_applicable_lpes(null);
    expect(filter_lpes(lpes, 'kaleidoscope').map((l) => l.type)).toEqual([EffectType.COPY_ROTATE]);
    expect(filter_lpes(lpes, 'MIRROR').map((l) => l.type)).toEqual([EffectType.MIRROR_SYMMETRY]);
    expect(filter_lpes(lpes, '')).toHaveLength(6);
  });
});
