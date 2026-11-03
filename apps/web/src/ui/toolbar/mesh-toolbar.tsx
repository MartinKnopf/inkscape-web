// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/toolbar/mesh-toolbar.cpp, src/ui/toolbar/mesh-toolbar.h, share/ui/toolbar-mesh.ui
/*
 * Gradient aux toolbar
 *
 * Authors:
 *   bulia byak <bulia@dr.com>
 *   Johan Engelen <j.b.c.engelen@ewi.utwente.nl>
 *   Abhishek Sharma
 *   Tavmjong Bah <tavmjong@free.fr>
 *   Vaibhav Malik <vaibhavmalik2018@gmail.com>
 *
 * Copyright (C) 2012 Tavmjong Bah
 * Copyright (C) 2007 Johan Engelen
 * Copyright (C) 2005 authors
 */
import {
  _,
  C_,
  DocumentUndo,
  MeshCornerOperation,
  PaintTarget,
  Preferences,
  SPMeshGeometry,
  SPMeshGradient,
  SPMeshType,
} from '@inkscape-web/core';
import { MeshTool, type SPDesktop } from '@inkscape-web/editor';
import { useState } from 'react';
import { SpinButton } from '../widget/spinbutton.tsx';
import { IconButton, usePreferencesUpdates, useSelectionUpdates } from './toolbar.tsx';

/** The meshes of the selection, taking into account the fill/stroke toggles (upstream ms_get_dt_selected_gradients). */
function ms_get_dt_selected_gradients(desktop: SPDesktop): SPMeshGradient[] {
  const prefs = Preferences.get();
  const edit_fill = prefs.getBool('/tools/mesh/edit_fill', true);
  const edit_stroke = prefs.getBool('/tools/mesh/edit_stroke', true);
  const ms_selected: SPMeshGradient[] = [];
  for (const item of desktop.getSelection().items()) {
    const fill = edit_fill && item.style.fill.isPaintserver() ? item.style.getFillPaintServer() : null;
    if (fill instanceof SPMeshGradient) ms_selected.push(fill);
    const stroke =
      edit_stroke && item.style.stroke.isPaintserver() ? item.style.getStrokePaintServer() : null;
    if (stroke instanceof SPMeshGradient) ms_selected.push(stroke);
  }
  return ms_selected;
}

/**
 * Controls of the mesh tool (upstream MeshToolbar): the geometry, target, rows and columns of
 * new meshes; which meshes to edit; handles; side operations; fit; the smoothing type.
 * TODO: pick colors (color_pick), the warning dialog.
 */
export function MeshToolbar({ desktop }: { desktop: SPDesktop }) {
  useSelectionUpdates(desktop);
  usePreferencesUpdates('/tools/mesh/');
  const prefs = Preferences.get();
  const geometry = prefs.getInt('/tools/mesh/mesh_geometry', SPMeshGeometry.SP_MESH_GEOMETRY_NORMAL);
  const newfillorstroke = prefs.getInt('/tools/mesh/newfillorstroke', PaintTarget.FOR_FILL);
  const [rows, setRows] = useState(() => prefs.getDouble('/tools/mesh/mesh_rows', 1));
  const [cols, setCols] = useState(() => prefs.getDouble('/tools/mesh/mesh_cols', 1));
  const edit_fill = prefs.getBool('/tools/mesh/edit_fill', true);
  const edit_stroke = prefs.getBool('/tools/mesh/edit_stroke', true);
  const show_handles = prefs.getBool('/tools/mesh/show_handles', true);
  const tool = desktop.getTool();
  const mt = tool instanceof MeshTool ? tool : null;

  // ms_read_selection
  const meshes = ms_get_dt_selected_gradients(desktop);
  const ms_type = meshes[0]?.type ?? SPMeshType.SP_MESH_TYPE_COONS;
  const ms_type_multi = meshes.some((m) => m.type !== ms_type);

  /** Edit the meshes in the fill or the stroke (upstream toggle_fill_stroke). */
  const toggle_fill_stroke = (path: string, value: boolean) => {
    prefs.setBool(path, value);
    const drag = mt?.get_drag();
    drag?.updateDraggers();
    drag?.updateLines();
  };

  /** Sets mesh type: Coons, Bicubic (upstream type_changed). */
  const type_changed = (mode: SPMeshType) => {
    for (const mesh of meshes) {
      mesh.type = mode;
      mesh.type_set = true;
      mesh.updateRepr();
    }
    if (meshes.length) DocumentUndo.done(desktop.getDocument(), C_('Undo', 'Set mesh type'), 'mesh-gradient');
  };

  return (
    <>
      <b className="toolbar-mode">{_('<b>New:</b>').replace(/<\/?b>/g, '')}</b>
      <IconButton
        icon="paint-gradient-mesh"
        tooltip={_('Create mesh gradient')}
        active={geometry === SPMeshGeometry.SP_MESH_GEOMETRY_NORMAL}
        onClick={() => prefs.setInt('/tools/mesh/mesh_geometry', SPMeshGeometry.SP_MESH_GEOMETRY_NORMAL)}
      />
      <IconButton
        icon="paint-gradient-conical"
        tooltip={_('Create conical gradient')}
        active={geometry === SPMeshGeometry.SP_MESH_GEOMETRY_CONICAL}
        onClick={() => prefs.setInt('/tools/mesh/mesh_geometry', SPMeshGeometry.SP_MESH_GEOMETRY_CONICAL)}
      />
      <IconButton
        icon="object-fill"
        tooltip={_('Create gradient in the fill')}
        active={newfillorstroke === PaintTarget.FOR_FILL}
        onClick={() => prefs.setInt('/tools/mesh/newfillorstroke', PaintTarget.FOR_FILL)}
      />
      <IconButton
        icon="object-stroke"
        tooltip={_('Create gradient in the stroke')}
        active={newfillorstroke === PaintTarget.FOR_STROKE}
        onClick={() => prefs.setInt('/tools/mesh/newfillorstroke', PaintTarget.FOR_STROKE)}
      />
      <SpinButton
        label={_('Rows')}
        tooltip={_('Number of rows in new mesh')}
        value={rows}
        min={1}
        max={20}
        step={1}
        digits={0}
        onChange={(v) => {
          setRows(v);
          prefs.setInt('/tools/mesh/mesh_rows', v);
        }}
      />
      <SpinButton
        label={_('Columns')}
        tooltip={_('Number of columns in new mesh')}
        value={cols}
        min={1}
        max={20}
        step={1}
        digits={0}
        onChange={(v) => {
          setCols(v);
          prefs.setInt('/tools/mesh/mesh_cols', v);
        }}
      />
      <span className="toolbar-separator" />
      <IconButton
        icon="object-fill"
        tooltip={_('Edit fill mesh')}
        active={edit_fill}
        onClick={() => toggle_fill_stroke('/tools/mesh/edit_fill', !edit_fill)}
      />
      <IconButton
        icon="object-stroke"
        tooltip={_('Edit stroke mesh')}
        active={edit_stroke}
        onClick={() => toggle_fill_stroke('/tools/mesh/edit_stroke', !edit_stroke)}
      />
      <IconButton
        icon="show-node-handles"
        tooltip={_('Show handles')}
        active={show_handles}
        onClick={() => {
          prefs.setBool('/tools/mesh/show_handles', !show_handles);
          mt?.get_drag().refreshDraggers();
        }}
      />
      <span className="toolbar-separator" />
      <IconButton
        icon="node-segment-line"
        tooltip={_('Toggle selected sides between Beziers and lines.')}
        onClick={() => mt?.corner_operation(MeshCornerOperation.MG_CORNER_SIDE_TOGGLE)}
      />
      <IconButton
        icon="node-segment-curve"
        tooltip={_(
          'Make selected sides elliptical by changing length of handles. Works best if handles already approximate ellipse.',
        )}
        onClick={() => mt?.corner_operation(MeshCornerOperation.MG_CORNER_SIDE_ARC)}
      />
      <IconButton
        icon="mesh-gradient-fit"
        tooltip={_('Scale mesh to fit inside bounding box.')}
        onClick={() => mt?.fit_mesh_in_bbox()}
      />
      <span className="toolbar-separator" />
      <label
        className="spinbutton"
        title={_('Coons: no smoothing. Bicubic: smoothing across patch boundaries.')}
      >
        {_('Smoothing')}
        <select
          disabled={ms_type_multi}
          value={ms_type}
          onChange={(e) => type_changed(Number(e.target.value) as SPMeshType)}
        >
          <option value={SPMeshType.SP_MESH_TYPE_COONS}>{C_('Type', 'Coons')}</option>
          <option value={SPMeshType.SP_MESH_TYPE_BICUBIC}>{_('Bicubic')}</option>
        </select>
      </label>
    </>
  );
}
