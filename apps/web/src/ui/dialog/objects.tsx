// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/objects.cpp, src/ui/dialog/objects.h
import { _, type SPItem } from '@inkscape-web/core';
import { objectRows, selectRow, toggleLocked, toggleVisible } from '@inkscape-web/editor';
import { useState } from 'react';
import { useActiveDesktop } from '../../app/active-desktop.ts';
import { objectKey, useReprVersion, useSelectionVersion } from './use-repr.ts';

/**
 * The Layers and Objects dialog (dialog key "Objects"): layers and items,
 * topmost first, with the visibility and lock toggles.
 * TODO: drag and drop, search, rename, opacity and blend mode, color tags,
 * the layers-only mode, icons.
 */
export function ObjectsDialog() {
  const desktop = useActiveDesktop();
  useReprVersion(desktop?.doc.rroot ?? null);
  useSelectionVersion(desktop);
  const [collapsed, setCollapsed] = useState<Set<SPItem>>(() => new Set());
  if (!desktop) return null;

  const selection = desktop.getSelection();
  const current = desktop.layerManager().currentLayer();
  const toggleCollapsed = (item: SPItem) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(item)) next.add(item);
      return next;
    });

  return (
    <div className="objects-dialog">
      <div className="tree" role="tree" aria-label={_('Layers and Objects')}>
        {objectRows(desktop, collapsed).map((row) => {
          const isSelected = selection.includes(row.item);
          const isCurrent = row.isLayer && row.item === current;
          return (
            <div
              key={objectKey(row.item.getRepr())}
              role="treeitem"
              tabIndex={-1}
              aria-selected={isSelected}
              aria-expanded={row.hasChildren ? !row.collapsed : undefined}
              className={`tree-row${isSelected ? ' selected' : ''}${isCurrent ? ' current-layer' : ''}${row.hidden ? ' dimmed' : ''}`}
              onClick={(e) => selectRow(desktop, row.item, e.ctrlKey || e.metaKey || e.shiftKey)}
              onKeyDown={(e) => e.key === 'Enter' && selectRow(desktop, row.item, false)}
            >
              <button
                type="button"
                className="tree-toggle"
                aria-label={row.collapsed ? 'Expand' : 'Collapse'}
                style={{ marginLeft: row.depth * 14, visibility: row.hasChildren ? 'visible' : 'hidden' }}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleCollapsed(row.item);
                }}
              >
                {row.collapsed ? '▸' : '▾'}
              </button>
              <span className="row-label">
                {row.isLayer ? '▤ ' : ''}
                {row.label}
              </span>
              <button
                type="button"
                className="row-toggle"
                aria-pressed={row.hidden}
                title={row.hidden ? _('Hidden') : _('Visible')}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleVisible(desktop, row.item, e.ctrlKey || e.metaKey);
                }}
              >
                {row.hidden ? '○' : '●'}
              </button>
              <button
                type="button"
                className="row-toggle"
                aria-pressed={row.locked}
                title={row.locked ? _('Locked') : _('Unlocked')}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleLocked(desktop, row.item, e.ctrlKey || e.metaKey);
                }}
              >
                {row.locked ? '■' : '□'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
