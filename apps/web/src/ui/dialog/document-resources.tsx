// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/document-resources.cpp, src/ui/dialog/document-resources.h, share/ui/dialog-document-resources.glade
/*
 * Document Resources dialog: the colors, fonts, styles, patterns, symbols, markers, gradients,
 * swatches, images, filters and external references that the document uses or defines.
 *
 * Authors:
 *   Michael Kowalski
 *
 * Copyright (C) 2023 Authors
 */
import { _, C_, DocumentUndo, SPImage } from '@inkscape-web/core';
import {
  collect_page,
  collect_statistics,
  delete_object,
  get_resource_count,
  gimp_palette,
  is_resource_present,
  matches_search,
  type ResourceItem,
  Resources,
  resource_categories,
  type SPDesktop,
  set_resource_label,
} from '@inkscape-web/editor';
import { useEffect, useMemo, useReducer, useState } from 'react';
import { useActiveDesktop } from '../../app/active-desktop.ts';
import { sp_file_save_blob } from '../../app/file.ts';
import { objectKey } from './use-repr.ts';

/** Save an image resource: its data URI or the file it names, as a download (upstream extract_image). */
async function extractImage(item: ResourceItem): Promise<void> {
  const href = item.object instanceof SPImage ? item.object.href : null;
  if (!href) return;
  const blob = await (await fetch(href)).blob();
  const ext = blob.type.split('/')[1]?.replace('svg+xml', 'svg') || 'png';
  await sp_file_save_blob(blob, `${item.id || 'image'}.${ext}`);
}

/**
 * The Document Resources dialog (dialog key "DocumentResources"): the categories of resources
 * that the document has, with the list or grid of the entries of the category; entries can be
 * renamed, selected on the canvas, deleted and, for images and colors, extracted.
 * TODO: previews of patterns, symbols and markers, the metadata page (RDF), SVG fonts.
 */
export function DocumentResourcesDialog() {
  const desktop = useActiveDesktop();
  if (!desktop) return null;
  return <DocumentResourcesImpl key={objectKey(desktop.doc) + objectKey(desktop)} desktop={desktop} />;
}

function DocumentResourcesImpl({ desktop }: { desktop: SPDesktop }) {
  const doc = desktop.getDocument();
  const [version, refresh] = useReducer((n: number) => n + 1, 0);
  const [page, setPage] = useState<string>(Resources.Stats);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  // Brute force refresh when the document changes, throttled.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = doc.modifiedSignal?.connect(() => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        refresh();
      }, 200);
    });
    const off2 = doc.commitSignal.connect(refresh);
    return () => {
      if (timer) clearTimeout(timer);
      off?.();
      off2();
    };
  }, [doc]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: version asks for a new collection
  const stats = useMemo(() => collect_statistics(doc.getRoot()), [doc, version]);
  const categories = resource_categories.filter(([id]) => id === '-' || is_resource_present(id, stats));
  const current = is_resource_present(page, stats) ? page : Resources.Stats;
  // biome-ignore lint/correctness/useExhaustiveDependencies: version asks for a new collection
  const content = useMemo(() => collect_page(doc, current, stats), [doc, current, stats, version]);
  const items = content.kind === 'items' ? content.items.filter((i) => matches_search(i.label, search)) : [];
  const item = items.find((i) => i.id === selected) ?? null;
  const rows = content.kind === 'info' ? content.rows.filter((r) => matches_search(r.value, search)) : [];

  const commitLabel = (text: string) => {
    if (item?.object) {
      set_resource_label(item.object, text);
      DocumentUndo.done(doc, C_('Undo', 'Edit label'), 'document-resources');
    }
    setEditing(null);
  };

  return (
    <div className="docres">
      <div className="docres-categories" role="listbox" aria-label={_('Resources')}>
        {categories.map(([id, label], i) =>
          id === '-' ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: the separator has no id
            <hr key={`sep${i}`} />
          ) : (
            <button
              key={id}
              type="button"
              role="option"
              aria-selected={id === current}
              onClick={() => {
                setPage(id);
                setSelected(null);
              }}
            >
              <span>{_(label)}</span>
              {id !== Resources.Stats && <small>{get_resource_count(id, stats)}</small>}
            </button>
          ),
        )}
      </div>
      <div className="docres-main">
        <input
          type="search"
          placeholder={_('Search...')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {content.kind === 'info' ? (
          <table className="docres-info">
            <tbody>
              {rows.map((r, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: rows have no unique key
                <tr key={i} title={r.value}>
                  <td>{r.item}</td>
                  <td>{r.count ? r.count : ''}</td>
                  <td className="docres-value">{r.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="docres-grid">
            {items.map((i) => (
              <button
                key={i.id}
                type="button"
                className="docres-item"
                aria-pressed={i.id === selected}
                title={i.label}
                onClick={() => setSelected(i.id)}
              >
                <span className="docres-preview" style={i.image ? { background: i.image } : undefined}>
                  {i.image ? '' : '▢'}
                </span>
                {editing === i.id ? (
                  <input
                    // biome-ignore lint/a11y/noAutofocus: editing starts with the button
                    autoFocus
                    defaultValue={i.label}
                    onBlur={(e) => commitLabel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitLabel(e.currentTarget.value);
                      else if (e.key === 'Escape') setEditing(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className="docres-label">{i.label}</span>
                )}
              </button>
            ))}
          </div>
        )}
        {content.kind === 'items' && (
          <div className="docres-buttons">
            <button
              type="button"
              disabled={!item?.editable}
              title={_('Edit the label of the selected resource')}
              onClick={() => setEditing(item?.id ?? null)}
            >
              {_('Edit')}
            </button>
            <button
              type="button"
              disabled={!item?.object}
              title={_('Select the resource on the canvas')}
              onClick={() => item?.object && desktop.getSelection().set(item.object)}
            >
              {_('Select')}
            </button>
            <button
              type="button"
              disabled={!item?.object}
              title={_('Delete the selected resource')}
              onClick={() => {
                delete_object(item?.object ?? null, desktop);
                setSelected(null);
                refresh();
              }}
            >
              {_('Delete')}
            </button>
            <button
              type="button"
              disabled={current === Resources.Images ? !item : current !== Resources.Colors}
              title={
                current === Resources.Colors ? _('Export Color Palette') : _('Extract the selected image')
              }
              onClick={() => {
                if (current === Resources.Colors) {
                  const text = gimp_palette(
                    content.items.map((c) => c.color),
                    doc.documentName ?? null,
                  );
                  void sp_file_save_blob(
                    new Blob([text], { type: 'application/color-palette' }),
                    'color-palette.gpl',
                  );
                } else if (item) void extractImage(item);
              }}
            >
              {_('Extract')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
