// SPDX-License-Identifier: GPL-2.0-or-later
// The replacement for Gio::SimpleAction and Gio::ActionMap (GLib) that the
// upstream src/actions/*.cpp files register their actions with.
//
// Register an action like upstream does, with the name without prefix:
//
//   const app = InkscapeApplication.instance().actions;
//   app.app.add_action('selection-group', () => ...);                  // app.selection-group
//   app.win.add_action_with_parameter('tool-switch', 's', (t) => ...);  // win.tool-switch('Rect')
//
// Keys come from share/keys/*.xml (ui/shortcuts.ts), menus from
// share/ui/menus.ui (ui/desktop/menubar.ts): both use the detailed action
// name, so a registered action gets its key and menu item automatically.
import { Signal } from '@inkscape-web/core';

/** GVariant type strings of action parameters. */
export type VariantType = 's' | 'i' | 'd' | 'b';
/** The JS value of a parameter of a VariantType. */
export type VariantValue<T extends VariantType> = T extends 's' ? string : T extends 'b' ? boolean : number;
/** A parameter value of any type. */
export type Variant = string | number | boolean;

/** The prefixes of the action groups. */
export type ActionPrefix = 'app' | 'win' | 'doc';

/** A parsed detailed action name: "win.tool-switch('Rect')" → win, tool-switch, 'Rect'. */
export interface DetailedName {
  prefix: string;
  name: string;
  target?: Variant;
}

/** An action: a name, an optional parameter type and an enabled state (upstream Gio::SimpleAction). */
export class SimpleAction {
  readonly name: string;
  readonly parameter_type: VariantType | null;
  readonly #activate: (value: Variant | undefined) => void;
  readonly #accepts: ((value: Variant) => boolean) | null;
  #enabled = true;
  /** Emitted when the enabled state changes. */
  readonly signal_changed = new Signal<[]>();

  /** accepts limits the parameter values (e.g. to the known dialog keys); by default all values of the type. */
  constructor(
    name: string,
    parameter_type: VariantType | null,
    activate: (value: Variant | undefined) => void,
    accepts: ((value: Variant) => boolean) | null = null,
  ) {
    this.name = name;
    this.parameter_type = parameter_type;
    this.#activate = activate;
    this.#accepts = accepts;
  }

  get_enabled(): boolean {
    return this.#enabled;
  }
  set_enabled(enabled: boolean): void {
    if (this.#enabled === enabled) return;
    this.#enabled = enabled;
    this.signal_changed.emit();
  }

  /** Whether value fits the parameter type (undefined for actions without parameter). */
  accepts(value: Variant | undefined): boolean {
    if (value !== undefined && this.#accepts && !this.#accepts(value)) return false;
    switch (this.parameter_type) {
      case null:
        return value === undefined;
      case 's':
        return typeof value === 'string';
      case 'b':
        return typeof value === 'boolean';
      case 'i':
        return Number.isInteger(value);
      case 'd':
        return typeof value === 'number';
    }
  }

  /** Run the action if it is enabled and value fits. Returns whether it ran. */
  activate(value?: Variant): boolean {
    if (!this.#enabled || !this.accepts(value)) return false;
    this.#activate(value);
    return true;
  }
}

/** The actions of one prefix ("app", "win" or "doc"), by name (upstream Gio::ActionMap). */
export class ActionMap {
  readonly prefix: ActionPrefix;
  readonly #actions = new Map<string, SimpleAction>();
  readonly #connections = new Map<string, () => void>();
  /** Emitted when an action is added, removed, enabled or disabled. */
  readonly signal_changed = new Signal<[]>();

  constructor(prefix: ActionPrefix) {
    this.prefix = prefix;
  }

  /** Add an action without parameter. Replaces an action with the same name. */
  add_action(name: string, activate: () => void): SimpleAction {
    return this.#add(new SimpleAction(name, null, () => activate()));
  }

  /**
   * Add an action with a parameter of type (detailed names like
   * "tool-switch('Rect')"). accepts limits the values; menu items and keys
   * with other values are disabled.
   */
  add_action_with_parameter<T extends VariantType>(
    name: string,
    type: T,
    activate: (value: VariantValue<T>) => void,
    accepts?: (value: VariantValue<T>) => boolean,
  ): SimpleAction {
    const check = accepts ? (v: Variant) => accepts(v as VariantValue<T>) : null;
    return this.#add(new SimpleAction(name, type, (v) => activate(v as VariantValue<T>), check));
  }

  remove_action(name: string): void {
    if (!this.#actions.delete(name)) return;
    this.#connections.get(name)?.();
    this.#connections.delete(name);
    this.signal_changed.emit();
  }

  lookup_action(name: string): SimpleAction | null {
    return this.#actions.get(name) ?? null;
  }

  list_actions(): string[] {
    return [...this.#actions.keys()];
  }

  #add(action: SimpleAction): SimpleAction {
    this.remove_action(action.name);
    this.#actions.set(action.name, action);
    this.#connections.set(
      action.name,
      action.signal_changed.connect(() => this.signal_changed.emit()),
    );
    this.signal_changed.emit();
    return action;
  }
}

/**
 * All actions of the application, in the "app", "win" and "doc" maps. Actions
 * are looked up and run by detailed name ("app.selection-group",
 * "win.tool-switch('Rect')", "win.canvas-display-mode(1)").
 */
export class ActionRegistry {
  readonly app = new ActionMap('app');
  readonly win = new ActionMap('win');
  readonly doc = new ActionMap('doc');
  /** Emitted when an action of any map is added, removed, enabled or disabled. */
  readonly signal_changed = new Signal<[]>();

  constructor() {
    for (const map of [this.app, this.win, this.doc])
      map.signal_changed.connect(() => this.signal_changed.emit());
  }

  /** The map of a prefix, or null for other prefixes (e.g. "tool."). */
  map(prefix: string): ActionMap | null {
    return prefix === 'app' ? this.app : prefix === 'win' ? this.win : prefix === 'doc' ? this.doc : null;
  }

  /** The action of a detailed or plain name ("win.tool-switch('Rect')" or "win.tool-switch"). */
  lookup_action(detailed: string): SimpleAction | null {
    const parsed = parse_detailed_name(detailed);
    return parsed ? (this.map(parsed.prefix)?.lookup_action(parsed.name) ?? null) : null;
  }

  /** Whether the action of a detailed name exists, is enabled and takes its target. */
  is_enabled(detailed: string): boolean {
    const parsed = parse_detailed_name(detailed);
    const action = parsed && this.map(parsed.prefix)?.lookup_action(parsed.name);
    return !!action && action.get_enabled() && action.accepts(parsed.target);
  }

  /** Run the action of a detailed name. Returns whether an enabled action ran. */
  activate(detailed: string): boolean {
    const parsed = parse_detailed_name(detailed);
    const action = parsed && this.map(parsed.prefix)?.lookup_action(parsed.name);
    return !!action && action.activate(parsed.target);
  }
}

/**
 * Parse a detailed action name (upstream Gio::Action::parse_detailed_name):
 * "prefix.name", "prefix.name(target)" with a GVariant text target ('str',
 * "str", 12, -1.5, true), or "prefix.name::str". Returns null if malformed.
 */
export function parse_detailed_name(detailed: string): DetailedName | null {
  const m = /^([\w-]+)\.([\w.-]+?)(?:\((.*)\)|::(.*))?$/s.exec(detailed.trim());
  if (!m?.[1] || !m[2]) return null;
  const [, prefix, name, text, str] = m;
  if (str !== undefined) return { prefix, name, target: str };
  if (text === undefined) return { prefix, name };
  const target = parse_variant(text);
  return target === null ? null : { prefix, name, target };
}

/** Parse GVariant text: a quoted string, a boolean or a number. Null if invalid. */
function parse_variant(text: string): Variant | null {
  const t = text.trim();
  const quoted = /^'((?:[^'\\]|\\.)*)'$|^"((?:[^"\\]|\\.)*)"$/s.exec(t);
  if (quoted) return (quoted[1] ?? quoted[2] ?? '').replace(/\\(.)/gs, '$1');
  if (t === 'true' || t === 'false') return t === 'true';
  if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return Number(t);
  return null;
}

/**
 * The canonical detailed name, so that different spellings of the same
 * action and target compare equal ("app.transform-rotate(90.0)" and
 * "app.transform-rotate(90)", "win.dialog-open(\"Export\")" and
 * "win.dialog-open('Export')"). Returns the input if it is malformed.
 */
export function canonical_detailed_name(detailed: string): string {
  const parsed = parse_detailed_name(detailed);
  if (!parsed) return detailed;
  return print_detailed_name(parsed.prefix, parsed.name, parsed.target);
}

/** The detailed name of prefix.name with target, e.g. "win.tool-switch('Rect')". */
export function print_detailed_name(prefix: string, name: string, target?: Variant): string {
  if (target === undefined) return `${prefix}.${name}`;
  const text = typeof target === 'string' ? `'${target.replace(/(['\\])/g, '\\$1')}'` : String(target);
  return `${prefix}.${name}(${text})`;
}
