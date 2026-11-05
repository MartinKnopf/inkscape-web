// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/new-from-template.cpp, src/ui/dialog/new-from-template.h, src/ui/widget/template-list.cpp
/*
 * The New from Template dialog (action app.document-dialog-templates): a page for each category
 * of templates with the templates as icons, a search for them, and a button that makes the new
 * document. The list is TemplateList of the editor.
 *
 * Authors:
 *   Martin Owens <doctormo@geek-2.com>
 *   Michael Kowalski
 *
 * Copyright (C) 2022 Authors
 */
import { _, Signal, type SPDocument } from '@inkscape-web/core';
import { Template, TemplateList, TemplateVisibility } from '@inkscape-web/editor';
import { useState, useSyncExternalStore } from 'react';
import { name_new_document } from '../../app/file.ts';
import { output_prefs } from '../../extension/prefdialog/prefdialog.tsx';
import './new-from-template.css';

/** A GTK label without the mnemonic marker. */
const label = (s: string) => s.replace('_', '');

let pending: { list: TemplateList; done: (doc: SPDocument | null) => void } | null = null;
const changed = new Signal<[]>();

/** Ask for the parameters of a template (upstream Extension::prefs) with the dialog of the extension. */
Template.show_prefs = (template) => output_prefs(template);

/**
 * Show the dialog (upstream NewFromTemplate::load_new_from_template). Resolves with the new
 * document, or null if the user canceled.
 */
export function load_new_from_template(): Promise<SPDocument | null> {
  return new Promise((resolve) => {
    pending?.done(null);
    pending = {
      list: new TemplateList(TemplateVisibility.TEMPLATE_NEW_FROM),
      done: (doc) => {
        pending = null;
        changed.emit();
        resolve(doc);
      },
    };
    changed.emit();
  });
}

function NewFromTemplateView({ list, done }: { list: TemplateList; done: (doc: SPDocument | null) => void }) {
  const [page, setPage] = useState(list.pages[0]?.name ?? '');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async (key: string | null) => {
    if (!key || busy) return;
    setBusy(true);
    try {
      const doc = await TemplateList.new_document(key);
      // null: the options of the template were canceled
      if (doc) done(name_new_document(doc));
    } finally {
      setBusy(false);
    }
  };

  const items = list.items(page, search);
  return (
    <div className="guide-dialog-backdrop">
      <div
        className="guide-dialog nft-dialog"
        role="dialog"
        aria-label={_('New From Template')}
        onKeyDown={(e) => {
          if (e.key === 'Escape') done(null);
        }}
      >
        <h3>{_('New From Template')}</h3>
        <div className="nft-header">
          <div role="tablist" className="nft-tabs">
            {list.pages.map((p) => (
              <button
                type="button"
                key={p.name}
                role="tab"
                aria-selected={p.name === page}
                onClick={() => {
                  setPage(p.name);
                  setSelected(null);
                }}
              >
                {TemplateList.get_category_label(p.name)}
              </button>
            ))}
          </div>
          <input
            type="search"
            aria-label={_('Search')}
            placeholder={_('Search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <ul className="nft-items" aria-label={TemplateList.get_category_label(page)}>
          {items.map((item) => (
            <li key={item.key}>
              <button
                type="button"
                className="nft-item"
                aria-pressed={selected === item.key}
                title={item.tooltip}
                onClick={() => setSelected(item.key)}
                onDoubleClick={() => void create(item.key)}
              >
                <img
                  src={item.icon}
                  alt=""
                  width={90}
                  onError={(e) => {
                    // The default icon for a template without one
                    const url = e.currentTarget.src;
                    if (!url.endsWith('/default.svg'))
                      e.currentTarget.src = '/share/templates/icons/default.svg';
                  }}
                />
                <span className="nft-name">{item.name}</span>
                {item.label && <span className="nft-label">{item.label}</span>}
              </button>
            </li>
          ))}
        </ul>
        <div className="guide-dialog-buttons">
          <button type="button" onClick={() => done(null)}>
            {label(_('_Cancel'))}
          </button>
          <button type="button" disabled={!selected || busy} onClick={() => void create(selected)}>
            {_('Create')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Shows the dialog that load_new_from_template asked for. Render once in the app. */
export function NewFromTemplateHost() {
  const current = useSyncExternalStore(
    (cb) => changed.connect(cb),
    () => pending,
  );
  if (!current) return null;
  return <NewFromTemplateView list={current.list} done={current.done} />;
}
