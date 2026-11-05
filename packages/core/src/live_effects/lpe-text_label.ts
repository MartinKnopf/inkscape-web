// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-text_label.cpp, src/live_effects/lpe-text_label.h
/** \file
 * LPE <text_label> implementation
 */
/*
 * Authors:
 *   Maximilian Albert
 *
 * Copyright (C) Maximilian Albert 2008 <maximilian.albert@gmail.com>
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { angle_between, type PathVector, Point } from '@inkscape-web/geom';
import { _ } from '../i18n.ts';
import { Effect } from './effect.ts';
import type { LivePathEffectObject } from './lpeobject.ts';
import { TextParam } from './parameter/text.ts';
import { pwd2Samples, pwd2Transformed } from './pwd2.ts';

/** Text label (upstream LPETextLabel): a text on the canvas next to the middle of the path. The path is unchanged. */
export class LPETextLabel extends Effect {
  readonly label: TextParam;

  constructor(lpeobject: LivePathEffectObject) {
    super(lpeobject);
    this.label = new TextParam(
      _('Label:'),
      _('Text label attached to the path'),
      'label',
      this,
      'This is a label',
    );
    this.registerParameter(this.label);
  }

  /** Upstream doEffect_pwd2 on each subpath; the path is the same (as piecewise SBasis and back). */
  protected override doEffect_path(path_in: PathVector): PathVector {
    for (const path of path_in) {
      const domain = pwd2Samples(path, []);
      if (!domain) continue;
      const t = (0 + domain.end) / 2; // (pwd2_in.cuts.front() + pwd2_in.cuts.back()) / 2
      const sample = pwd2Samples(path, [t])?.samples[0];
      if (!sample) continue;
      const dir = sample.unit;
      const n = dir.rot90().neg().mul(30);

      const angle = angle_between(dir, new Point(1, 0));
      this.label.setPos(sample.point.add(n));
      this.label.setAnchor(Math.sin(angle), -Math.cos(angle));
    }
    return pwd2Transformed(path_in, [1, 0, 0, 1, 0, 0]);
  }
}
