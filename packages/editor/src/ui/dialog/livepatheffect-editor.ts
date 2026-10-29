// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/livepatheffect-editor.cpp, src/ui/dialog/livepatheffect-editor.h
/*
 * Live Path Effect editing dialog - implementation.
 *
 * Authors:
 *   Johan Engelen <j.b.c.engelen@utwente.nl>
 *   Steren Giannini <steren.giannini@gmail.com>
 *   Bastien Bouclet <bgkweb@gmail.com>
 *   Abhishek Sharma
 *   Jabiertxof
 *
 * Copyright (C) 2007 Authors
 */
import {
  _,
  C_,
  can_have_lpe,
  DocumentUndo,
  Effect,
  type EffectType,
  LPECategory,
  LPETypeConverter,
  type Parameter,
  type ParamWidget,
  type PathEffectSharedPtr,
  type PathParam,
  SPFlowtext,
  SPGroup,
  type SPItem,
  SPLine,
  SPLPEItem,
  SPPath,
  SPPolygon,
  SPPolyLine,
  SPShape,
  SPText,
  toCurves,
} from '@inkscape-web/core';
import { set_active_tool } from '../../actions/actions-tools.ts';
import type { SPDesktop } from '../../desktop.ts';
import { ShapeRole } from '../tool/shape-record.ts';
import { NodeTool, sp_update_helperpath } from '../tools/node-tool.ts';

const ICON = 'dialog-path-effects';

/** An effect in the gallery of the dialog (upstream LPEMetadata). */
export interface LPEMetadata {
  type: EffectType;
  category: LPECategory;
  /** Translated label. */
  label: string;
  icon_name: string;
  tooltip: string;
  sensitive: boolean;
  /** Untranslated and translated label and description, for the search. */
  search: string;
}

/** The names of the categories of the gallery (upstream get_category_name). */
export function get_category_name(category: LPECategory): string {
  switch (category) {
    case LPECategory.Favorites:
      return _('Favorites');
    case LPECategory.EditTools:
      return _('Edit/Tools');
    case LPECategory.Distort:
      return _('Distort');
    case LPECategory.Generate:
      return _('Generate');
    case LPECategory.Convert:
      return _('Convert');
    case LPECategory.Experimental:
      return _('Experimental');
    default:
      return '';
  }
}

function get_tooltip(type: EffectType, untranslated_label: string): string {
  let tooltip = _(LPETypeConverter.get_description(type));
  if (tooltip !== untranslated_label) {
    // TRANSLATORS: %1 is the untranslated label. %2 is the effect type description.
    tooltip = `[${untranslated_label}] ${tooltip}`;
  }
  return tooltip;
}

/**
 * The effects that can be applied to item, sorted by category and label (upstream
 * get_list_of_applicable_lpes with can_apply). TODO: favorites, experimental effects.
 */
export function get_list_of_applicable_lpes(item: SPLPEItem | null): LPEMetadata[] {
  const item_type =
    item instanceof SPGroup
      ? 'group'
      : item instanceof SPPath
        ? 'path'
        : item instanceof SPShape
          ? 'shape'
          : '';
  const lpes: LPEMetadata[] = [];
  for (let i = 0; i < LPETypeConverter._length; i++) {
    const data = LPETypeConverter.data(i);
    const type = data.id;
    if (data.experimental) continue;
    const untranslated_label = data.label;
    const label = C_('path effect', untranslated_label);
    const description = _(data.description);
    const sensitive =
      (item_type === 'group' && data.on_group) ||
      (item_type === 'path' && data.on_path) ||
      (item_type === 'shape' && data.on_shape);
    lpes.push({
      type,
      category: data.category,
      label,
      icon_name: data.icon,
      tooltip: get_tooltip(type, untranslated_label),
      sensitive,
      search: `${untranslated_label}_${data.description}_${label}_${description}`.toLowerCase(),
    });
  }
  return lpes.sort((a, b) => a.category - b.category || a.label.localeCompare(b.label));
}

/** The effects whose label or description contains text (the search entry of the gallery). */
export function filter_lpes(lpes: readonly LPEMetadata[], text: string): LPEMetadata[] {
  const t = text.trim().toLowerCase();
  return t ? lpes.filter((lpe) => lpe.search.includes(t)) : [...lpes];
}

/** One row of the effect list. */
export interface LPEListRow {
  lperef: PathEffectSharedPtr;
  effect: Effect | null;
  label: string;
  icon_name: string;
  visible: boolean;
  current: boolean;
  is_first: boolean;
  is_last: boolean;
}

/** What the dialog shows for the selection (upstream selection_info and effect_list_reload). */
export interface LPEEditorState {
  item: SPLPEItem | null;
  /** The message when no item can get effects. */
  info: string | null;
  /** The button that converts the selected object to a path, with its label. */
  convert_label: string | null;
  rows: LPEListRow[];
}

export function lpeEditorState(desktop: SPDesktop): LPEEditorState {
  const selection = desktop.getSelection();
  const selected = selection.singleItem();
  const state: LPEEditorState = { item: null, info: null, convert_label: null, rows: [] };
  if (!selected) {
    state.info =
      selection.size() > 1
        ? _('Select only one path, shape, clone or group')
        : _('Select a path, shape, clone or group');
    return state;
  }
  if (!can_have_lpe(selected)) {
    let info = _('Selected object does not support Live Path Effects');
    let labeltext = _('Convert object to path');
    if (selected instanceof SPText || selected instanceof SPFlowtext) {
      info = _('Text objects do not support Live Path Effects');
      labeltext = _('Convert text to paths');
    } else if (selected instanceof SPPolygon) {
      info = _('Polygon objects do not support Live Path Effects');
      labeltext = _('Convert polygon to path');
    } else if (selected instanceof SPPolyLine) {
      info = _('Polyline objects do not support Live Path Effects');
      labeltext = _('Convert polyline to path');
    } else if (selected instanceof SPLine) {
      info = _('Line objects do not support Live Path Effects');
      labeltext = _('Convert line to path');
    }
    state.info = info;
    state.convert_label = labeltext;
    return state;
  }
  if (!(selected instanceof SPLPEItem)) {
    state.info = _('Select a path, shape, clone or group');
    return state;
  }
  state.item = selected;
  const current = selected.getCurrentLPEReference();
  const list = selected.getEffectList();
  list.forEach((lperef, i) => {
    const effect = lperef.lpeobject?.get_lpe() ?? null;
    const type = lperef.lpeobject?.effecttype;
    state.rows.push({
      lperef,
      effect,
      label: effect ? effect.getName() : _('Unknown effect'),
      icon_name: type !== undefined ? LPETypeConverter.get_icon(type) : '',
      visible: lperef.lpeobject?.getRepr().attribute('is_visible') !== 'false',
      current: lperef === current,
      is_first: i === 0,
      is_last: i === list.length - 1,
    });
  });
  return state;
}

/** Convert the selection to paths (the button for objects that cannot have effects). */
export function convertToPaths(desktop: SPDesktop): void {
  toCurves(desktop.getSelection());
}

/** Reselect item so that the node tool shows the knots of its current effect (upstream). */
function refreshTool(desktop: SPDesktop, item: SPItem | null): void {
  const tool = desktop.getTool();
  if (tool instanceof NodeTool) tool.update_shape_editors();
  else sp_update_helperpath(desktop);
  if (item?.document && !desktop.getSelection().includes(item)) desktop.getSelection().set(item);
}

/** Apply a new effect of type to item (upstream onAdd). */
export function onAdd(desktop: SPDesktop, item: SPLPEItem, etype: EffectType): void {
  const key = LPETypeConverter.get_key(etype);
  Effect.createAndApply(key, desktop.getDocument(), item);
  const lpe = item.getCurrentLPE();
  if (lpe) lpe.refresh_widgets = true;
  DocumentUndo.done(desktop.getDocument(), C_('Undo', 'Create and apply path effect'), ICON);
  refreshTool(desktop, item);
}

/** Make lperef the current effect: its knots are shown (upstream expander activation). */
export function setCurrent(desktop: SPDesktop, item: SPLPEItem, lperef: PathEffectSharedPtr): void {
  item.setCurrentPathEffect(lperef);
  refreshTool(desktop, item);
}

/** Show or hide the effect on canvas (upstream toggleVisible). */
export function toggleVisible(desktop: SPDesktop, item: SPLPEItem, lpe: Effect): void {
  const repr = lpe.getRepr();
  if (!repr) return;
  const visible = repr.attribute('is_visible') !== 'true';
  repr.setAttribute('is_visible', visible ? 'true' : 'false');
  lpe.doOnVisibilityToggled(item);
  DocumentUndo.done(
    desktop.getDocument(),
    !visible ? C_('Undo', 'Deactivate path effect') : C_('Undo', 'Activate path effect'),
    ICON,
  );
  refreshTool(desktop, item);
}

/** Remove the effect (upstream removeEffect). Returns the item, which may be a new object. */
export function removeEffect(
  desktop: SPDesktop,
  item: SPLPEItem,
  lperef: PathEffectSharedPtr,
): SPLPEItem | null {
  item.setCurrentPathEffect(lperef);
  const result = item.removeCurrentPathEffect(false);
  DocumentUndo.done(desktop.getDocument(), C_('Undo', 'Remove path effect'), ICON);
  refreshTool(desktop, result);
  return result;
}

/** Flatten the effects up to lperef into the path (upstream lpeFlatten). */
export function lpeFlatten(
  desktop: SPDesktop,
  item: SPLPEItem,
  lperef: PathEffectSharedPtr,
): SPLPEItem | null {
  item.setCurrentPathEffect(lperef);
  const result = item.flattenCurrentPathEffect();
  const selection = desktop.getSelection();
  if (result && selection.isEmpty()) selection.add(result);
  DocumentUndo.done(desktop.getDocument(), C_('Undo', 'Flatten path effect(s)'), ICON);
  refreshTool(desktop, result);
  return result;
}

type ItemAction = 'duplicate' | 'move-up' | 'move-down';

/** The undoable item actions of the menu of an effect (upstream add_item_actions). */
export function do_item_action_undoable(
  desktop: SPDesktop,
  item: SPLPEItem,
  lperef: PathEffectSharedPtr,
  action: ItemAction,
): void {
  item.setCurrentPathEffect(lperef);
  let description: string;
  switch (action) {
    case 'duplicate':
      item.duplicateCurrentPathEffect();
      description = C_('Undo', 'Duplicate path effect');
      break;
    case 'move-up':
      item.upCurrentPathEffect();
      description = C_('Undo', 'Move path effect up');
      break;
    case 'move-down':
      item.downCurrentPathEffect();
      description = C_('Undo', 'Move path effect down');
      break;
  }
  DocumentUndo.done(desktop.getDocument(), description, ICON);
  refreshTool(desktop, item);
}

/** The widgets of the parameters of an effect (upstream Effect::newWidget). */
export function effectWidgets(lpe: Effect): { param: Parameter | null; widget: ParamWidget }[] {
  return lpe.newWidget();
}

/**
 * Edit a path parameter with the node tool (upstream PathParam::param_editOncanvas).
 */
export function param_editOncanvas(desktop: SPDesktop, param: PathParam, item: SPItem): void {
  const lpe = item instanceof SPLPEItem ? item.getCurrentLPE() : null;
  if (!lpe) return;
  const document = desktop.getDocument();
  if (!(desktop.getTool() instanceof NodeTool)) set_active_tool(desktop, 'Node');
  const nt = desktop.getTool();
  if (!(nt instanceof NodeTool)) return;
  DocumentUndo.scopedInsensitive(document, () => {
    if (param.get_pathvector().length === 0) lpe.getRepr()?.setAttribute(param.param_key, 'M0,0 L1,0');
  });
  nt._multipath.setItems([
    {
      object: lpe.getLPEObj(),
      role: ShapeRole.SHAPE_ROLE_LPE_PARAM,
      lpe_key: param.param_key,
      edit_transform: item.i2dtAffine(), // TODO is it right?
    },
  ]);
}
