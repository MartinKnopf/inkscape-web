// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/toolbar/page-toolbar.cpp, src/ui/toolbar/page-toolbar.h, share/ui/toolbar-page.ui
/*
 * Page aux toolbar: Temp until we convert all toolbars to ui files with Gio::Actions.
 *
 * Authors:
 *   Martin Owens <doctormo@geek-2.com>
 *
 * Copyright (C) 2021 Tavmjong Bah
 */
import {
  _,
  BoxSide,
  C_,
  convertUnit,
  DocumentUndo,
  PAGE_SIZES,
  type PaperSize,
  type SPDocument,
  type SPPage,
} from '@inkscape-web/core';
import { InkscapeApplication, type SPDesktop } from '@inkscape-web/editor';
import { useEffect, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import { runAction } from '../../app/actions.ts';
import { iconUrl } from '../icon-loader.ts';
import { SpinButton } from '../widget/spinbutton.tsx';
import { IconButton } from './toolbar.tsx';

/** The label of a preset in the size list: name and size (upstream: the label column of _sizes_list). */
function preset_label(p: PaperSize): string {
  return `${_(p.name)} (${p.width} × ${p.height} ${p.unit})`;
}

/**
 * Convert the parsed sections of a text input into a px value (upstream _unit_to_size).
 * The unit of the other size is used if this one has none, else the display unit.
 */
function unit_to_size(number: string, unit_str: string, backup: string, display_unit: string): number {
  // We always support comma, even if not in that particular locale.
  const value = Number.parseFloat(number.replace(',', '.'));
  // Get the best unit, for example 50x40cm means cm for both
  let unit = unit_str || backup;
  if (unit === '"') unit = 'in';
  if (unit === "'") unit = 'ft';
  // Output is always in px as it's the most useful.
  return convertUnit(value, unit || display_unit, 'px');
}

const ARG = `([0-9]+[\\.,]?[0-9]*|\\.[0-9]+) ?(px|mm|cm|m|in|"|ft|')?`;
const SIZE_REGEX = new RegExp(`^ *${ARG} *([ *Xx×,\\-]) *${ARG} *$`);

/**
 * Parse a typed page size in px: "50cm x 40mm", "20',40\"", "30,4-40.2", or a preset label
 * with the size in parentheses (upstream sizeChanged). Returns null for text it does not
 * understand. This does not support negative values, because pages can not be negatively sized.
 */
export function parse_page_size(
  text: string,
  display_unit: string,
): { width: number; height: number } | null {
  // Remove parens from auto generated names
  const paren = /\(([^)]*)\)/.exec(text);
  if (paren) text = paren[1] ?? '';
  const m = SIZE_REGEX.exec(text);
  if (!m) return null;
  const [, w = '', wu = '', , h = '', hu = ''] = m;
  const width = unit_to_size(w, wu, hu, display_unit);
  const height = unit_to_size(h, hu, wu, display_unit);
  return width > 0 && height > 0 ? { width, height } : null;
}

/**
 * Resize the selected page (the document without pages) to a preset, keeping the
 * orientation, and remember the preset name on the page (upstream sizeChoose).
 */
export function sizeChoose(document: SPDocument, preset: PaperSize): void {
  const pm = document.getPageManager();
  const rect = pm.getSelectedPageRect();
  let width = convertUnit(preset.width, preset.unit, 'px');
  let height = convertUnit(preset.height, preset.unit, 'px');
  // The page orientation is a part of the toolbar widget.
  if (rect.width() > rect.height() !== width > height) [width, height] = [height, width];
  pm.resizeSelectedPage(width, height);
  pm.getSelected()?.setSizeLabel(preset.name);
  DocumentUndo.maybeDone(document, 'page-resize', C_('Undo', 'Resize Page'), 'tool-pages');
}

/** Apply a typed size to the selected page (upstream sizeChanged). Returns false for text it does not understand. */
export function sizeChanged(document: SPDocument, text: string): boolean {
  const preset = PAGE_SIZES.find((p) => text === preset_label(p) || text === _(p.name));
  if (preset) {
    sizeChoose(document, preset);
    return true;
  }
  const size = parse_page_size(text, document.getNamedView().getDisplayUnit());
  if (!size) return false;
  document.getPageManager().resizeSelectedPage(size.width, size.height);
  DocumentUndo.done(document, C_('Undo', 'Set page size'), 'tool-pages');
  return true;
}

/** Set the margins of the selected page from text in the display unit (upstream marginsEdited). */
export function marginsEdited(document: SPDocument, text: string): void {
  // And modification to the margin causes pages to be enabled
  const pm = document.getPageManager();
  pm.enablePages();
  const page = pm.getSelected();
  if (!page) return;
  page.setMargin(text);
  DocumentUndo.maybeDone(document, 'page-margin', C_('Undo', 'Edit page margin'), 'tool-pages');
}

/** Set one margin of the selected page in the display unit (upstream marginSideEdited). */
export function marginSideEdited(document: SPDocument, side: BoxSide, value: number): void {
  const pm = document.getPageManager();
  pm.enablePages();
  const page = pm.getSelected();
  if (!page) return;
  page.setMarginSideText(side, String(value), false);
  DocumentUndo.maybeDone(document, 'page-margin', C_('Undo', 'Edit page margin'), 'tool-pages');
}

/** Set the bleed of the selected page from text in the display unit (upstream bleedsEdited). */
export function bleedsEdited(document: SPDocument, text: string): void {
  // And modifiction to the bleed causes pages to be enabled
  const pm = document.getPageManager();
  pm.enablePages();
  const page = pm.getSelected();
  if (!page) return;
  page.setBleed(text);
  DocumentUndo.maybeDone(document, 'page-bleed', C_('Undo', 'Edit page bleed'), 'tool-pages');
}

/** Set the label of the selected page; empty removes it (upstream labelEdited). */
export function labelEdited(document: SPDocument, text: string): void {
  const page = document.getPageManager().getSelected();
  if (!page) return;
  page.setAttribute('inkscape:label', text || null);
  DocumentUndo.maybeDone(document, 'page-relabel', C_('Undo', 'Relabel Page'), 'tool-pages');
}

/** Re-render on page selection, page changes, document changes and undo steps. */
function usePageUpdates(document: SPDocument): void {
  const [, update] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const pm = document.getPageManager();
    const off = [
      pm.connectPagesChanged(update),
      pm.connectPageSelected(update),
      pm.connectPageModified(update),
      document.modifiedSignal.connect(update),
      document.commitSignal.connect(update),
    ];
    return () => {
      for (const f of off) f();
    };
  }, [document]);
}

/** The state of a boolean action, following its changes. */
function useActionState(name: string): boolean {
  const action = InkscapeApplication.instance().actions.lookup_action(name);
  return useSyncExternalStore(
    (cb) => action?.signal_changed.connect(cb) ?? (() => {}),
    () => action?.get_state() ?? false,
  );
}

/** A text entry that applies on Enter or when it loses the focus, and shows outside changes. */
function Entry(props: {
  value: string;
  placeholder: string;
  tooltip: string;
  disabled?: boolean;
  list?: string;
  className?: string;
  onApply: (text: string) => void;
}) {
  const [text, setText] = useState(props.value);
  useEffect(() => setText(props.value), [props.value]);
  return (
    <input
      className={props.className}
      value={text}
      placeholder={props.placeholder}
      title={props.tooltip}
      aria-label={props.placeholder}
      disabled={props.disabled}
      list={props.list}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text !== props.value) props.onApply(text);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        else if (e.key === 'Escape') {
          setText(props.value);
          e.currentTarget.value = props.value;
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/** The four margin fields and the bleed entry (upstream margin_popover). */
function MarginPopover({ document, page }: { document: SPDocument; page: SPPage | null }) {
  const unit = document.getNamedView().getDisplayUnit();
  const scale = document.getDocumentScale();
  const margin = page?.margin;
  const value = (side: BoxSide) => {
    if (!margin?.isSet()) return 0;
    const len = [margin.top(), margin.right(), margin.bottom(), margin.left()][side];
    return (len?.toValue(unit) ?? 0) * (side & 1 ? scale.x : scale.y);
  };
  const field = (side: BoxSide, label: string) => (
    <SpinButton
      label={label}
      tooltip={label}
      value={value(side)}
      min={0}
      max={1e6}
      step={0.1}
      digits={2}
      suffix={unit}
      onChange={(v) => marginSideEdited(document, side, v)}
    />
  );
  return (
    <div className="snap-popover page-margin-popover" role="dialog" aria-label={_('Margins')}>
      <b>{_('Margins')}</b>
      {field(BoxSide.TOP, _('Top'))}
      {field(BoxSide.RIGHT, _('Right'))}
      {field(BoxSide.BOTTOM, _('Bottom'))}
      {field(BoxSide.LEFT, _('Left'))}
      <div className="spinbutton">
        <span>{_('Page Bleed:')}</span>
        <Entry
          value={page?.getBleedLabel() ?? ''}
          placeholder={_('e.g. 1.2mm 2mm')}
          tooltip={_('Page Bleed:')}
          onApply={(text) => bleedsEdited(document, text)}
        />
      </div>
    </div>
  );
}

/**
 * Controls of the pages tool (share/ui/toolbar-page.ui): new and duplicate page, the page
 * size with presets and orientation, the margins (with the margin and bleed popover), the
 * page order, the page label, delete page and "move objects with page". A button for
 * app.page-fit-to-selection is added after the size.
 * TODO: the search completion of the size presets (a datalist here).
 */
export function PageToolbar({ desktop }: { desktop: SPDesktop }) {
  const document = desktop.getDocument();
  usePageUpdates(document);
  const move_objects = useActionState('doc.page-move-objects');
  const [popover, setPopover] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!popover) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setPopover(false);
    };
    window.document.addEventListener('pointerdown', close);
    return () => window.document.removeEventListener('pointerdown', close);
  }, [popover]);

  const pm = document.getPageManager();
  const page = pm.getSelected();
  // If this is a known size in our list, add the size paren to it.
  let size_label = pm.getSizeLabel(page);
  const preset = PAGE_SIZES.find((p) => _(p.name) === size_label);
  if (preset) size_label = preset_label(preset);
  const box = pm.getSelectedPageRect();
  const multi = pm.hasPrevPage() || pm.hasNextPage();

  return (
    <>
      <IconButton icon="pages-add" tooltip={_('New page')} onClick={() => runAction('win.page-new')} />
      <IconButton
        icon="pages-duplicate"
        tooltip={_('Duplicate page')}
        onClick={() => runAction('win.page-duplicate')}
      />
      <Entry
        className="page-size-entry"
        value={size_label}
        placeholder={_('ex.: 100x100cm')}
        tooltip={_(
          'Type in width & height of a page. (ex.: 15x10cm, 10in x 100mm)\nor choose preset from dropdown.',
        )}
        list="page-toolbar-sizes"
        onApply={(text) => sizeChanged(document, text)}
      />
      <datalist id="page-toolbar-sizes">
        {PAGE_SIZES.map((p) => (
          <option key={p.name} value={preset_label(p)} />
        ))}
      </datalist>
      {box.width() !== box.height() && (
        <IconButton
          icon={box.width() > box.height() ? 'page-landscape' : 'page-portrait'}
          tooltip={_('Change page orientation')}
          onClick={() => {
            pm.changeOrientation();
            DocumentUndo.maybeDone(document, 'page-resize', C_('Undo', 'Resize Page'), 'tool-pages');
          }}
        />
      )}
      <IconButton
        icon="pages-resize"
        tooltip={_('Fit the page to the current selection or the drawing if there is no selection')}
        onClick={() => runAction('app.page-fit-to-selection')}
      />
      <div className="snap-toolbar page-margins" ref={ref}>
        <button
          type="button"
          className="toolbar-button"
          title={_('Open margins dialog')}
          aria-expanded={popover}
          onClick={() => setPopover(!popover)}
        >
          <img src={iconUrl('view-restore')} alt="" width={16} height={16} />
        </button>
        <Entry
          value={page?.getMarginLabel() ?? ''}
          placeholder={_('Margins')}
          tooltip={_("Type in the size or sizes of a page's margins or press the button on the left")}
          onApply={(text) => marginsEdited(document, text)}
        />
        {popover && <MarginPopover document={document} page={page} />}
      </div>
      {multi && (
        <>
          <span className="toolbar-separator" />
          <IconButton
            icon="pages-order-backwards"
            tooltip={_('Reorder backwards')}
            disabled={!pm.hasPrevPage()}
            onClick={() => runAction('doc.page-move-backward')}
          />
          <span title={_('Order of selected page')}>
            {page
              ? _('%1/%2')
                  .replace('%1', String(page.getPagePosition()))
                  .replace('%2', String(pm.getPageCount()))
              : _('1/-')}
          </span>
          <IconButton
            icon="pages-order-forwards"
            tooltip={_('Reorder forwards')}
            disabled={!pm.hasNextPage()}
            onClick={() => runAction('doc.page-move-forward')}
          />
        </>
      )}
      <Entry
        value={page?.label() ?? ''}
        placeholder={page ? page.getDefaultLabel() : _('Single Page Document')}
        tooltip={_('Page label')}
        disabled={!page}
        onApply={(text) => labelEdited(document, text)}
      />
      {multi && (
        <IconButton
          icon="pages-remove"
          tooltip={_('Delete page')}
          onClick={() => runAction('win.page-delete')}
        />
      )}
      <span className="toolbar-separator" />
      <IconButton
        icon="pages-move-toggle"
        tooltip={_('Objects stick to pages')}
        active={move_objects}
        disabled={!multi}
        onClick={() => runAction('doc.page-move-objects')}
      />
    </>
  );
}
