// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/undo-history.cpp, src/ui/dialog/undo-history.h
/*
 * Authors:
 *   Gustav Broberg <broberg@kth.se>
 *   Abhishek Sharma
 *
 * Copyright (C) 2014 Authors
 * Copyright (C) 2006 Authors
 */
import { _, type SPDocument } from '@inkscape-web/core';
import {
  type UndoHistoryRow,
  undoHistoryParent,
  undoHistoryPosition,
  undoHistoryRows,
  undoHistorySeek,
  undoHistoryTarget,
} from '@inkscape-web/editor';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useActiveDocument } from '../../app/active-desktop.ts';
import { iconFallback, iconUrl } from '../icon-loader.ts';
import { objectKey } from './use-repr.ts';

/** Re-render when the undo or redo stack of doc changes. */
function useUndoVersion(doc: SPDocument): void {
  const version = useRef(0);
  useSyncExternalStore(
    (cb) =>
      doc.undoStackChangedSignal.connect(() => {
        version.current++;
        cb();
      }),
    () => version.current,
  );
}

/**
 * The Undo History dialog (dialog key "UndoHistory"): the undo and redo steps
 * of the document with icon and description. Clicking a step undoes or redoes
 * until the document is at that step. Steps with the same icon in a row are
 * grouped, with the number of steps in front of the group.
 */
export function UndoHistoryDialog() {
  const doc = useActiveDocument();
  if (!doc) return null;
  return <UndoHistory key={objectKey(doc)} doc={doc} />;
}

function UndoHistory({ doc }: { doc: SPDocument }) {
  useUndoVersion(doc);
  const rows = undoHistoryRows(doc);
  const position = undoHistoryPosition(doc);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set());
  const currentParent = undoHistoryParent(rows, position)?.position;
  const previousParent = useRef(currentParent);
  const skipExpand = useRef(false);

  // Expand the group of the current step, and collapse the group that was left (upstream _onRowChanged).
  useEffect(() => {
    const old = previousParent.current;
    previousParent.current = currentParent;
    if (skipExpand.current) {
      skipExpand.current = false;
      return;
    }
    setExpanded((prev) => {
      const next = new Set(prev);
      if (old !== undefined && old !== currentParent) next.delete(old);
      if (currentParent !== undefined) next.add(currentParent);
      return next;
    });
  }, [currentParent]);

  const toggle = (row: UndoHistoryRow) => {
    const isExpanded = expanded.has(row.position);
    // Collapsing the group of the current step is stepping to its last event.
    if (isExpanded && row.position === currentParent) {
      skipExpand.current = true;
      undoHistorySeek(doc, undoHistoryTarget(row, false));
    }
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(row.position)) next.add(row.position);
      return next;
    });
  };

  const renderRow = (row: UndoHistoryRow, depth: number, isExpanded: boolean) => {
    const current = row.position === position;
    return (
      <div
        key={row.position}
        role="treeitem"
        tabIndex={-1}
        aria-selected={current}
        aria-current={current ? 'step' : undefined}
        className={`tree-row${current ? ' selected' : ''}${row.position > position ? ' dimmed' : ''}`}
        onClick={() => undoHistorySeek(doc, undoHistoryTarget(row, isExpanded))}
        onKeyDown={(e) => e.key === 'Enter' && undoHistorySeek(doc, undoHistoryTarget(row, isExpanded))}
      >
        <button
          type="button"
          className="tree-toggle"
          aria-label={isExpanded ? _('Collapse') : _('Expand')}
          style={{ marginLeft: depth * 14, visibility: row.children.length ? 'visible' : 'hidden' }}
          onClick={(e) => {
            e.stopPropagation();
            toggle(row);
          }}
        >
          {isExpanded ? '▾' : '▸'}
        </button>
        <img src={iconUrl(row.iconName)} alt="" width={16} height={16} onError={iconFallback(row.iconName)} />
        <span className="row-label">{row.description}</span>
        {row.childCount > 1 && <b>{row.childCount}</b>}
      </div>
    );
  };

  return (
    <div className="objects-dialog">
      <div className="tree" role="tree" aria-label={_('Undo History')}>
        {rows.flatMap((row) => {
          const isExpanded = expanded.has(row.position);
          return [
            renderRow(row, 0, isExpanded),
            ...(isExpanded ? row.children.map((child) => renderRow(child, 1, false)) : []),
          ];
        })}
      </div>
    </div>
  );
}
