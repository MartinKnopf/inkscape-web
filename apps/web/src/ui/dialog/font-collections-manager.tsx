// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/font-collections-manager.cpp, src/ui/dialog/font-collections-manager.h, share/ui/dialog-font-collections.glade
/*
 * Authors:
 *   Vaibhav Malik <vaibhavmalik2018@gmail.com>
 *
 * Copyright (C) 2024 Authors
 */
import { _ } from '@inkscape-web/core';
import { collection_label, FontLister } from '@inkscape-web/editor';
import { useEffect, useReducer, useState } from 'react';
import { useFontCollections } from '../widget/font-collection-selector.tsx';

/**
 * The Font Collections dialog (dialog key "FontCollections"): the fonts with
 * a search field on the left, the collections on the right. A font is added
 * to the selected collection by dragging it onto the collection or with a
 * double click; user collections are created, renamed and deleted here.
 */
export function FontCollectionsManagerDialog() {
  const collections = useFontCollections();
  const [, update] = useReducer((n: number) => n + 1, 0);
  const lister = FontLister.get_instance();
  useEffect(() => lister.changedSignal.connect(update), [lister]);
  const [search, setSearch] = useState('');
  const [current, setCurrent] = useState<string | null>(null);
  const [font, setFont] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const families = lister
    .all_families()
    .filter((f) => !search || f.toLowerCase().includes(search.toLowerCase()));
  const user = collections.get_collections(false);
  const selected = current && collections.find_collection(current) ? current : null;

  const create = () => {
    let name = _('Untitled collection');
    for (let i = 2; collections.find_collection(name); i++) name = `${_('Untitled collection')} ${i}`;
    collections.add_collection(name);
    setCurrent(name);
    setEditing(name);
  };

  return (
    <div className="font-collections-manager">
      <div className="font-collections-fonts">
        <div className="text-edit-row">
          <input
            type="search"
            className="text-edit-search"
            placeholder={_('Search fonts present in the font list')}
            aria-label={_('Search fonts present in the font list')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button type="button" title={_('Reset the font list')} onClick={() => setSearch('')}>
            ⟲
          </button>
        </div>
        <div className="font-list-items" role="listbox" aria-label={_('Fonts')}>
          {families.map((f) => (
            <button
              key={f}
              type="button"
              role="option"
              draggable
              aria-selected={false}
              className="font-list-item"
              style={{ fontFamily: `'${f}'` }}
              onDragStart={(e) => e.dataTransfer.setData('text/plain', f)}
              onDoubleClick={() => selected && collections.add_font(selected, f)}
            >
              {f}
            </button>
          ))}
        </div>
      </div>
      <div className="font-collections-list">
        <div className="text-edit-row">
          <button type="button" title={_('Create new collection')} onClick={create}>
            +
          </button>
          <button
            type="button"
            title={_('Edit selected collection')}
            disabled={!selected}
            onClick={() => setEditing(selected)}
          >
            ✎
          </button>
          <button
            type="button"
            title={_('Delete selected item')}
            disabled={!selected}
            onClick={() => {
              if (!selected) return;
              if (font) {
                collections.remove_font(selected, font);
                setFont(null);
              } else {
                collections.remove_collection(selected);
                setCurrent(null);
              }
            }}
          >
            🗑
          </button>
        </div>
        <ul className="font-collections-tree">
          {collections.get_collections(true).map((name) => (
            <li key={name} className="font-collections-system">
              {collection_label(name)}
            </li>
          ))}
          {user.map((name) => (
            <li
              key={name}
              aria-current={name === selected && !font}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                collections.add_font(name, e.dataTransfer.getData('text/plain'));
              }}
            >
              {editing === name ? (
                <input
                  // biome-ignore lint/a11y/noAutofocus: renaming starts in the field
                  autoFocus
                  defaultValue={name}
                  aria-label={_('Collection name')}
                  onBlur={(e) => {
                    collections.rename_collection(name, e.target.value);
                    setCurrent(e.target.value.trim() || name);
                    setEditing(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="font-collections-name"
                  onClick={() => {
                    setCurrent(name);
                    setFont(null);
                  }}
                  onDoubleClick={() => setEditing(name)}
                >
                  {name}
                </button>
              )}
              <ul>
                {[...collections.get_fonts(name)].sort().map((f) => (
                  <li key={f}>
                    <button
                      type="button"
                      aria-current={name === selected && f === font}
                      style={{ fontFamily: `'${f}'` }}
                      onClick={() => {
                        setCurrent(name);
                        setFont(f);
                      }}
                    >
                      {f}
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
