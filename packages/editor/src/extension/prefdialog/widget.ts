// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/prefdialog/widget.cpp, src/extension/prefdialog/widget.h, src/extension/prefdialog/widget-box.cpp, src/extension/prefdialog/widget-image.cpp, src/extension/prefdialog/widget-label.cpp, src/extension/prefdialog/widget-separator.cpp, src/extension/prefdialog/widget-spacer.cpp, src/extension/prefdialog/parameter.cpp, src/extension/prefdialog/parameter.h, src/extension/prefdialog/parameter-bool.cpp, src/extension/prefdialog/parameter-color.cpp, src/extension/prefdialog/parameter-float.cpp, src/extension/prefdialog/parameter-int.cpp, src/extension/prefdialog/parameter-notebook.cpp, src/extension/prefdialog/parameter-optiongroup.cpp, src/extension/prefdialog/parameter-path.cpp, src/extension/prefdialog/parameter-string.cpp
/*
 * Authors:
 *   Ted Gould <ted@gould.cx>
 *   Johan Engelen <johan@shouraizou.nl>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Christopher Brown <audiere@gmail.com>
 *   Patrick Storz <eduard.braun2@gmx.de>
 *
 * Copyright (C) 2005-2019 Authors
 * Copyright (C) 2006-2007 Johan Engelen
 * Copyright (C) 2008 Jon A. Cruz
 */
// The widgets and parameters of an .inx file. The widget classes of upstream are in one file
// here, because the boxes, notebooks and option groups make their children with make_widget().
// The web dialog (apps/web) draws them; the values live in the preferences
// (/extensions/<extension id>.<parameter name>).

import type { Node } from '@inkscape-web/core';
import { Colors, Preferences } from '@inkscape-web/core';
import type { Extension } from '../extension.ts';

export const INKSCAPE_EXTENSION_URI = 'http://www.inkscape.org/namespace/inkscape/extension';
export const INKSCAPE_EXTENSION_NS_NC = 'extension';
export const INKSCAPE_EXTENSION_NS = 'extension:';

/** The element name without the "extension:" prefix and a leading underscore. */
export function widget_tag_name(repr: Node): string {
  let name = repr.name();
  if (name.startsWith(INKSCAPE_EXTENSION_NS)) name = name.slice(INKSCAPE_EXTENSION_NS.length);
  if (name.startsWith('_')) name = name.slice(1); // allow leading underscore in tag names for backwards-compatibility
  return name;
}

/** The content of the first child (a text node) of repr, or null. */
function first_content(repr: Node): string | null {
  return repr.firstChild()?.content() ?? null;
}

/** C strtol(s, nullptr, 0): decimal, 0x hex or 0 octal; 0 if it does not parse. */
function strtol(s: string): number {
  const m = /^\s*([+-]?)(0x[0-9a-f]+|0[0-7]*|[1-9]\d*)/i.exec(s);
  if (!m?.[2]) return 0;
  const body = m[2];
  const v = /^0x/i.test(body)
    ? Number.parseInt(body, 16)
    : body.startsWith('0')
      ? Number.parseInt(body, 8) || 0
      : Number(body);
  return m[1] === '-' ? -v : v;
}

/** g_ascii_strtod: the leading number of s, or 0. */
function strtod(s: string): number {
  const v = Number.parseFloat(s);
  return Number.isFinite(v) ? v : 0;
}

export enum Translatable {
  UNSET,
  YES,
  NO,
}

/** Base class of the widgets of an extension (upstream InxWidget). */
export class InxWidget {
  /** Indentation of a widget in px per indent level. */
  static readonly GUI_INDENTATION = 12;
  static readonly GUI_BOX_MARGIN = 10;
  static readonly GUI_BOX_SPACING = 4;

  readonly _extension: Extension;
  /** Child widgets of boxes, notebooks and notebook pages. */
  _children: InxWidget[] = [];
  _translatable = Translatable.UNSET;
  /** Context of the translations of the strings. */
  _context: string | null = null;
  /** Whether the widget is not shown in the dialog. */
  _hidden = false;
  /** gui-hidden="true": hidden, but a parameter still gives its value. */
  _gui_hidden = false;
  _indent = 0;
  _appearance: string | null = null;

  constructor(in_repr: Node, ext: Extension) {
    this._extension = ext;
    const translatable = in_repr.attribute('translatable');
    if (translatable === 'yes') this._translatable = Translatable.YES;
    else if (translatable === 'no') this._translatable = Translatable.NO;
    else if (translatable)
      console.warn(
        `Invalid value ('${translatable}') for translatable attribute of widget '${in_repr.name()}' in extension '${ext.get_id()}'`,
      );

    this._context = in_repr.attribute('context') ?? in_repr.attribute('msgctxt'); // backwards-compatibility with previous name
    if (in_repr.attribute('gui-hidden') === 'true') {
      this._gui_hidden = true;
      this._hidden = true;
    }
    const indent = in_repr.attribute('indent');
    if (indent !== null) this._indent = strtol(indent);
    this._appearance = in_repr.attribute('appearance');
  }

  /** Whether name is the tag name of a widget. */
  static is_valid_widget_name(name: string): boolean {
    return ['hbox', 'vbox', 'image', 'label', 'separator', 'spacer', 'param'].includes(name);
  }

  get_hidden(): boolean {
    return this._hidden;
  }
  set_hidden(hidden: boolean): void {
    this._hidden = hidden;
  }
  get_indent(): number {
    return this._indent;
  }
  /** The tooltip of the widget (the gui-description of a parameter). */
  get_tooltip(): string | null {
    return null;
  }

  get_translation(msgid: string): string {
    return this._extension.get_translation(msgid, this._context);
  }

  /** This widget and all its descendants (upstream get_widgets). */
  get_widgets(list: InxWidget[]): void {
    list.push(this);
    for (const child of this._children) child.get_widgets(list);
  }
}

/** Make the widget of an .inx element, or null if it is not valid (upstream InxWidget::make). */
export function make_widget(in_repr: Node, in_ext: Extension): InxWidget | null {
  const name = widget_tag_name(in_repr);
  switch (name) {
    case 'hbox':
    case 'vbox':
      return new WidgetBox(in_repr, in_ext);
    case 'image':
      return new WidgetImage(in_repr, in_ext);
    case 'label':
      return new WidgetLabel(in_repr, in_ext);
    case 'separator':
      return new WidgetSeparator(in_repr, in_ext);
    case 'spacer':
      return new WidgetSpacer(in_repr, in_ext);
    case 'param':
      return make_parameter(in_repr, in_ext);
    default:
      console.warn(`Unknown widget name ('${name}') in extension '${in_ext.get_id()}'`);
      return null;
  }
}

/** The widgets of the element children of repr (boxes and notebook pages). */
function make_children(repr: Node, ext: Extension, what: string): InxWidget[] {
  const list: InxWidget[] = [];
  for (const child_repr of repr.children()) {
    const chname = widget_tag_name(child_repr);
    if (child_repr.type() === 'element' && InxWidget.is_valid_widget_name(chname)) {
      const widget = make_widget(child_repr, ext);
      if (widget) list.push(widget);
    } else if (child_repr.type() === 'element') {
      console.warn(`Invalid child element ('${chname}') in ${what} in extension '${ext.get_id()}'.`);
    }
  }
  return list;
}

/** A horizontal or vertical box of widgets (upstream WidgetBox). */
export class WidgetBox extends InxWidget {
  readonly _orientation: 'horizontal' | 'vertical';

  constructor(xml: Node, ext: Extension) {
    super(xml, ext);
    // Decide orientation based on tagname (hbox vs. vbox)
    this._orientation = widget_tag_name(xml) === 'hbox' ? 'horizontal' : 'vertical';
    // Read XML tree of box and parse child widgets
    this._children = make_children(xml, ext, 'box widget');
  }
}

/** An image (upstream WidgetImage); the path is relative to the .inx file. */
export class WidgetImage extends InxWidget {
  readonly _image_path: string = '';
  readonly _width: number;
  readonly _height: number;

  constructor(xml: Node, ext: Extension) {
    super(xml, ext);
    const content = first_content(xml);
    if (content) {
      // make sure path is absolute (relative paths are relative to .inx file's location)
      this._image_path = content.startsWith('/') ? content : `${ext.get_base_directory()}/${content}`;
    } else console.warn(`Missing path for image widget in extension '${ext.get_id()}'.`);
    this._width = strtol(xml.attribute('width') ?? '0');
    this._height = strtol(xml.attribute('height') ?? '0');
  }
}

export enum LabelMode {
  DEFAULT,
  HEADER,
  URL,
}

/** A text label (upstream WidgetLabel). */
export class WidgetLabel extends InxWidget {
  readonly _value: string;
  readonly _mode: LabelMode = LabelMode.DEFAULT;

  constructor(xml: Node, ext: Extension) {
    super(xml, ext);
    // construct the text content by concatenating all (non-empty) text nodes,
    // removing all other nodes (e.g. comment nodes) and replacing <extension:br> elements with "<br/>"
    let value = '';
    for (const cur_child of xml.children()) {
      if (cur_child.type() === 'text') value += cur_child.content() ?? '';
      else if (cur_child.type() === 'element' && cur_child.name() === 'extension:br') value += '<br/>';
    }
    // do replacements in the source string to account for the attribute xml:space="preserve"
    // (those should match replacements potentially performed by xgettext to allow for proper translation)
    if (xml.attribute('xml:space') !== 'preserve') {
      // remove all whitespace from start/end of string and replace intermediate whitespace with a single space
      value = value.replace(/^\s+|\s+$/g, '').replace(/\s+/g, ' ');
    }
    // translate value
    if (value && this._translatable !== Translatable.NO) value = this.get_translation(value);
    // finally replace all remaining <br/> with a real newline character
    this._value = value.replaceAll('<br/>', '\n');

    if (this._appearance === 'header') this._mode = LabelMode.HEADER;
    else if (this._appearance === 'url') this._mode = LabelMode.URL;
    else if (this._appearance)
      console.warn(
        `Invalid value ('${this._appearance}') for appearance of label widget in extension '${ext.get_id()}'`,
      );
  }
}

/** A separator line (upstream WidgetSeparator). */
export class WidgetSeparator extends InxWidget {}

/** Empty space (upstream WidgetSpacer). */
export class WidgetSpacer extends InxWidget {
  readonly _size: number = 10;
  readonly _expand: boolean = false;

  constructor(xml: Node, ext: Extension) {
    super(xml, ext);
    const size = xml.attribute('size');
    if (size) {
      this._size = strtol(size);
      if (this._size === 0) {
        if (size === 'expand') this._expand = true;
        else console.warn(`Invalid value ('${size}') for size spacer in extension '${ext.get_id()}'`);
      }
    }
  }
}

/** A parameter: a widget with a value that is given to the extension (upstream InxParameter). */
export class InxParameter extends InxWidget {
  /** The name of the parameter (--name=value). */
  readonly _name: string;
  /** The label in the dialog (translated). */
  readonly _text: string | null = null;
  /** The tooltip (translated). */
  readonly _description: string | null = null;

  constructor(in_repr: Node, ext: Extension) {
    super(in_repr, ext);
    const name = in_repr.attribute('name')?.trim();
    if (!name) {
      console.warn(`Parameter without name in extension '${ext.get_id()}'.`);
      throw new Error('param_no_name');
    }
    this._name = name;

    let gui_text = in_repr.attribute('gui-text') ?? in_repr.attribute('_gui-text'); // backwards-compatibility with underscored variants
    if (gui_text !== null) {
      if (this._translatable !== Translatable.NO) gui_text = this.get_translation(gui_text); // translate unless explicitly marked untranslatable
      this._text = gui_text;
    }
    if (this._text === null && !this._hidden) {
      console.warn(
        `Parameter '${name}' in extension '${ext.get_id()}' is visible but does not have a 'gui-text'.`,
      );
      throw new Error('param_no_text');
    }
    let gui_description = in_repr.attribute('gui-description') ?? in_repr.attribute('_gui-description');
    if (gui_description !== null) {
      if (this._translatable !== Translatable.NO) gui_description = this.get_translation(gui_description);
      this._description = gui_description;
    }
  }

  name(): string {
    return this._name;
  }
  get_text(): string | null {
    return this._text;
  }
  override get_tooltip(): string | null {
    return this._description;
  }

  /** The preference path of the value: /extensions/<extension id>.<name>. */
  pref_name(): string {
    return `/extensions/${this._extension.get_id()}.${this._name}`;
  }

  /** The value as the string that is given to the extension. */
  value_to_string(): string {
    return '';
  }
  string_to_value(_in: string): void {}

  /** Set the value from a string and store it in the preferences. */
  set(value: string): string {
    this.string_to_value(value);
    Preferences.get().setString(this.pref_name(), this.value_to_string());
    return value;
  }
}

/** Make the parameter of a <param> element by its type (upstream InxParameter::make). */
export function make_parameter(in_repr: Node, in_ext: Extension): InxParameter | null {
  try {
    const type = in_repr.attribute('type');
    switch (type) {
      case null:
        console.warn(`Parameter without type in extension '${in_ext.get_id()}'.`);
        return null;
      case 'bool':
      case 'boolean': // support "boolean" for backwards-compatibility
        return new ParamBool(in_repr, in_ext);
      case 'int':
        return new ParamInt(in_repr, in_ext);
      case 'float':
        return new ParamFloat(in_repr, in_ext);
      case 'string':
        return new ParamString(in_repr, in_ext);
      case 'path':
        return new ParamPath(in_repr, in_ext);
      case 'description':
        in_repr.setAttribute('gui-text', 'description'); // TODO: hack to allow descriptions to be parameters
        return new ParamDescription(in_repr, in_ext);
      case 'notebook':
        in_repr.setAttribute('gui-text', 'notebook'); // notebooks have no 'gui-text' (but Parameters need one)
        return new ParamNotebook(in_repr, in_ext);
      case 'optiongroup':
        return new ParamOptionGroup(in_repr, in_ext);
      case 'enum': // support deprecated "enum" for backwards-compatibility
        in_repr.setAttribute('appearance', 'combo');
        return new ParamOptionGroup(in_repr, in_ext);
      case 'color':
        return new ParamColor(in_repr, in_ext);
      default:
        console.warn(`Unknown parameter type ('${type}') in extension '${in_ext.get_id()}'`);
        return null;
    }
  } catch {
    // param_no_name, param_no_text
    return null;
  }
}

/** A deprecated parameter of type "description": a label (upstream ParamDescription). */
export class ParamDescription extends InxParameter {
  readonly label: WidgetLabel;
  constructor(xml: Node, ext: Extension) {
    super(xml, ext);
    this.label = new WidgetLabel(xml, ext);
  }
}

/** A check box (upstream ParamBool). */
export class ParamBool extends InxParameter {
  _value = true;

  constructor(xml: Node, ext: Extension) {
    super(xml, ext);
    const value = first_content(xml);
    if (value) this.string_to_value(value);
    this._value = Preferences.get().getBool(this.pref_name(), this._value);
  }
  get(): boolean {
    return this._value;
  }
  set_bool(in_: boolean): boolean {
    this._value = in_;
    Preferences.get().setBool(this.pref_name(), this._value);
    return this._value;
  }
  override value_to_string(): string {
    return this._value ? 'true' : 'false';
  }
  override string_to_value(in_: string): void {
    if (in_ === 'true') this._value = true;
    else if (in_ === 'false') this._value = false;
    else
      console.warn(
        `Invalid default value ('${in_}') for parameter '${this._name}' in extension '${this._extension.get_id()}'`,
      );
  }
}

/** A number field, or a slider with appearance="full" (upstream ParamInt). */
export class ParamInt extends InxParameter {
  _value = 0;
  readonly _min: number = 0;
  readonly _max: number = 10;
  readonly _full: boolean = false;

  constructor(xml: Node, ext: Extension) {
    super(xml, ext);
    const value = first_content(xml);
    if (value) this.string_to_value(value);
    this._value = Preferences.get().getInt(this.pref_name(), this._value);
    const min = xml.attribute('min');
    if (min) this._min = strtol(min);
    const max = xml.attribute('max');
    if (max) this._max = strtol(max);
    this._value = Math.min(Math.max(this._value, this._min), this._max);
    if (this._appearance === 'full') this._full = true;
    else if (this._appearance)
      console.warn(`Invalid value ('${this._appearance}') for appearance of parameter '${this._name}'`);
  }
  get(): number {
    return this._value;
  }
  set_int(in_: number): number {
    this._value = Math.trunc(in_);
    Preferences.get().setInt(this.pref_name(), this._value);
    return this._value;
  }
  override value_to_string(): string {
    return String(this._value);
  }
  override string_to_value(in_: string): void {
    this._value = strtol(in_);
  }
}

/** A number field with precision, or a slider with appearance="full" (upstream ParamFloat). */
export class ParamFloat extends InxParameter {
  _value = 0;
  readonly _min: number = 0;
  readonly _max: number = 10;
  readonly _precision: number = 1;
  readonly _full: boolean = false;

  constructor(xml: Node, ext: Extension) {
    super(xml, ext);
    const value = first_content(xml);
    if (value) this.string_to_value(value);
    this._value = Preferences.get().getDouble(this.pref_name(), this._value);
    const min = xml.attribute('min');
    if (min) this._min = strtod(min);
    const max = xml.attribute('max');
    if (max) this._max = strtod(max);
    this._value = Math.min(Math.max(this._value, this._min), this._max);
    const precision = xml.attribute('precision');
    if (precision !== null) this._precision = strtol(precision);
    if (this._appearance === 'full') this._full = true;
    else if (this._appearance)
      console.warn(`Invalid value ('${this._appearance}') for appearance of parameter '${this._name}'`);
  }
  get(): number {
    return this._value;
  }
  set_float(in_: number): number {
    this._value = in_;
    Preferences.get().setDouble(this.pref_name(), this._value);
    return this._value;
  }
  override value_to_string(): string {
    return this._value.toFixed(Math.max(0, this._precision));
  }
  override string_to_value(in_: string): void {
    this._value = strtod(in_);
  }
}

/** A text entry, or a text area with appearance="multiline" (upstream ParamString). */
export class ParamString extends InxParameter {
  _value = '';
  readonly _max_length: number = 0;
  readonly _multiline: boolean = false;

  constructor(xml: Node, ext: Extension) {
    super(xml, ext);
    const value = first_content(xml);
    this._value = Preferences.get().getString(this.pref_name());
    if (!this._value && value) this._value = value;
    // translate only if explicitly marked translatable
    if (this._value && this._translatable === Translatable.YES)
      this._value = this.get_translation(this._value);
    const max_length = xml.attribute('max-length') ?? xml.attribute('max_length'); // backwards-compatibility with old name (underscore)
    if (max_length) this._max_length = strtol(max_length);
    if (this._appearance === 'multiline') this._multiline = true;
    else if (this._appearance)
      console.warn(`Invalid value ('${this._appearance}') for appearance of parameter '${this._name}'`);
  }
  get(): string {
    return this._value;
  }
  set_string(in_: string): string {
    this._value = in_;
    Preferences.get().setString(this.pref_name(), this._value);
    return this._value;
  }
  override value_to_string(): string {
    return this._value;
  }
  override string_to_value(in_: string): void {
    this._value = in_;
  }
}

/** A path to a file or folder (upstream ParamPath). */
export class ParamPath extends InxParameter {
  _value = '';
  readonly _mode: 'file' | 'folder' | 'file_new' | 'folder_new' = 'file';
  readonly _select_multiple: boolean = false;
  readonly _filetypes: readonly string[] = [];

  constructor(xml: Node, ext: Extension) {
    super(xml, ext);
    const value = first_content(xml);
    this._value = Preferences.get().getString(this.pref_name());
    if (!this._value && value) this._value = value;
    const mode = xml.attribute('mode');
    if (mode === 'file' || mode === 'folder' || mode === 'file_new' || mode === 'folder_new')
      this._mode = mode;
    else if (mode === 'files' || mode === 'folders') {
      this._mode = mode === 'files' ? 'file' : 'folder';
      this._select_multiple = true;
    } else if (mode) console.warn(`Invalid value ('${mode}') for mode of parameter '${this._name}'`);
    const filetypes = xml.attribute('filetypes');
    if (filetypes) this._filetypes = filetypes.split(',');
  }
  get(): string {
    return this._value;
  }
  set_path(in_: string): string {
    this._value = in_;
    Preferences.get().setString(this.pref_name(), this._value);
    return this._value;
  }
  override value_to_string(): string {
    if (!this._value.startsWith('/') && this._value)
      return `${this._extension.get_base_directory()}/${this._value}`;
    return this._value;
  }
  override string_to_value(in_: string): void {
    this._value = in_;
  }
}

/** A choice of an option group (upstream ParamOptionGroupOption). */
export interface OptionGroupOption {
  /** The label (translated). */
  _text: string;
  _value: string;
  _is_default: boolean;
}

/** Radio buttons, or a combo box with appearance="combo" (upstream ParamOptionGroup). */
export class ParamOptionGroup extends InxParameter {
  _value = '';
  readonly choices: OptionGroupOption[] = [];
  readonly _mode: 'radio' | 'combo' = 'radio';

  constructor(xml: Node, ext: Extension) {
    super(xml, ext);
    // Read valid optiongroup choices from XML tree, i,e.
    //   - <option> elements
    //   - <item> elements (for backwards-compatibility with params of type enum)
    //   - underscored variants of both (for backwards-compatibility)
    for (const child_repr of xml.children()) {
      const chname = child_repr.name();
      if (['extension:option', 'extension:_option', 'extension:item', 'extension:_item'].includes(chname)) {
        // get content (=label) of option and translate it
        const text = first_content(child_repr);
        const translatable = child_repr.attribute('translatable');
        const label =
          text && translatable !== 'no' && this._translatable !== Translatable.NO
            ? this.get_translation(text)
            : text;
        let value = child_repr.attribute('value');
        if (value === null && text !== null) {
          // use untranslated UI text as value for <item>s (backwards-compatibility), the translated one otherwise
          value = chname.endsWith('item') ? text : (label ?? text);
        }
        this.choices.push({
          _text: label ?? '',
          _value: value ?? '',
          _is_default: child_repr.attribute('default') === 'true',
        });
      } else if (child_repr.type() === 'element') {
        console.warn(
          `Invalid child element ('${chname}') for parameter '${this._name}' in extension '${ext.get_id()}'. Expected 'option'.`,
        );
      }
    }
    if (!this.choices.length)
      console.warn(`No (valid) choices for parameter '${this._name}' in extension '${ext.get_id()}'`);

    // get value (initialize with value of first choice if pref is empty)
    this._value = Preferences.get().getString(this.pref_name());
    if (!this._value) {
      this._value = this.choices[0]?._value ?? '';
      const def = this.choices.find((c) => c._is_default);
      if (def) this._value = def._value;
    }
    // parse appearance
    // (we support "combo" and "radio"; "minimal" is for backwards-compatibility)
    if (this._appearance === 'combo' || this._appearance === 'minimal') this._mode = 'combo';
    else if (this._appearance && this._appearance !== 'radio')
      console.warn(`Invalid value ('${this._appearance}') for appearance of parameter '${this._name}'`);
  }
  get(): string {
    return this._value;
  }
  contains(text: string): boolean {
    return this.choices.some((c) => c._value === text);
  }
  set_optiongroup(in_: string): string {
    if (this.contains(in_)) {
      this._value = in_;
      Preferences.get().setString(this.pref_name(), this._value);
    } else console.warn(`Could not set value ('${in_}') for parameter '${this._name}'. Not a valid choice.`);
    return this._value;
  }
  override value_to_string(): string {
    return this._value;
  }
  override string_to_value(in_: string): void {
    this._value = in_;
  }
}

/** A page of a notebook (upstream ParamNotebookPage). */
export class ParamNotebookPage extends InxParameter {
  constructor(xml: Node, ext: Extension) {
    super(xml, ext);
    // Read XML tree of page and parse parameters
    this._children = make_children(xml, ext, 'notebook page');
  }
}

/** Tabs; the value is the name of the current page (upstream ParamNotebook). */
export class ParamNotebook extends InxParameter {
  _value = '';

  constructor(xml: Node, ext: Extension) {
    super(xml, ext);
    // Read XML tree to add pages (allow _page for backwards compatibility)
    for (const child_repr of xml.children()) {
      const chname = child_repr.name();
      if (chname === 'extension:page' || chname === 'extension:_page') {
        try {
          this._children.push(new ParamNotebookPage(child_repr, ext));
        } catch {
          // a page without name or text
        }
      } else if (child_repr.type() === 'element') {
        console.warn(
          `Invalid child element ('${chname}') for parameter '${this._name}' in extension '${ext.get_id()}'. Expected 'page'.`,
        );
      }
    }
    if (!this._children.length)
      console.warn(`No (valid) pages for parameter '${this._name}' in extension '${ext.get_id()}'`);
    // get value (initialize with value of first page if pref is empty)
    this._value = Preferences.get().getString(this.pref_name());
    if (!this._value) this._value = (this._children[0] as ParamNotebookPage | undefined)?._name ?? '';
  }
  pages(): ParamNotebookPage[] {
    return this._children as ParamNotebookPage[];
  }
  get(): string {
    return this._value;
  }
  /** Set the current page by its index. */
  set_page(in_: number): string {
    const page = this.pages()[Math.min(in_, this._children.length - 1)];
    if (page) {
      this._value = page._name;
      Preferences.get().setString(this.pref_name(), this._value);
    }
    return this._value;
  }
  override value_to_string(): string {
    return this._value;
  }
  override string_to_value(in_: string): void {
    this._value = in_;
  }
}

/** A color picker (upstream ParamColor). The value is an RGBA color. */
export class ParamColor extends InxParameter {
  _value: Colors.Color | null = null;

  constructor(xml: Node, ext: Extension) {
    super(xml, ext);
    const content = first_content(xml);
    if (content) this._value = Colors.Color.parse(content) ?? null;
    if (!this._value) this._value = Colors.Color.parse(Preferences.get().getString(this.pref_name())) ?? null;
  }
  get(): Colors.Color {
    return this._value ?? (Colors.Color.parse('#000000ff') as Colors.Color);
  }
  set_color(color: Colors.Color): void {
    this._value = color;
    Preferences.get().setString(this.pref_name(), this.value_to_string());
  }
  override value_to_string(): string {
    return this.get().toString(true);
  }
  override string_to_value(in_: string): void {
    // Parse color. If parsing fails, return black.
    this._value = Colors.Color.parse(in_) ?? (Colors.Color.parse('#000000ff') as Colors.Color);
  }
}
