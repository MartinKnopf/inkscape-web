// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/save-template-dialog.cpp, src/ui/dialog/save-template-dialog.h
/*
 * The Save as Template dialog (action win.document-save-template): the custom templates to
 * overwrite, or a name for a new one, a description, and whether every new document is based
 * on the template.
 *
 * Authors:
 *   Michael Kowalski
 *
 * Copyright (C) 2022 Authors
 */
import { _, Signal, type SPDocument } from '@inkscape-web/core';
import { NEW_TEMPLATE_KEY, TemplateList, TemplateVisibility } from '@inkscape-web/editor';
import { useState, useSyncExternalStore } from 'react';
import { save_template } from '../../app/templates.ts';
import './new-from-template.css';

/** A GTK label without the mnemonic marker. */
const label = (s: string) => s.replace('_', '');

let pending: { doc: SPDocument; list: TemplateList; done: () => void } | null = null;
const changed = new Signal<[]>();

/**
 * Show the dialog for the document and save it as a template if the user wants it (upstream
 * SaveTemplate::save_document_as_template). Resolves when the dialog is closed.
 */
export function save_document_as_template(doc: SPDocument): Promise<void> {
  return new Promise((resolve) => {
    pending?.done();
    pending = {
      doc,
      list: new TemplateList(TemplateVisibility.TEMPLATE_NEW_FROM, 'custom'),
      done: () => {
        pending = null;
        changed.emit();
        resolve();
      },
    };
    changed.emit();
  });
}

function SaveTemplateView({ doc, list, done }: { doc: SPDocument; list: TemplateList; done: () => void }) {
  const items = list.items('Custom');
  const [selected, setSelected] = useState(NEW_TEMPLATE_KEY);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [asDefault, setAsDefault] = useState(false);

  // The preset to overwrite, if one is selected.
  const preset = selected === NEW_TEMPLATE_KEY ? null : TemplateList.get_preset(selected);
  const enable_save = preset ? true : name.length > 0;

  const select = (key: string) => {
    setSelected(key);
    const p = key === NEW_TEMPLATE_KEY ? null : TemplateList.get_preset(key);
    setName(p ? p.get_name() : '');
    setDescription(p ? p.get_description() : '');
  };

  const save = async () => {
    // Upstream saves the template under the name of the preset when one is selected.
    if (await save_template(doc, preset ? preset.get_name() : name, description, asDefault)) done();
  };

  return (
    <div className="guide-dialog-backdrop">
      <form
        className="guide-dialog nft-dialog"
        role="dialog"
        aria-label={_('Save as Template')}
        onSubmit={(e) => {
          e.preventDefault();
          if (enable_save) void save();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') done();
        }}
      >
        <h3>{_('Save as Template')}</h3>
        <div className="nft-fields">
          <label htmlFor="template-name">{_('Name:')}</label>
          <input
            id="template-name"
            value={name}
            maxLength={250}
            disabled={preset !== null}
            spellCheck={false}
            onChange={(e) => setName(e.target.value)}
            // biome-ignore lint/a11y/noAutofocus: the dialog asks for the name
            autoFocus
          />
          <label htmlFor="template-description">{_('Description:')}</label>
          <input
            id="template-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <ul className="nft-items" aria-label={_('Custom')}>
          {items.map((item) => (
            <li key={item.key}>
              <button
                type="button"
                className="nft-item"
                aria-pressed={selected === item.key}
                title={item.tooltip}
                onClick={() => select(item.key)}
              >
                <img src={item.icon} alt="" width={90} />
                <span className="nft-name">{item.name}</span>
                {item.label && <span className="nft-label">{item.label}</span>}
              </button>
            </li>
          ))}
        </ul>
        <div className="guide-dialog-buttons">
          <label title={_('Base every other new document on this template')}>
            <input type="checkbox" checked={asDefault} onChange={(e) => setAsDefault(e.target.checked)} />
            <span>{_('Set as default')}</span>
          </label>
          <button type="button" onClick={done}>
            {label(_('_Cancel'))}
          </button>
          <button type="submit" disabled={!enable_save}>
            {preset ? _('Overwrite') : _('Save')}
          </button>
        </div>
      </form>
    </div>
  );
}

/** Shows the dialog that save_document_as_template asked for. Render once in the app. */
export function SaveTemplateDialogHost() {
  const current = useSyncExternalStore(
    (cb) => changed.connect(cb),
    () => pending,
  );
  if (!current) return null;
  return <SaveTemplateView doc={current.doc} list={current.list} done={current.done} />;
}
