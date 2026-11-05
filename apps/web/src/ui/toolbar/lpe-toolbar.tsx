// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/toolbar/lpe-toolbar.cpp, src/ui/toolbar/lpe-toolbar.h, share/ui/toolbar-lpe.ui
/*
 * LPE toolbar
 *
 * Authors:
 *   MenTaLguY <mental@rydia.net>
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   bulia byak <buliabyak@users.sf.net>
 *   Frank Felfe <innerspace@iname.com>
 *   John Cliff <simarilius@yahoo.com>
 *   David Turner <novalis@gnu.org>
 *   Josh Andler <scislac@scislac.com>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Maximilian Albert <maximilian.albert@gmail.com>
 *   Tavmjong Bah <tavmjong@free.fr>
 *   Abhishek Sharma
 *   Kris De Gussem <Kris.DeGussem@gmail.com>
 *   Vaibhav Malik <vaibhavmalik2018@gmail.com>
 *
 * Copyright (C) 2004 David Turner
 * Copyright (C) 2003 MenTaLguY
 * Copyright (C) 1999-2011 authors
 * Copyright (C) 2001-2002 Ximian, Inc.
 */
import {
  _,
  DocumentUndo,
  EffectType,
  type Parameter,
  Preferences,
  SPLPEItem,
  sp_lpe_item_update_patheffect,
} from '@inkscape-web/core';
import {
  LpeTool,
  lpesubtools,
  lpetool_item_has_construction,
  lpetool_try_construction,
  lpetool_type_is_available,
  PAGE_UNITS,
  type SPDesktop,
} from '@inkscape-web/editor';
import { runAction } from '../../app/actions.ts';
import { IconButton, usePreferencesUpdates, useSelectionUpdates } from './toolbar.tsx';

/** The tooltips of the mode buttons of toolbar-lpe.ui, in the order of lpesubtools. */
const MODE_TOOLTIPS = [
  'No geometric tool is active',
  'Line Segment',
  'Circle by 3 points',
  'Circle',
  'Parallel',
  'Perpendicular bisector',
  'Angle Bisector',
  'Mirror symmetry',
] as const;

/** The end types of the Line Segment effect (EndTypeData of lpe-line_segment.cpp). */
const LINE_SEGMENT_TYPES = [
  ['closed', 'Closed'],
  ['open_start', 'Open start'],
  ['open_end', 'Open end'],
  ['open_both', 'Open both'],
] as const;

function lpe_tool(desktop: SPDesktop): LpeTool | null {
  const tool = desktop.getTool();
  return tool instanceof LpeTool ? tool : null;
}

/**
 * A mode button was pressed: apply a construction without clicks to the selected path at once
 * (and go back to inactive), or switch to the subtool (upstream mode_changed).
 */
export function mode_changed(desktop: SPDesktop, mode: number): void {
  const lc = lpe_tool(desktop);
  const type = lpesubtools[mode]?.type;
  if (!lc || type === undefined || !lpetool_type_is_available(type)) return;

  if (lpetool_try_construction(desktop, type)) {
    // since the construction was already performed, we set the state back to inactive
    mode = 0;
    lc.lpe_mode = EffectType.INVALID_LPE;
  } else {
    // switch to the chosen subtool
    lc.lpe_mode = type;
  }

  if (DocumentUndo.getUndoSensitive(desktop.getDocument())) {
    Preferences.get().setInt('/tools/lpetool/mode', mode);
  }
}

/** Set the limiting bounding box to the visual bounds of the selection (upstream toggle_set_bbox). */
export function toggle_set_bbox(desktop: SPDesktop): void {
  const bbox = desktop.getSelection().visualBounds();
  if (!bbox) return;
  const A = bbox.min().transformed(desktop.doc2dt());
  const B = bbox.max().transformed(desktop.doc2dt());
  // TODO: should we provide a way to store points in prefs?
  const prefs = Preferences.get();
  prefs.setDouble('/tools/lpetool/bbox_upperleftx', A.x);
  prefs.setDouble('/tools/lpetool/bbox_upperlefty', A.y);
  prefs.setDouble('/tools/lpetool/bbox_lowerrightx', B.x);
  prefs.setDouble('/tools/lpetool/bbox_lowerrighty', B.y);
  lpe_tool(desktop)?.reset_limiting_bbox();
}

/** The selected item with a Line Segment construction, and its end type parameter. */
function line_segment_of(desktop: SPDesktop): { item: SPLPEItem; end_type: Parameter } | null {
  const item = desktop.getSelection().singleItem();
  if (!(item instanceof SPLPEItem) || lpetool_item_has_construction(item) < 0) return null;
  const lpe = item.getCurrentLPE();
  if (lpe?.effectType() !== EffectType.LINE_SEGMENT) return null;
  const end_type = lpe.param_vector.find((p) => p.param_key === 'end_type');
  return end_type ? { item, end_type } : null;
}

/** Set the end type of the selected line segment (upstream change_line_segment_type). */
export function change_line_segment_type(desktop: SPDesktop, mode: number): void {
  const found = line_segment_of(desktop);
  const key = LINE_SEGMENT_TYPES[mode]?.[0];
  if (!found || !key) return;
  found.end_type.param_readSVGValue(key);
  found.end_type.write_to_SVG();
  sp_lpe_item_update_patheffect(found.item, true, true);
}

/**
 * Controls of the LPE tool: the construction subtools (disabled while their path effect is
 * not ported), the limiting bounding box, the end type of a selected line segment, the
 * measuring info and its unit, and the Path Effects dialog.
 */
export function LPEToolbar({ desktop }: { desktop: SPDesktop }) {
  usePreferencesUpdates('/tools/lpetool/');
  useSelectionUpdates(desktop);
  const prefs = Preferences.get();
  const mode = prefs.getInt('/tools/lpetool/mode', 0);
  const show_bbox = prefs.getBool('/tools/lpetool/show_bbox', true);
  const measuring = prefs.getBool('/tools/lpetool/show_measuring_info', true);
  const unit = prefs.getString('/tools/lpetool/unit') || 'px';
  const line_segment = line_segment_of(desktop);
  const line_type = line_segment
    ? LINE_SEGMENT_TYPES.findIndex(([key]) => key === line_segment.end_type.param_getSVGValue())
    : 0;

  return (
    <>
      {lpesubtools.map((subtool, i) => (
        <IconButton
          key={subtool.icon_name}
          icon={subtool.icon_name}
          tooltip={_(MODE_TOOLTIPS[i] ?? '')}
          active={mode === i}
          disabled={!lpetool_type_is_available(subtool.type)}
          onClick={() => mode_changed(desktop, i)}
        />
      ))}
      <span className="toolbar-separator" />
      <IconButton
        icon="show-bounding-box"
        tooltip={_('Show bounding box (used to cut infinite lines)')}
        active={show_bbox}
        onClick={() => {
          prefs.setBool('/tools/lpetool/show_bbox', !show_bbox);
          lpe_tool(desktop)?.reset_limiting_bbox();
        }}
      />
      <IconButton
        icon="draw-geometry-set-bounding-box"
        tooltip={_(
          'Set limiting bounding box (used to cut infinite lines) to the bounding box of current selection',
        )}
        onClick={() => toggle_set_bbox(desktop)}
      />
      <span className="toolbar-separator" />
      <select
        title={_('Choose a line segment type')}
        disabled={!line_segment}
        value={Math.max(line_type, 0)}
        onChange={(e) => change_line_segment_type(desktop, Number(e.target.value))}
      >
        {LINE_SEGMENT_TYPES.map(([key, label], i) => (
          <option key={key} value={i}>
            {_(label)}
          </option>
        ))}
      </select>
      <span className="toolbar-separator" />
      <IconButton
        icon="draw-geometry-show-measuring-info"
        tooltip={_('Display measuring info for selected items')}
        active={measuring}
        onClick={() => {
          prefs.setBool('/tools/lpetool/show_measuring_info', !measuring);
          lpe_tool(desktop)?.show_measuring_info(!measuring);
        }}
      />
      <select
        disabled={!measuring}
        value={unit}
        onChange={(e) => {
          prefs.setString('/tools/lpetool/unit', e.target.value);
          const lc = lpe_tool(desktop);
          lc?.delete_measuring_items();
          lc?.create_measuring_items();
        }}
      >
        {PAGE_UNITS.map((u) => (
          <option key={u} value={u}>
            {u}
          </option>
        ))}
      </select>
      <span className="toolbar-separator" />
      <IconButton
        icon="dialog-geometry"
        tooltip={_('Open LPE dialog (to adapt parameters numerically)')}
        onClick={() => runAction("win.dialog-open('LivePathEffect')")}
      />
    </>
  );
}
