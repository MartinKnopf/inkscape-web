// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/extension.cpp, src/extension/extension.h
/*
 * Inkscape::Extension::Extension:
 * Frontend to certain, possibly pluggable, actions.
 *
 * Authors:
 *   Ted Gould <ted@gould.cx>
 *
 * Copyright (C) 2002-2005 Authors
 */
import { _, C_, type Colors, type Node } from '@inkscape-web/core';
import type { Implementation } from './implementation/implementation.ts';
import {
  INKSCAPE_EXTENSION_NS,
  type InxParameter,
  InxParameter as InxParameterClass,
  type InxWidget,
  InxWidget as InxWidgetClass,
  make_widget,
  ParamBool,
  ParamColor,
  ParamFloat,
  ParamInt,
  ParamOptionGroup,
  ParamString,
  widget_tag_name,
} from './prefdialog/widget.ts';

export enum ExtensionState {
  STATE_LOADED,
  STATE_UNLOADED,
  STATE_DEACTIVATED,
}

/** A dependency of an extension: the script or file it runs (upstream Dependency, file only). */
export interface Dependency {
  /** "file" for interpreted scripts and XSLT files, "executable" for programs. */
  type: 'file' | 'executable';
  /** The file name, relative to the .inx file. */
  name: string;
  /** The interpreter of a script ("python", "perl", ...), or null. */
  interpreter: string | null;
}

/**
 * The base class of all extensions (upstream Inkscape::Extension::Extension): the id, name,
 * widgets and parameters of an .inx file and its implementation.
 * TODO: dependency checks, translation catalogs other than "inkscape", processing actions.
 */
export class Extension {
  readonly repr: Node;
  readonly imp: Implementation;
  _id = '';
  /** The name (untranslated). */
  _name = '';
  _state = ExtensionState.STATE_UNLOADED;
  readonly _widgets: InxWidget[] = [];
  readonly _deps: Dependency[] = [];
  /** The folder of the .inx file (a URL path in the browser). */
  readonly _base_directory: string;
  _translation_enabled = true;
  _translationdomain: string | null = 'inkscape';
  /** Why the extension failed to load, for the error dialog. */
  _error_reason = '';
  /** Whether the extension shows a dialog (gui="false" turns it off). */
  _gui = true;

  constructor(in_repr: Node, implementation: Implementation, base_directory = '') {
    this.repr = in_repr;
    this.imp = implementation;
    this._base_directory = base_directory;

    // get name of the translation catalog ("gettext textdomain") that the extension wants to use for translations
    const translationdomain = in_repr.attribute('translationdomain');
    if (translationdomain === 'none') {
      // special keyword "none" means the extension author does not want translation of extension strings
      this._translation_enabled = false;
      this._translationdomain = null;
    } else if (translationdomain) this._translationdomain = translationdomain;

    // Read XML tree and parse extension
    for (const child_repr of in_repr.children()) {
      if (child_repr.type() !== 'element') continue;
      const chname = widget_tag_name(child_repr);
      if (chname === 'id') {
        const id = child_repr.firstChild()?.content();
        if (!id) throw new Error('extension_no_id');
        this._id = id;
      } else if (chname === 'name') {
        const name = child_repr.firstChild()?.content();
        if (!name) throw new Error('extension_no_name');
        this._name = name;
      } else if (InxWidgetClass.is_valid_widget_name(chname)) {
        const widget = make_widget(child_repr, this);
        if (widget) this._widgets.push(widget);
      } else if (chname === 'dependency') {
        const name = child_repr.firstChild()?.content();
        if (name)
          this._deps.push({
            type: child_repr.attribute('type') === 'executable' ? 'executable' : 'file',
            name,
            interpreter: null,
          });
      } else if (chname === 'script' || chname === 'xslt') {
        // TODO: should these be parsed in their respective Implementation?
        for (const child of child_repr.children()) {
          if (child.type() !== 'element') continue; // skip non-element nodes (see LP #1372200)
          const interpreted = child.attribute('interpreter');
          const name = child.firstChild()?.content();
          if (name)
            this._deps.push({
              type: interpreted || chname === 'xslt' ? 'file' : 'executable',
              name,
              interpreter: interpreted,
            });
          break;
        }
      }
    }

    // all extensions need an ID and a name
    if (!this._id) throw new Error('extension_no_id');
    if (!this._name) throw new Error('extension_no_name');
    // filter out extensions that are not compatible with the current platform
    if (this._id.includes('win32')) throw new Error('extension_not_compatible');
    if (in_repr.attribute('gui') === 'false') this._gui = false;
  }

  get_id(): string {
    return this._id;
  }
  /** The translated name. */
  get_name(): string {
    return this.get_translation(this._name, null);
  }
  get_repr(): Node {
    return this.repr;
  }
  get_imp(): Implementation {
    return this.imp;
  }
  get_base_directory(): string {
    return this._base_directory;
  }
  getErrorReason(): string {
    return this._error_reason;
  }

  /** Translate msgid with the catalog of the extension (upstream get_translation). */
  get_translation(msgid: string, msgctxt: string | null): string {
    if (!this._translation_enabled) return msgid;
    // TODO: catalogs of other text domains than "inkscape".
    return msgctxt ? C_(msgctxt, msgid) : _(msgid);
  }

  set_state(in_state: ExtensionState): void {
    if (this._state === ExtensionState.STATE_DEACTIVATED) return;
    if (in_state === this._state) return;
    if (in_state === ExtensionState.STATE_LOADED) {
      if (this.imp.load(this)) this._state = ExtensionState.STATE_LOADED;
    } else if (in_state === ExtensionState.STATE_UNLOADED) {
      this.imp.unload(this);
      this._state = ExtensionState.STATE_UNLOADED;
    } else this._state = ExtensionState.STATE_DEACTIVATED;
  }
  get_state(): ExtensionState {
    return this._state;
  }
  loaded(): boolean {
    return this._state === ExtensionState.STATE_LOADED;
  }
  deactivate(): void {
    this.set_state(ExtensionState.STATE_DEACTIVATED);
  }
  deactivated(): boolean {
    return this._state === ExtensionState.STATE_DEACTIVATED;
  }

  /** Whether the extension can run: it has an implementation that accepts it (upstream check). */
  check(): boolean {
    return this.imp.check(this);
  }

  /** The path of a dependency file, relative to the base directory (upstream get_dependency_location). */
  get_dependency_location(name: string): string {
    return name.startsWith('/') ? name : `${this._base_directory}/${name}`;
  }

  /** The top-level widgets. */
  get_widgets(): readonly InxWidget[] {
    return this._widgets;
  }

  /** All parameters, including those in boxes and notebooks. */
  get_params(): InxParameter[] {
    const widget_list: InxWidget[] = [];
    for (const widget of this._widgets) widget.get_widgets(widget_list);
    return widget_list.filter((w): w is InxParameter => w instanceof InxParameterClass);
  }

  /** The parameter with name (upstream get_param); throws if there is none. */
  get_param(name: string): InxParameter {
    const param = this.get_params().find((p) => p.name() === name);
    if (!param) throw new Error(`param_not_exist: ${name}`);
    return param;
  }

  get_param_bool(name: string): boolean {
    return as(this.get_param(name), ParamBool).get();
  }
  get_param_int(name: string): number {
    return as(this.get_param(name), ParamInt).get();
  }
  get_param_float(name: string): number {
    return as(this.get_param(name), ParamFloat).get();
  }
  get_param_string(name: string): string {
    return as(this.get_param(name), ParamString).get();
  }
  get_param_optiongroup(name: string): string {
    return as(this.get_param(name), ParamOptionGroup).get();
  }
  get_param_color(name: string): Colors.Color {
    return as(this.get_param(name), ParamColor).get();
  }
  set_param_bool(name: string, value: boolean): boolean {
    return as(this.get_param(name), ParamBool).set_bool(value);
  }
  set_param_int(name: string, value: number): number {
    return as(this.get_param(name), ParamInt).set_int(value);
  }
  set_param_float(name: string, value: number): number {
    return as(this.get_param(name), ParamFloat).set_float(value);
  }
  set_param_string(name: string, value: string): string {
    return as(this.get_param(name), ParamString).set_string(value);
  }
  set_param_optiongroup(name: string, value: string): string {
    return as(this.get_param(name), ParamOptionGroup).set_optiongroup(value);
  }
  /** Parse value and set the parameter with name (upstream set_param_any). */
  set_param_any(name: string, value: string): void {
    this.get_param(name).set(value);
  }
  set_param_hidden(name: string, hidden: boolean): void {
    this.get_param(name).set_hidden(hidden);
  }

  /**
   * The parameters as command line arguments "--name=value"; empty values are left out
   * (upstream paramListString).
   */
  paramListString(retlist: string[]): void {
    for (const parameter of this.get_params()) {
      const name = parameter.name();
      const value = parameter.value_to_string();
      if (name && value) retlist.push(`--${name}=${value}`); // TODO: Shouldn't empty string values be allowed?
    }
  }

  /** The number of top-level widgets that are shown (upstream widget_visible_count). */
  widget_visible_count(): number {
    return this._widgets.filter((w) => !w.get_hidden()).length;
  }

  /** Whether the extension has a dialog: it has a GUI and visible widgets (upstream autogui). */
  has_gui(): boolean {
    return this._gui && this.widget_visible_count() > 0;
  }
}

function as<T>(param: InxParameter, cls: abstract new (...args: never[]) => T): T {
  if (!(param instanceof cls)) throw new Error(`param_wrong_type: ${param.name()}`);
  return param;
}

export { INKSCAPE_EXTENSION_NS };
