// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/shortcuts.cpp
// Load the keyboard shortcuts file (upstream Shortcuts::init).
import { Preferences } from '@inkscape-web/core';
import { Shortcuts } from '@inkscape-web/editor';

/**
 * Read share/keys/<file> from /options/kbshortcuts/shortcutfile, or else
 * share/keys/inkscape.xml. TODO: the user's keys file.
 */
export async function loadShortcuts(): Promise<void> {
  const shortcuts = Shortcuts.getInstance();
  const read = async (file: string) => {
    const response = await fetch(`/share/keys/${file}`);
    return response.ok && shortcuts.read(await response.text());
  };
  const file = Preferences.get().getString('/options/kbshortcuts/shortcutfile');
  if (file && !file.includes('/') && (await read(file))) return;
  if (!(await read('inkscape.xml')))
    console.error('Shortcut::Shortcut: Failed to read file inkscape.xml; giving up!');
}
