// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/xml-tree.cpp, src/ui/dialog/xml-tree.h
import { _, type Node } from '@inkscape-web/core';
import {
  cmdDeleteNode,
  cmdDuplicateNode,
  cmdIndentNode,
  cmdLowerNode,
  cmdNewElementNode,
  cmdNewTextNode,
  cmdRaiseNode,
  cmdUnindentNode,
  type SPDesktop,
  setDtSelect,
  xmlAncestors,
  xmlNodeLabel,
  xmlTreeRows,
} from '@inkscape-web/editor';
import { useEffect, useState } from 'react';
import { useActiveDesktop } from '../../app/active-desktop.ts';
import { AttrDialog } from './attr-dialog.tsx';
import { objectKey, useReprVersion, useSelectionVersion } from './use-repr.ts';

/** Whether node is below root (a deleted node is not). */
function isInTree(node: Node, root: Node): boolean {
  for (let n: Node | null = node; n; n = n.parent()) if (n === root) return true;
  return false;
}

/** Toolbar buttons: tooltip (msgid of share/ui/dialog-xml.glade), glyph, command. TODO: icons. */
const COMMANDS: [string, string, (dt: SPDesktop, node: Node) => Node | null][] = [
  [_('New text node'), 'T', cmdNewTextNode],
  [_('Duplicate node'), '⧉', cmdDuplicateNode],
  [_('Delete node'), '×', cmdDeleteNode],
  [_('Unindent node'), '←', cmdUnindentNode],
  [_('Indent node'), '→', cmdIndentNode],
  [_('Raise node'), '↑', cmdRaiseNode],
  [_('Lower node'), '↓', cmdLowerNode],
];

/** The XML Editor dialog (dialog key "XMLEditor"): the node tree of the document and the attributes of the selected node. */
export function XmlTreeDialog() {
  const desktop = useActiveDesktop();
  if (!desktop) return null;
  // Keyed by document: the expanded and selected nodes belong to one document.
  return <XmlTree key={objectKey(desktop.doc)} desktop={desktop} />;
}

function XmlTree({ desktop }: { desktop: SPDesktop }) {
  const doc = desktop.doc;
  const root = doc.rroot;
  useReprVersion(root);
  const selectionVersion = useSelectionVersion(desktop);
  const [expanded, setExpanded] = useState<Set<Node>>(() => new Set([root]));
  const [picked, setPicked] = useState<Node | null>(null);
  const [newName, setNewName] = useState<string | null>(null);
  const selected = picked && isInTree(picked, root) ? picked : null;

  const reveal = (node: Node) => {
    setExpanded((prev) => new Set([...prev, ...xmlAncestors(node)]));
    setPicked(node);
  };

  // The selected item of the canvas is the selected node (upstream XmlTree::on_desktop_selection_changed).
  // biome-ignore lint/correctness/useExhaustiveDependencies: selectionVersion marks selection changes
  useEffect(() => {
    const item = desktop.getSelection().singleItem();
    if (item) reveal(item.getRepr());
  }, [desktop, selectionVersion]);

  /** Select node in the tree and on the canvas. */
  const pick = (node: Node) => {
    setPicked(node);
    setDtSelect(desktop, node);
  };
  const run = (cmd: (dt: SPDesktop, node: Node) => Node | null) => {
    if (!selected) return;
    const result = cmd(desktop, selected);
    if (result) {
      reveal(result);
      setDtSelect(desktop, result);
    }
  };
  const toggle = (node: Node) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(node)) next.add(node);
      return next;
    });

  const rows = xmlTreeRows(root, expanded);
  return (
    <div className="xml-dialog">
      <div className="dialog-toolbar">
        <button
          type="button"
          title={_('New element node')}
          disabled={selected?.type() !== 'element'}
          onClick={() => setNewName('')}
        >
          +
        </button>
        {COMMANDS.map(([title, glyph, cmd]) => (
          <button key={title} type="button" title={title} disabled={!selected} onClick={() => run(cmd)}>
            {glyph}
          </button>
        ))}
      </div>
      {newName !== null && selected && (
        <form
          className="dialog-toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            const created = cmdNewElementNode(desktop, selected, newName);
            setNewName(null);
            if (created) {
              reveal(created);
              setDtSelect(desktop, created);
            }
          }}
        >
          <input
            aria-label={_('New element node')}
            // biome-ignore lint/a11y/noAutofocus: the field appears on request
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setNewName(null)}
          />
        </form>
      )}
      <div className="tree" role="tree" aria-label={_('XML Editor')}>
        {rows.map((row) => (
          <div
            key={objectKey(row.node)}
            role="treeitem"
            tabIndex={-1}
            aria-selected={row.node === selected}
            aria-expanded={row.hasChildren ? row.expanded : undefined}
            className={`tree-row${row.node === selected ? ' selected' : ''}`}
            style={{ paddingLeft: row.depth * 14 + 4 }}
            onClick={() => pick(row.node)}
            onKeyDown={(e) => e.key === 'Enter' && pick(row.node)}
          >
            <button
              type="button"
              className="tree-toggle"
              aria-label={row.expanded ? 'Collapse' : 'Expand'}
              style={{ visibility: row.hasChildren ? 'visible' : 'hidden' }}
              onClick={(e) => {
                e.stopPropagation();
                toggle(row.node);
              }}
            >
              {row.expanded ? '▾' : '▸'}
            </button>
            <span className={`xml-${row.node.type()}`}>{xmlNodeLabel(row.node)}</span>
          </div>
        ))}
      </div>
      <AttrDialog node={selected} doc={doc} />
    </div>
  );
}
