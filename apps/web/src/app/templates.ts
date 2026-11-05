// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/file.cpp, src/io/resource.cpp, src/extension/template.cpp
// The template folder of the web app: the templates of share/templates and the templates that the
// user saved (upstream: the user's template folder). The files are in Template.files, which the
// template extensions read.

import type { SPDocument } from '@inkscape-web/core';
import { sp_file_template_filename, sp_file_template_svg, Template } from '@inkscape-web/editor';
import { indexedDbStore, type KeyValueStore } from './kv-store.ts';

let store: KeyValueStore<string> | null = null;
const userTemplates = (): KeyValueStore<string> => {
  store ??= indexedDbStore<string>('templates');
  return store;
};

/** Replace the store of the user templates (for tests). */
export function setUserTemplateStore(replacement: KeyValueStore<string> | null): void {
  store = replacement;
}

/**
 * Load the template files into Template.files: the bundled ones (named in share/templates/index.json),
 * then the user's, which can replace "default.svg".
 */
export async function load_template_files(): Promise<void> {
  try {
    const index = await fetch('/share/templates/index.json');
    if (index.ok) {
      const names = ((await index.json()) as string[]).filter((n) => !n.startsWith('icons/'));
      await Promise.all(
        names.map(async (name) => {
          const response = await fetch(`/share/templates/${name}`);
          if (response.ok) Template.files.set(name, await response.text());
        }),
      );
    }
  } catch (e) {
    console.warn('Could not load the templates', e);
  }
  try {
    for (const [name, text] of await userTemplates().entries()) Template.files.set(name, text);
  } catch (e) {
    console.warn('Could not load the user templates', e);
  }
}

/**
 * Save the document as a template under name (upstream sp_file_save_template): in the user's
 * templates, and with isDefault as "default.svg", which new documents are based on.
 * Returns false if there is no name.
 */
export async function save_template(
  doc: SPDocument,
  name: string,
  description: string,
  isDefault: boolean,
  author = '',
  keywords = '',
): Promise<boolean> {
  const text = sp_file_template_svg(doc, name, author, description, keywords);
  if (text === null) return false;
  const filename = sp_file_template_filename(name);
  Template.files.set(filename, text);
  await userTemplates().put(filename, text);
  if (isDefault) {
    Template.files.set('default.svg', text);
    await userTemplates().put('default.svg', text);
  }
  return true;
}
