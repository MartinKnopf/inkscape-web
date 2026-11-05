// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/internal/bluredge.cpp, src/extension/internal/bluredge.h
/*
 * A plug-in to add an effect to blur the edges of an object.
 *
 * Authors:
 *   Ted Gould <ted@gould.cx>
 *
 * Copyright (C) 2005 Authors
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import {
  N_,
  type SPDocument,
  sp_selected_path_inset,
  sp_selected_path_offset,
  spReprCssAttr,
  spReprCssChange,
  spReprCssDoubleProperty,
  spReprCssSetProperty,
  toCurves,
} from '@inkscape-web/core';
import type { SPDesktop } from '../../desktop.ts';
import type { Effect } from '../effect.ts';
import type { ExecutionEnv } from '../execution-env.ts';
import { Implementation } from '../implementation/implementation.ts';
import { INKSCAPE_EXTENSION_URI } from '../prefdialog/widget.ts';
import { build_from_mem } from '../system.ts';

/** The effect that makes a halo of inset and outset copies of the selected objects (upstream BlurEdge). */
export class BlurEdge extends Implementation {
  override async effect(
    module: Effect,
    _executionEnv: ExecutionEnv | null,
    desktop: SPDesktop | null,
    _document: SPDocument,
  ): Promise<void> {
    if (!desktop) return;
    const selection = desktop.getSelection();
    const width = module.get_param_float('blur-width');
    const steps = module.get_param_int('num-steps');

    const items = selection.items();
    selection.clear();

    for (const spitem of items) {
      const xml_doc = desktop.getDocument().getReprDoc();
      const new_group = xml_doc.createElement('svg:g');
      spitem.getRepr().parent()?.appendChild(new_group);

      const orig_opacity = spReprCssDoubleProperty(spReprCssAttr(spitem.getRepr(), 'style'), 'opacity', 1.0);
      const opacity_string = (orig_opacity / steps).toFixed(6); // "%f"

      for (let i = 0; i < steps; i++) {
        let offset = (width / (steps - 1)) * i - width / 2.0;

        const new_item = spitem.getRepr().duplicate(xml_doc);
        const css = spReprCssAttr(new_item, 'style');
        spReprCssSetProperty(css, 'opacity', opacity_string);
        spReprCssChange(new_item, css, 'style');

        new_group.appendChild(new_item);
        desktop.getDocument().ensureUpToDate();
        const object = desktop.getDocument().getObjectByRepr(new_item);
        if (object) selection.add(object);

        toCurves(selection);
        // TODO: selection.removeLPESRecursive(true) (there is no recursive removal yet)
        selection.unlinkRecursive(true);

        if (offset < 0.0) {
          // Doing an inset here folks
          offset *= -1.0;
          sp_selected_path_inset(selection, offset);
        } else if (offset > 0.0) {
          sp_selected_path_offset(selection, offset);
        }

        selection.clear();
      }
    }

    selection.clear();
    selection.addList(items);
  }

  static init(): void {
    build_from_mem(
      `<inkscape-extension xmlns="${INKSCAPE_EXTENSION_URI}">\n` +
        `<name>${N_('Inset/Outset Halo')}</name>\n` +
        '<id>org.inkscape.effect.bluredge</id>\n' +
        `<param name="blur-width" gui-text="${N_('Width:')}" gui-description="${N_('Width in px of the halo')}" type="float" min="1.0" max="50.0">1.0</param>\n` +
        `<param name="num-steps" gui-text="${N_('Number of steps:')}" gui-description="${N_('Number of inset/outset copies of the object to make')}" type="int" min="5" max="100">11</param>\n` +
        '<effect>\n' +
        '<object-type>all</object-type>\n' +
        '<effects-menu>\n' +
        `<submenu name="${N_('Generate from Path')}" />\n` +
        '</effects-menu>\n' +
        '</effect>\n' +
        '</inkscape-extension>\n',
      new BlurEdge(),
    );
  }
}
