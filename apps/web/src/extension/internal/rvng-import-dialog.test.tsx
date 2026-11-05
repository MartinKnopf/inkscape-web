// SPDX-License-Identifier: GPL-2.0-or-later
// @vitest-environment happy-dom
import { RvngImportDialog } from '@inkscape-web/editor';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RvngImportDialogHost } from './rvng-import-dialog.tsx';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PAGE = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>';
const show = (pages = [PAGE, PAGE]) => RvngImportDialog.show_dialog!(new RvngImportDialog(pages));

let root: Root;
beforeEach(() => {
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(createElement(RvngImportDialogHost)));
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('RvngImportDialogHost', () => {
  it('is modal: keys stay in the dialog and Escape (cancel) closes it', async () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal');
    let result!: Promise<boolean>;
    act(() => {
      result = show();
    });
    const dialog = document.querySelector('dialog')!;
    expect(showModal).toHaveBeenCalled();
    expect(dialog.open).toBe(true);

    const shortcut = vi.fn();
    window.addEventListener('keydown', shortcut);
    dialog.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }));
    window.removeEventListener('keydown', shortcut);
    expect(shortcut).not.toHaveBeenCalled();

    act(() => {
      dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    });
    expect(await result).toBe(false);
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('cancels the earlier request when a new one arrives', async () => {
    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    act(() => {
      first = show();
    });
    act(() => {
      second = show();
    });
    expect(await first).toBe(false);
    const ok = [...document.querySelectorAll('button')].find((b) => b.textContent === 'OK')!;
    act(() => ok.click());
    expect(await second).toBe(true);
  });
});
