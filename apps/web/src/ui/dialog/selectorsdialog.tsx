// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/selectorsdialog.cpp, src/ui/dialog/selectorsdialog.h
/*
 * A dialog for CSS selectors.
 *
 * Authors:
 *   Kamalpreet Kaur Grewal
 *   Tavmjong Bah
 *   Martin Owens
 *
 * Copyright (C) Kamalpreet Kaur Grewal 2016
 * Copyright (C) Tavmjong Bah 2017
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { _ } from '@inkscape-web/core';
import {
  add_selector,
  type CssDeclaration,
  delete_statement,
  objects_of_rule,
  read_style_element,
  type SPDesktop,
  set_declarations,
} from '@inkscape-web/editor';
import { useEffect, useReducer, useState } from 'react';
import { useActiveDesktop } from '../../app/active-desktop.ts';
import { objectKey } from './use-repr.ts';

/**
 * The Selectors dialog (dialog key "Selectors"): the rules of the style element of the document
 * with the objects that each selector matches. A rule can be selected to select its objects, added,
 * deleted and its properties edited; the changes go to the style element with one undo step.
 * TODO: the style sheet is not applied to the drawing (the CSS cascade is not ported), dragging
 * rules to reorder them, selectors in more than one style element.
 */
export function SelectorsDialog() {
  const desktop = useActiveDesktop();
  if (!desktop) return null;
  return <SelectorsDialogImpl key={objectKey(desktop.doc) + objectKey(desktop)} desktop={desktop} />;
}

function SelectorsDialogImpl({ desktop }: { desktop: SPDesktop }) {
  const doc = desktop.getDocument();
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const [current, setCurrent] = useState<number | null>(null);
  // The text of the field that asks for a new selector; null while it is closed.
  const [adding, setAdding] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    const off = [doc.commitSignal.connect(refresh), doc.modifiedSignal.connect(refresh)];
    return () => {
      for (const f of off) f();
    };
  }, [doc]);

  const { statements } = read_style_element(doc);
  const rule = current !== null ? statements[current] : undefined;

  const choose = (i: number) => {
    setCurrent(i);
    // Selecting a rule selects the objects that it matches.
    const st = statements[i];
    if (st)
      desktop.getSelection().setList(objects_of_rule(doc, st).filter((o) => o !== doc.getRoot()) as never);
  };

  const submit = () => {
    if (adding === null) return;
    if (!add_selector(doc, adding)) {
      setInvalid(true);
      return;
    }
    setAdding(null);
    setInvalid(false);
    setCurrent(statements.length);
  };

  const edit = (declarations: CssDeclaration[]) => {
    if (current !== null) set_declarations(doc, current, declarations);
  };

  return (
    <div className="selectors-dialog">
      <div className="selectors-list" role="listbox" aria-label={_('CSS selector')}>
        {statements.map((st, i) => {
          const objects = objects_of_rule(doc, st);
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: statements have no id
            <div key={i}>
              <button
                type="button"
                role="option"
                aria-selected={i === current}
                className="selectors-row"
                onClick={() => choose(i)}
              >
                <b>{st.kind === 'rule' ? st.selectors : st.text.split(/[{;]/)[0]}</b>
                {st.kind === 'rule' && <small>{objects.length}</small>}
              </button>
              {i === current && objects.length > 0 && (
                <ul className="selectors-objects">
                  {objects.map((o) => (
                    <li key={o.getId() ?? o.getRepr().name()}>{o.getId() ?? o.getRepr().name()}</li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      {rule?.kind === 'rule' && (
        <table className="selectors-properties">
          <tbody>
            {rule.declarations.map((d, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: declarations have no id
              <tr key={i}>
                <td>
                  <input
                    aria-label={_('Property name')}
                    defaultValue={d.name}
                    onBlur={(e) =>
                      e.target.value.trim() !== d.name &&
                      edit(
                        rule.declarations.map((x, j) =>
                          j === i ? { ...x, name: e.target.value.trim() } : x,
                        ),
                      )
                    }
                  />
                </td>
                <td>
                  <input
                    aria-label={_('Property value')}
                    defaultValue={d.value}
                    onBlur={(e) =>
                      e.target.value.trim() !== d.value &&
                      edit(
                        rule.declarations.map((x, j) =>
                          j === i ? { ...x, value: e.target.value.trim() } : x,
                        ),
                      )
                    }
                  />
                </td>
                <td>
                  <button
                    type="button"
                    title={_('Delete')}
                    onClick={() => edit(rule.declarations.filter((_x, j) => j !== i))}
                  >
                    −
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {adding !== null && (
        <form
          className="selectors-add"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label>
            {_('CSS selector')}
            <input
              // biome-ignore lint/a11y/noAutofocus: the field opens on request
              autoFocus
              value={adding}
              onChange={(e) => {
                setAdding(e.target.value);
                setInvalid(false);
              }}
            />
          </label>
          {invalid && <span className="selectors-invalid">{_('Invalid CSS selector.')}</span>}
          <button type="button" onClick={() => setAdding(null)}>
            {_('Cancel')}
          </button>
          <button type="submit">{_('Add')}</button>
        </form>
      )}
      <div className="selectors-buttons">
        <button type="button" title={_('Add a new CSS Selector')} onClick={() => setAdding('')}>
          +
        </button>
        <button
          type="button"
          title={_('Remove a CSS Selector')}
          disabled={current === null}
          onClick={() => {
            if (current === null) return;
            delete_statement(doc, current);
            setCurrent(null);
          }}
        >
          −
        </button>
        {rule?.kind === 'rule' && (
          <button
            type="button"
            title={_('Add a property')}
            onClick={() => edit([...rule.declarations, { name: 'property', value: 'value' }])}
          >
            {_('Add')}
          </button>
        )}
      </div>
    </div>
  );
}
