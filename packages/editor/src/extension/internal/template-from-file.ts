// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/internal/template-from-file.cpp, src/extension/internal/template-from-file.h
/*
 * Authors:
 *   Martin Owens <doctormo@geek-2.com>
 *
 * Copyright (C) 2022 Authors
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { N_, NC_, type Node, readMem, SPDocument, SVG_NS_URI, sp_repr_lookup_name } from '@inkscape-web/core';
import { Implementation } from '../implementation/implementation.ts';
import { INKSCAPE_EXTENSION_URI } from '../prefdialog/widget.ts';
import { build_from_mem } from '../system.ts';
import { sp_repr_lookup_content, Template, TemplatePreset, TemplateVisibility } from '../template.ts';

/** A file based template preset (upstream TemplatePresetFile). */
export class TemplatePresetFile extends TemplatePreset {
  constructor(mod: Template, filename: string) {
    super(mod, null);
    this._visibility = TemplateVisibility.TEMPLATE_NEW_ICON; // No searching

    // TODO: Add cache here.
    this._prefs.set('filename', filename);
    this._name = filename.slice(filename.lastIndexOf('/') + 1).replaceAll('_', '-');
    const dot = this._name.lastIndexOf('.svg');
    if (dot >= 0) this._name = `${this._name.slice(0, dot)} ${this._name.slice(dot + 4)}`;

    // Key is just the whole filename, it's unique enough.
    this._key = filename.replaceAll('/', '.').replaceAll('\\', '.');

    const text = Template.files.get(filename);
    const rdoc = text ? readMem(text, SVG_NS_URI) : null;
    const root = rdoc?.root();
    if (root && root.name() === 'svg:svg') {
      const templateinfo =
        sp_repr_lookup_name(root, 'inkscape:templateinfo') ??
        sp_repr_lookup_name(root, 'inkscape:_templateinfo'); // backwards-compatibility
      if (templateinfo) this._load_data(templateinfo);
    }
  }

  _load_data(root: Node): void {
    this._name = sp_repr_lookup_content(root, 'inkscape:name', this._name);
    this._name = sp_repr_lookup_content(root, 'inkscape:_name', this._name); // backwards-compatibility
    this._desc = sp_repr_lookup_content(root, 'inkscape:shortdesc', this._key);
    this._desc = sp_repr_lookup_content(root, 'inkscape:_shortdesc', this._desc); // backwards-compatibility

    this._label = sp_repr_lookup_content(root, 'inkscape:label', N_('Custom Template'));
    this._icon = sp_repr_lookup_content(root, 'inkscape:icon', this._icon);
    this._category = sp_repr_lookup_content(root, 'inkscape:category', this._category);

    const priority = Number.parseInt(sp_repr_lookup_content(root, 'inkscape:priority', '-1'), 10);
    if (Number.isNaN(priority)) {
      console.warn('Template priority malformed number.');
      this._priority = -1;
    } else {
      this._priority = priority;
    }
  }
}

/** The templates that are files of the template folder, as one preset each (upstream TemplateFromFile). */
export class TemplateFromFile extends Implementation {
  override check(): boolean {
    return true;
  }

  override async new_from_template(tmod: Template): Promise<SPDocument | null> {
    let filename = '';
    try {
      filename = tmod.get_param_string('filename');
    } catch {
      // no file
    }
    const text = Template.files.get(filename);
    if (text !== undefined) return SPDocument.createNewDocFromMem(text);
    // Default template
    console.error("Couldn't load filename I expected to exist.");
    return tmod.get_template_document();
  }

  static init(): void {
    build_from_mem(
      `<inkscape-extension xmlns="${INKSCAPE_EXTENSION_URI}">` +
        '<id>org.inkscape.template.from-file</id>' +
        `<name>${N_('Load from User File')}</name>` +
        `<description>${N_('Custom list of templates for a folder')}</description>` +
        `<category>${NC_('TemplateCategory', 'Custom')}</category>` +
        `<param name='filename' gui-text='${N_('Filename')}' type='string'></param>` +
        "<template icon='custom' priority='-1' visibility='both'>" +
        // Auto & lazy generated content (see function)
        '</template>' +
        '</inkscape-extension>',
      new TemplateFromFile(),
    );
  }

  /**
   * Generate a list of available files as selectable presets: the SVG files of the template
   * folder except the default templates and the icons.
   */
  override get_template_presets(tmod: Template, presets: TemplatePreset[]): void {
    const names = [...Template.files.keys()]
      .filter((name) => name.endsWith('.svg') && !name.includes('default') && !name.includes('icons'))
      .sort();
    for (const filename of names) presets.push(new TemplatePresetFile(tmod, filename));
  }
}
