// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/colors/spaces/alpha.h
/*
 * Authors:
 *   Martin Owens <doctormo@geek-2.com>
 *
 * Copyright (C) 2023 Authors
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */

import { Profile } from '../cms/profile.ts';
import { ProfileSpace } from './base.ts';
import { SpaceType } from './enum.ts';

/** A zero sized profile which forces opacity always on. */
export class Alpha extends ProfileSpace {
  constructor() {
    super(SpaceType.Alpha, 0, 'Alpha', 'Alpha', '');
  }

  getProfile(): Profile {
    return Profile.createGray();
  }

  toString(_values: readonly number[], _opacity = true): string {
    return '';
  }
}
