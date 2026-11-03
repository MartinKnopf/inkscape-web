// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/parameter/originalpath.cpp, src/live_effects/parameter/originalpath.h
/*
 * Copyright (C) Johan Engelen 2012 <j.b.c.engelen@alumnus.utwente.nl>
 */
import type { SPItem } from '../../object/sp-item.ts';
import type { SPObject } from '../../object/sp-object.ts';
import type { Effect } from '../effect.ts';
import { ParamType } from '../effect-enum.ts';
import type { LinkParam, ParamWidget } from './parameter.ts';
import { PathParam } from './path.ts';

/** A link to the path of another item, not editable on the canvas (upstream OriginalPathParam). */
export class OriginalPathParam extends PathParam implements LinkParam {
  constructor(label: string, tip: string, key: string, effect: Effect) {
    super(label, tip, key, effect, '');
    this.oncanvas_editable = false;
    this._from_original_d = false;
  }

  linksToPath(): boolean {
    return this.href !== null;
  }

  getObject(): SPItem | null {
    return this.getItem();
  }

  linkedObject(): SPObject | null {
    return this.getItem();
  }

  on_link_button_click(itemid: string): void {
    this.linkitem(itemid);
  }

  override param_newWidget(): ParamWidget | null {
    return { kind: 'satellite', select_original: true };
  }

  override paramType(): ParamType {
    return ParamType.ORIGINAL_PATH;
  }
}
