// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/widget/font-collection-selector.cpp, src/ui/widget/font-collection-selector.h
/*
 * Authors:
 *   Vaibhav Malik <vaibhavmalik2018@gmail.com>
 *
 * Copyright (C) 2024 Authors
 */
import { _, C_ } from '@inkscape-web/core';
import { collection_label, FontCollections } from '@inkscape-web/editor';
import { useEffect, useReducer } from 'react';

/** Re-render when the font collections or their selection change. */
export function useFontCollections(): FontCollections {
  const [, update] = useReducer((n: number) => n + 1, 0);
  const collections = FontCollections.get();
  useEffect(() => {
    const a = collections.update_signal.connect(update);
    const b = collections.selection_update_signal.connect(update);
    return () => {
      a();
      b();
    };
  }, [collections]);
  return collections;
}

/**
 * The font collections with check boxes that filter the font lists (upstream
 * FontCollectionSelector in the Text and Font dialog and the text toolbar).
 * onEdit opens the Font Collections dialog.
 */
export function FontCollectionSelector({ onEdit }: { onEdit?: () => void }) {
  const collections = useFontCollections();
  const row = (name: string) => (
    <label key={name} className="font-collection-row">
      <input
        type="checkbox"
        checked={collections.is_collection_selected(name)}
        onChange={() => collections.update_selected_collections(name)}
      />{' '}
      {collection_label(name)}
    </label>
  );
  return (
    <div className="font-collection-selector">
      {collections.get_collections(true).map(row)}
      {collections.get_collections(false).length > 0 && <hr />}
      {collections.get_collections(false).map(row)}
      <div className="font-collection-buttons">
        <button type="button" onClick={() => collections.clear_selected_collections()}>
          {_('Show all fonts')}
        </button>
        {onEdit && (
          <button type="button" onClick={onEdit}>
            {_('Edit font collections')}
          </button>
        )}
      </div>
    </div>
  );
}

/** "N of M fonts" or "All fonts" (upstream FontList font count label). */
export function fontCountLabel(shown: number, total: number): string {
  return shown === total
    ? `${C_('N-of-fonts', 'All fonts')} (${total})`
    : `${shown} ${C_('N-of-fonts', 'of')} ${total} ${C_('N-of-fonts', 'fonts')}`;
}
