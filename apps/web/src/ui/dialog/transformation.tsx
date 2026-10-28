// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/transformation.cpp, src/ui/dialog/transformation.h
/*
 * Authors:
 *   Bryce W. Harrington <bryce@bryceharrington.org>
 *   buliabyak@gmail.com
 *   Abhishek Sharma
 *
 * Copyright (C) 2004, 2005 Authors
 */
import { _, formatNumber } from '@inkscape-web/core';
import {
  PageType,
  type ScalarUnit,
  type SPDesktop,
  Transformation,
  type UnitMenu,
} from '@inkscape-web/editor';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useActiveDesktop } from '../../app/active-desktop.ts';
import { iconUrl } from '../icon-loader.ts';
import { objectKey } from './use-repr.ts';

/** A number field that commits on Enter or blur; Enter also applies (upstream: the spin buttons activate Apply). */
function NumberField(props: {
  label: string;
  tooltip?: string;
  value: number;
  onCommit: (value: number) => void;
  onEnter?: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = formatNumber(props.value, 3);
  const finish = () => {
    const value = Number.parseFloat(draft ?? '');
    setDraft(null);
    if (draft !== null && Number.isFinite(value)) props.onCommit(value);
  };
  return (
    <input
      className="docprops-number"
      aria-label={props.label}
      title={props.tooltip}
      value={draft ?? shown}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={finish}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          finish();
          props.onEnter?.();
        } else if (e.key === 'Escape') setDraft(null);
      }}
    />
  );
}

function UnitSelect(props: { menu: UnitMenu; tooltip?: string; onChange: () => void }) {
  return (
    <select
      value={props.menu.unit}
      title={props.tooltip}
      onChange={(e) => {
        props.menu.setUnit(e.target.value);
        props.onChange();
      }}
    >
      {props.menu.units.map((u) => (
        <option key={u} value={u}>
          {u}
        </option>
      ))}
    </select>
  );
}

/** A labelled number with the unit menu beside the first field of the page. */
function ScalarRow(props: {
  label: string;
  tooltip: string;
  scalar: ScalarUnit;
  menu?: UnitMenu;
  onChange: () => void;
  onEnter: () => void;
}) {
  const { scalar } = props;
  return (
    <div className="docprops-row">
      <span title={props.tooltip}>{props.label}</span>
      <NumberField
        label={props.label}
        tooltip={props.tooltip}
        value={scalar.value}
        onCommit={(v) => {
          scalar.value = v;
          props.onChange();
        }}
        onEnter={props.onEnter}
      />
      {props.menu && <UnitSelect menu={props.menu} onChange={props.onChange} />}
    </div>
  );
}

const MATRIX_TOOLTIPS = ['A', 'B', 'C', 'D', 'E', 'F'].map((l) => `Transformation matrix element ${l}`);

function Check(props: { label: string; tooltip: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="docprops-row" title={props.tooltip}>
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
      <span>{props.label}</span>
    </label>
  );
}

/**
 * The Transform dialog (dialog key "Transform"): move, scale, rotate, skew and
 * matrix tabs, applied to the selection. The logic is in Transformation.
 */
export function TransformationDialog() {
  const desktop = useActiveDesktop();
  if (!desktop) return null;
  return <TransformationView key={objectKey(desktop.doc) + objectKey(desktop)} desktop={desktop} />;
}

function TransformationView({ desktop }: { desktop: SPDesktop }) {
  const t = useMemo(() => new Transformation(desktop), [desktop]);
  const version = useRef(0);
  useSyncExternalStore(
    (cb) =>
      t.changed.connect(() => {
        version.current++;
        cb();
      }),
    () => version.current,
  );
  useEffect(() => {
    const selection = desktop.getSelection();
    const off = [
      selection.connectChanged(() => t.updateSelection()),
      selection.connectModified(() => t.updateSelection()),
    ];
    return () => {
      for (const f of off) f();
    };
  }, [desktop, t]);

  const refresh = () => t.changed.emit();
  const apply = () => t.apply(false);
  const has = t.hasSelection;
  const pages: [PageType, string][] = [
    [PageType.PAGE_MOVE, _('Move')],
    [PageType.PAGE_SCALE, _('Scale')],
    [PageType.PAGE_ROTATE, _('Rotate')],
    [PageType.PAGE_SKEW, _('Skew')],
    [PageType.PAGE_TRANSFORM, _('Matrix')],
  ];

  return (
    <div className="docprops-tabs">
      <div className="docprops-tabbar" role="tablist">
        {pages.map(([page, text]) => (
          <button
            key={page}
            type="button"
            role="tab"
            aria-selected={t.page === page}
            onClick={() => t.setPage(page)}
          >
            {text}
          </button>
        ))}
      </div>
      <div className="docprops">
        <fieldset disabled={!has} style={{ border: 0, padding: 0 }}>
          {t.page === PageType.PAGE_MOVE && (
            <>
              <ScalarRow
                label={_('Horizontal')}
                tooltip={_('Horizontal displacement (relative) or position (absolute)')}
                scalar={t.moveHorizontal}
                menu={t.unitsMove}
                onChange={refresh}
                onEnter={apply}
              />
              <ScalarRow
                label={_('Vertical')}
                tooltip={_('Vertical displacement (relative) or position (absolute)')}
                scalar={t.moveVertical}
                onChange={refresh}
                onEnter={apply}
              />
              <Check
                label={_('Relative move')}
                tooltip={_(
                  'Add the specified relative displacement to the current position; otherwise, edit the current absolute position directly',
                )}
                checked={t.moveRelative}
                onChange={(v) => {
                  t.moveRelative = v;
                  t.onMoveRelativeToggled();
                }}
              />
            </>
          )}
          {t.page === PageType.PAGE_SCALE && (
            <>
              <ScalarRow
                label={_('Width')}
                tooltip={_('Horizontal size (absolute or percentage of current)')}
                scalar={t.scaleHorizontal}
                menu={t.unitsScale}
                onChange={() => {
                  t.onScaleXValueChanged();
                  refresh();
                }}
                onEnter={apply}
              />
              <ScalarRow
                label={_('Height')}
                tooltip={_('Vertical size (absolute or percentage of current)')}
                scalar={t.scaleVertical}
                onChange={() => {
                  t.onScaleYValueChanged();
                  refresh();
                }}
                onEnter={apply}
              />
              <Check
                label={_('Scale proportionally')}
                tooltip={_('Preserve the width/height ratio of the scaled objects')}
                checked={t.scaleProportional}
                onChange={(v) => {
                  t.scaleProportional = v;
                  t.onScaleProportionalToggled();
                }}
              />
            </>
          )}
          {t.page === PageType.PAGE_ROTATE && (
            <>
              <ScalarRow
                label={_('Angle')}
                tooltip={
                  t.counterclockwise
                    ? _('Rotation angle (positive = counterclockwise)')
                    : _('Rotation angle (positive = clockwise)')
                }
                scalar={t.rotate}
                menu={t.unitsRotate}
                onChange={refresh}
                onEnter={apply}
              />
              <div className="docprops-row">
                {(
                  [
                    [true, 'object-rotate-left', _('Rotate in a counterclockwise direction')],
                    [false, 'object-rotate-right', _('Rotate in a clockwise direction')],
                  ] as const
                ).map(([ccw, icon, tip]) => (
                  <button
                    key={icon}
                    type="button"
                    className="align-button"
                    title={tip}
                    aria-pressed={t.counterclockwise === ccw}
                    onClick={() => t.setRotateDirection(ccw)}
                  >
                    <img src={iconUrl(icon)} alt={tip} width={16} height={16} />
                  </button>
                ))}
              </div>
            </>
          )}
          {t.page === PageType.PAGE_SKEW && (
            <>
              <ScalarRow
                label={_('Horizontal')}
                tooltip={_(
                  'Horizontal skew angle (positive = counterclockwise), or absolute displacement, or percentage displacement',
                )}
                scalar={t.skewHorizontal}
                menu={t.unitsSkew}
                onChange={refresh}
                onEnter={apply}
              />
              <ScalarRow
                label={_('Vertical')}
                tooltip={_(
                  'Vertical skew angle (positive = clockwise), or absolute displacement, or percentage displacement',
                )}
                scalar={t.skewVertical}
                onChange={refresh}
                onEnter={apply}
              />
            </>
          )}
          {t.page === PageType.PAGE_TRANSFORM && (
            <>
              <div className="docprops-row">
                {['A', 'B', 'C', 'D', 'E', 'F'].map((letter, i) => (
                  <span key={letter} title={_(MATRIX_TOOLTIPS[i] as string)}>
                    {letter}
                    <NumberField
                      label={letter}
                      value={t.matrix[i] as number}
                      onCommit={(v) => {
                        t.matrix[i] = v;
                        refresh();
                      }}
                      onEnter={apply}
                    />
                  </span>
                ))}
              </div>
              <div className="docprops-row">
                <span>{_('E and F units')}</span>
                <UnitSelect menu={t.unitsTransform} tooltip={_('E and F units')} onChange={refresh} />
              </div>
              <Check
                label={_('Edit current matrix')}
                tooltip={_(
                  'Edit the current transform= matrix; otherwise, post-multiply transform= by this matrix',
                )}
                checked={t.replaceMatrix}
                onChange={(v) => {
                  t.replaceMatrix = v;
                  t.onReplaceMatrixToggled();
                }}
              />
            </>
          )}
        </fieldset>
        {t.showApplySeparately && t.page !== PageType.PAGE_TRANSFORM && (
          <Check
            label={_('Apply to each object separately')}
            tooltip={_(
              'Apply the scale/rotate/skew to each selected object separately; otherwise, transform the selection as a whole',
            )}
            checked={t.applySeparately}
            onChange={(v) => {
              t.applySeparately = v;
            }}
          />
        )}
        {t.message && <div role="alert">{t.message.replace(/<[^>]+>/g, '')}</div>}
        <div className="docprops-row">
          <button
            type="button"
            disabled={!has}
            title={_('Duplicate selection and apply transformation to the copy')}
            onClick={() => t.apply(true)}
          >
            {_('Duplicate')}
          </button>
          <button
            type="button"
            disabled={!has}
            title={_('Apply transformation to selection')}
            onClick={apply}
          >
            {_('Apply')}
          </button>
          <button
            type="button"
            title={_('Reset the values on the current tab to defaults')}
            onClick={() => t.onClear()}
          >
            {_('Reset')}
          </button>
        </div>
      </div>
    </div>
  );
}
