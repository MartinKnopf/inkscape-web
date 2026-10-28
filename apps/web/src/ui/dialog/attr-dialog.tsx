// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/attrdialog.cpp, src/ui/dialog/attrdialog.h
import { _, type Node, type SPDocument } from '@inkscape-web/core';
import {
  attrDelete,
  attrRename,
  attrValueEdited,
  contentEdited,
  isValidNewAttributeName,
} from '@inkscape-web/editor';
import { useState } from 'react';

/** A text field that commits on Enter or blur and reverts on Escape. */
function CommitInput(props: {
  value: string;
  placeholder?: string;
  ariaLabel: string;
  autoFocus?: boolean;
  onCommit: (value: string) => void;
  onCancel?: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const finish = (commit: boolean) => {
    const value = draft;
    setDraft(null);
    if (commit && value !== null && value !== props.value) props.onCommit(value);
    else if (!commit) props.onCancel?.();
  };
  return (
    <input
      className="attr-input"
      aria-label={props.ariaLabel}
      placeholder={props.placeholder}
      // biome-ignore lint/a11y/noAutofocus: the new attribute row asks for a name at once
      autoFocus={props.autoFocus}
      value={draft ?? props.value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        else if (e.key === 'Escape') finish(false);
      }}
    />
  );
}

/** The row for a new attribute: name first, then value. The attribute exists after the value is entered. */
function NewAttributeRow({ node, doc, onDone }: { node: Node; doc: SPDocument; onDone: () => void }) {
  const [name, setName] = useState('');
  return (
    <tr>
      <td>
        <CommitInput
          value={name}
          ariaLabel={_('Attribute Name')}
          placeholder={_('Attribute Name')}
          autoFocus
          onCommit={(v) => (isValidNewAttributeName(node, v) ? setName(v) : onDone())}
          onCancel={onDone}
        />
      </td>
      <td>
        {name && (
          <CommitInput
            value=""
            ariaLabel={_('Attribute Value')}
            placeholder={_('Attribute Value')}
            autoFocus
            onCommit={(v) => {
              attrValueEdited(doc, node, name, v);
              onDone();
            }}
            onCancel={onDone}
          />
        )}
      </td>
      <td />
    </tr>
  );
}

/**
 * The attributes of node: edit a name or a value, delete, add (upstream
 * AttrDialog). Text and comment nodes show their content instead.
 * TODO: the value popup for long values, the precision menu.
 */
export function AttrDialog({ node, doc }: { node: Node | null; doc: SPDocument }) {
  const [adding, setAdding] = useState(false);
  if (!node) return null;
  if (node.type() !== 'element') {
    return (
      <textarea
        className="attr-content"
        aria-label={_('Content')}
        key={node.content() ?? ''}
        defaultValue={node.content() ?? ''}
        onBlur={(e) => contentEdited(doc, node, e.target.value)}
      />
    );
  }
  return (
    <div className="attr-dialog">
      <div className="dialog-toolbar">
        <button type="button" title={_('Add a new attribute')} onClick={() => setAdding(true)}>
          +
        </button>
      </div>
      <div className="attr-scroll">
        <table className="attr-table">
          <thead>
            <tr>
              <th>{_('Name')}</th>
              <th>{_('Value')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {adding && <NewAttributeRow node={node} doc={doc} onDone={() => setAdding(false)} />}
            {node.attributeList().map(([name, value]) => (
              <tr key={name}>
                <td>
                  <CommitInput
                    value={name}
                    ariaLabel={_('Name')}
                    onCommit={(v) => attrRename(doc, node, name, v)}
                  />
                </td>
                <td>
                  <CommitInput
                    value={value}
                    ariaLabel={`${_('Value')} ${name}`}
                    onCommit={(v) => attrValueEdited(doc, node, name, v)}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    title={_('Delete attribute')}
                    onClick={() => attrDelete(doc, node, name)}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
