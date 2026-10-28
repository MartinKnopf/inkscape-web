// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/object-properties.cpp, src/ui/dialog/object-attributes.cpp, share/ui/object-properties.ui
/*
 * Copyright (C) 2012 Kris De Gussem <Kris.DeGussem@gmail.com>
 * c++ version based on former C-version (GPL v2+) with authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   bulia byak <buliabyak@users.sf.net>
 *   Johan Engelen <goejendaagh@zonnet.nl>
 *   Abhishek Sharma
 */
import {
  _,
  C_,
  is_object_id_valid,
  SPImage,
  type SPItem,
  type SPObject,
  UnitType,
  unitsOfType,
} from '@inkscape-web/core';
import {
  getImageRendering,
  IMAGE_RENDERING,
  INTERACTIVITY_ATTRIBUTES,
  objectPropertiesObject,
  objectPropertiesTitle,
  type SPDesktop,
  selectionXywh,
  setImageRendering,
  setObjectAttribute,
  setObjectDescription,
  setObjectHidden,
  setObjectId,
  setObjectLabel,
  setObjectLocked,
  setObjectTitle,
  transformSelectedItems,
} from '@inkscape-web/editor';
import { Rect } from '@inkscape-web/geom';
import { useState } from 'react';
import { useActiveDesktop } from '../../app/active-desktop.ts';
import { iconUrl } from '../icon-loader.ts';
import { NumberField } from './number-field.tsx';
import { objectKey, useReprVersion, useSelectionVersion } from './use-repr.ts';

/** A text entry that commits on Enter or blur (the event handler fields). */
function CommitEntry(props: { label: string; value: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const finish = () => {
    if (draft !== null && draft !== props.value) props.onCommit(draft);
    setDraft(null);
  };
  return (
    <input
      className="attr-input"
      aria-label={props.label}
      value={draft ?? props.value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={finish}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        else if (e.key === 'Escape') setDraft(null);
      }}
    />
  );
}

/**
 * The Object Properties dialog (dialog key "ObjectProperties"): label, lock
 * and hide, id, title and description, location and size, image rendering and
 * the event handlers (interactivity) of the selected object.
 * TODO: the fill and stroke, blur, filter and path effect sections of
 * upstream, the panels for the element types.
 */
export function ObjectPropertiesDialog() {
  const desktop = useActiveDesktop();
  useReprVersion(desktop?.doc.rroot ?? null);
  useSelectionVersion(desktop);
  if (!desktop) return null;
  const object = objectPropertiesObject(desktop);
  return (
    <ObjectProperties key={object ? objectKey(object.getRepr()) : 'none'} desktop={desktop} object={object} />
  );
}

function ObjectProperties({ desktop, object }: { desktop: SPDesktop; object: SPItem | null }) {
  const [id, setId] = useState<string | null>(null);
  const [unit, setUnit] = useState(() => desktop.doc.getNamedView().getDisplayUnit());
  const off = !object;
  const shownId = id ?? object?.getId() ?? '';
  const warning = id !== null && object && id !== object.getId() ? setIdWarning(id) : null;
  const units = unitsOfType(UnitType.LINEAR).map((u) => u.abbr);
  const box = selectionXywh(desktop, unit, true);
  const fields: [label: string, value: number, update: (r: Rect, v: number) => Rect][] = [
    [
      C_("Object's location X", 'X'),
      box?.left() ?? 0,
      (r, v) => Rect.fromXywh(v, r.top(), r.width(), r.height()),
    ],
    [
      C_("Object's location Y", 'Y'),
      box?.top() ?? 0,
      (r, v) => Rect.fromXywh(r.left(), v, r.width(), r.height()),
    ],
    [C_("Object's size", 'W'), box?.width() ?? 0, (r, v) => Rect.fromXywh(r.left(), r.top(), v, r.height())],
    [C_("Object's size", 'H'), box?.height() ?? 0, (r, v) => Rect.fromXywh(r.left(), r.top(), r.width(), v)],
  ];

  return (
    <div className="docprops">
      <div className="docprops-row">
        <span>{_('Selection')}</span>
        <input
          className="attr-input"
          aria-label={_('Object label')}
          title={_("Object's label")}
          disabled={off}
          placeholder={objectPropertiesTitle(desktop)}
          value={object?.label() ?? ''}
          onChange={(e) => object && setObjectLabel(object, e.target.value)}
        />
        {object && (
          <button
            type="button"
            title={_('Lock object to prevent selection by mouse')}
            aria-pressed={!object.sensitive}
            onClick={() => setObjectLocked(object, object.sensitive)}
          >
            <img
              src={iconUrl(object.sensitive ? 'object-unlocked' : 'object-locked')}
              alt={object.sensitive ? _('Unlocked') : _('Locked')}
              width={16}
              height={16}
            />
          </button>
        )}
      </div>
      <fieldset disabled={off} style={{ border: 0, padding: 0 }}>
        <div className="docprops-row">
          <span>{_('ID')}</span>
          <input
            className="attr-input"
            aria-label={_('ID')}
            aria-invalid={warning !== null}
            title={_("Element's unique identifier")}
            value={shownId}
            onChange={(e) => setId(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && object && applyId(object, id, setId)}
          />
          <button
            type="button"
            title={_("Change element's identifier")}
            disabled={id === null}
            onClick={() => object && applyId(object, id, setId)}
          >
            {_('Set')}
          </button>
        </div>
        {warning && <div role="alert">{warning}</div>}
        <div className="docprops-row">
          <span>{_('Title')}</span>
          <input
            className="attr-input"
            aria-label={_('Title')}
            value={object?.title() ?? ''}
            onChange={(e) => object && setObjectTitle(object, e.target.value)}
          />
        </div>
        <div className="docprops-row">
          <span>{_('Description')}</span>
          <textarea
            className="attr-input"
            aria-label={_('Description')}
            rows={3}
            value={object?.desc() ?? ''}
            onChange={(e) => object && setObjectDescription(object, e.target.value)}
          />
        </div>
        {object && (
          <label className="docprops-row">
            <input
              type="checkbox"
              checked={object.isExplicitlyHidden()}
              onChange={(e) => setObjectHidden(object, e.target.checked)}
            />
            <span title={_('Check to make the object invisible')}>{_('Hide')}</span>
          </label>
        )}
        {object instanceof SPImage && (
          <div className="docprops-row">
            <span>{_('Image Rendering:')}</span>
            <select
              value={getImageRendering(object)}
              onChange={(e) => setImageRendering(object, e.target.value)}
            >
              {IMAGE_RENDERING.map(([value, label]) => (
                <option key={value} value={value}>
                  {_(label)}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="docprops-row">
          <span>{C_("Object's location", 'Location')}</span>
          {fields.slice(0, 2).map(([label, value, update]) => (
            <span key={label}>
              {label}{' '}
              <NumberField
                label={label}
                value={value}
                onCommit={(v) => box && transformSelectedItems(desktop, update(box, v), unit, true)}
              />
            </span>
          ))}
        </div>
        <div className="docprops-row">
          <span>{C_("Object's size", 'Size')}</span>
          {fields.slice(2).map(([label, value, update]) => (
            <span key={label}>
              {label}{' '}
              <NumberField
                label={label}
                value={value}
                onCommit={(v) => box && transformSelectedItems(desktop, update(box, v), unit, true)}
              />
            </span>
          ))}
          <select aria-label={_('Unit')} value={unit} onChange={(e) => setUnit(e.target.value)}>
            {units.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
        <div className="docprops-row">
          <b>{_('Interactivity')}</b>
        </div>
        {object &&
          INTERACTIVITY_ATTRIBUTES.map(([attribute, label]) => (
            <div className="docprops-row" key={attribute}>
              <span>{_(label)}</span>
              <CommitEntry
                label={_(label)}
                value={object.getAttribute(attribute) ?? ''}
                onCommit={(v) => setObjectAttribute(object as SPObject, attribute, v)}
              />
            </div>
          ))}
        <small>
          <i>
            {_('<small><i>Enter JavaScript code for interactive behavior in a browser.</i></small>').replace(
              /<[^>]+>/g,
              '',
            )}
          </i>
        </small>
      </fieldset>
    </div>
  );
}

/** The warning for an invalid id, or null. */
function setIdWarning(id: string): string | null {
  const { valid, warning } = is_object_id_valid(id);
  return valid ? null : warning;
}

function applyId(object: SPItem, id: string | null, reset: (id: string | null) => void): void {
  if (id === null) return;
  if (setObjectId(object, id) === null) reset(null);
}
