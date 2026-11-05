// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-dialogs.cpp
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InkscapeApplication } from '../inkscape-application.ts';
import { type DialogContainer, set_dialog_container } from '../ui/dialog/dialog-container.ts';

const KNOWN = new Set(['Find', 'Preferences', 'Prototype']);

function container() {
  const c: DialogContainer = {
    new_dialog: vi.fn(),
    toggle_dialogs: vi.fn(),
    has_dialog: (key) => KNOWN.has(key),
  };
  set_dialog_container(c);
  return c;
}

afterEach(() => set_dialog_container(null));

describe('dialog actions', () => {
  const app = InkscapeApplication.instance();

  it('win.dialog-open opens a known dialog in the container', () => {
    const c = container();
    expect(app.activate_action("win.dialog-open('Find')")).toBe(true);
    expect(c.new_dialog).toHaveBeenCalledWith('Find');
  });

  it('win.dialog-open is disabled for a dialog that does not exist, and without container', () => {
    const c = container();
    expect(app.activate_action("win.dialog-open('Nope')")).toBe(false);
    expect(c.new_dialog).not.toHaveBeenCalled();
    expect(app.actions.is_enabled("win.dialog-open('Find')")).toBe(true);
    set_dialog_container(null);
    expect(app.actions.is_enabled("win.dialog-open('Find')")).toBe(false);
  });

  it('win.dialog-toggle toggles all dialogs', () => {
    const c = container();
    expect(app.activate_action('win.dialog-toggle')).toBe(true);
    expect(c.toggle_dialogs).toHaveBeenCalledTimes(1);
  });

  it('app.preferences opens the Preferences dialog', () => {
    const c = container();
    expect(app.activate_action('app.preferences')).toBe(true);
    expect(c.new_dialog).toHaveBeenCalledWith('Preferences');
  });

  it('has a label for the Prototype dialog', () => {
    expect(app.get_action_extra_data().get_label_for_action("win.dialog-open('Prototype')")).toBe(
      'Open Prototype',
    );
  });
});
