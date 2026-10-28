// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/align-and-distribute.cpp, src/ui/dialog/align-and-distribute.h, share/ui/align-and-distribute.ui
/*
 * Align and Distribute widget
 *
 * Authors:
 *   Bryce W. Harrington <bryce@bryceharrington.org>
 *   Aubanel MONNIER <aubi@libertysurf.fr>
 *   Frank Felfe <innerspace@iname.com>
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   Tim Dwyer <tgdwyer@gmail.com>
 *   Jabier Arraiza <jabier.arraiza@marker.es>
 *
 * Copyright (C) 1999-2004, 2005 Authors
 */
import { _, Preferences } from '@inkscape-web/core';
import { useRef, useState } from 'react';
import { runAction } from '../../app/actions.ts';
import { useActiveDesktop } from '../../app/active-desktop.ts';
import { iconUrl } from '../icon-loader.ts';
import { useSelectionVersion } from './use-repr.ts';

/** The "Relative to" choices: label and id (share/ui/align-and-distribute.ui RelativeToObject). */
const RELATIVE_TO: [label: string, id: string][] = [
  ['Last selected', 'last'],
  ['First selected', 'first'],
  ['Biggest object', 'biggest'],
  ['Smallest object', 'smallest'],
  ['Page', 'page'],
  ['Drawing', 'drawing'],
  ['Selection Area', 'selection'],
];

/** The choices offered for a single selected item. */
const single_selection_relative_categories = new Set(['drawing', 'page']);

/** Align buttons: icon, object-align argument and tooltip, in the order of the .ui file. */
const ALIGN_BUTTONS: [icon: string, argument: string, tooltip: string][] = [
  [
    'align-horizontal-right-to-anchor',
    'right anchor',
    'Align right edges of objects to the left edge of anchor',
  ],
  ['align-horizontal-left', 'left', 'Align left edges'],
  ['align-horizontal-center', 'hcenter', 'Center on vertical axis'],
  ['align-horizontal-right', 'right', 'Align right edges'],
  [
    'align-horizontal-left-to-anchor',
    'left anchor',
    'Align left edges of objects to the right edge of anchor',
  ],
  [
    'align-vertical-bottom-to-anchor',
    'bottom anchor',
    'Align bottom edges of objects to the top edge of anchor',
  ],
  ['align-vertical-top', 'top', 'Align top edges'],
  ['align-vertical-center', 'vcenter', 'Center on horizontal axis'],
  ['align-vertical-bottom', 'bottom', 'Align bottom edges'],
  ['align-vertical-top-to-anchor', 'top anchor', 'Align top edges of objects to bottom edge of anchor'],
];

/** Distribute buttons: icon, object-distribute argument and tooltip. */
const DISTRIBUTE_BUTTONS: [icon: string, argument: string, tooltip: string][] = [
  ['distribute-horizontal-left', 'left', 'Distribute horizontally with even spacing between left edges'],
  ['distribute-horizontal-center', 'hcenter', 'Distribute horizontally with even spacing between centers'],
  ['distribute-horizontal-right', 'right', 'Distribute horizontally with even spacing between right edges'],
  ['distribute-horizontal-gaps', 'hgap', 'Distribute horizontally with even horizontal gaps'],
  ['distribute-vertical-top', 'top', 'Distribute vertically with even spacing between top edges'],
  ['distribute-vertical-center', 'vcenter', 'Distribute vertically with even spacing between centers'],
  ['distribute-vertical-bottom', 'bottom', 'Distribute vertically with even spacing between bottom edges'],
  ['distribute-vertical-gaps', 'vgap', 'Distribute vertically with even vertical gaps'],
];

function IconButton(props: { icon: string; tooltip: string; pressed?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className="align-button"
      title={_(props.tooltip)}
      aria-label={_(props.tooltip)}
      aria-pressed={props.pressed}
      onClick={props.onClick}
    >
      <img src={iconUrl(props.icon)} alt="" width={16} height={16} />
    </button>
  );
}

/**
 * The Align and Distribute dialog (dialog key "AlignDistribute"): runs
 * app.object-align and app.object-distribute on the selection. "Relative to"
 * is remembered separately for a single item and for several items, as upstream.
 * TODO: on-canvas alignment handles (app.object-align-on-canvas), text
 * baselines (object-align-text, object-distribute-text), Rearrange, Remove
 * overlaps, node alignment for the node tool, icon size preference.
 */
export function AlignAndDistributeDialog() {
  const desktop = useActiveDesktop();
  useSelectionVersion(desktop);
  const prefs = Preferences.get();
  // Upstream keeps these in the dialog: one choice for a single item, one for several.
  const choices = useRef({
    single: 'page',
    multi: prefs.getString('/dialogs/align/objects-align-to', 'selection'),
  });
  const [asGroup, setAsGroup] = useState(() => prefs.getBool('/dialogs/align/sel-as-groups', false));
  const [, rerender] = useState(0);
  if (!desktop) return null;

  const single_item = desktop.getSelection().singleItem() !== null;
  const align_to = single_item ? choices.current.single : choices.current.multi;
  const options = RELATIVE_TO.filter(
    ([, id]) => !single_item || single_selection_relative_categories.has(id),
  );

  const onRelativeChanged = (id: string) => {
    prefs.setString('/dialogs/align/objects-align-to', id);
    if (single_item) choices.current.single = id;
    else choices.current.multi = id;
    rerender((n) => n + 1);
  };
  const onAlign = (argument: string) =>
    void runAction(`app.object-align('${argument} ${align_to}${asGroup ? ' group' : ''}')`);

  return (
    <div className="align-dialog">
      <div className="align-row">
        <IconButton
          icon="align-sel-as-group"
          tooltip="Treat selection as group"
          pressed={asGroup}
          onClick={() => {
            prefs.setBool('/dialogs/align/sel-as-groups', !asGroup);
            setAsGroup(!asGroup);
          }}
        />
        <label className="align-relative">
          {_('Relative to')}
          <select value={align_to} onChange={(e) => onRelativeChanged(e.target.value)}>
            {options.map(([label, id]) => (
              <option key={id} value={id}>
                {_(label)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <fieldset className="align-frame">
        <legend>{_('Align')}</legend>
        <div className="align-grid">
          {ALIGN_BUTTONS.map(([icon, argument, tooltip]) => (
            <IconButton key={icon} icon={icon} tooltip={tooltip} onClick={() => onAlign(argument)} />
          ))}
        </div>
      </fieldset>
      <fieldset className="align-frame">
        <legend>{_('Distribute')}</legend>
        <div className="align-grid distribute">
          {DISTRIBUTE_BUTTONS.map(([icon, argument, tooltip]) => (
            <IconButton
              key={icon}
              icon={icon}
              tooltip={tooltip}
              onClick={() => void runAction(`app.object-distribute('${argument}')`)}
            />
          ))}
        </div>
      </fieldset>
    </div>
  );
}
