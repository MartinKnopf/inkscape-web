// SPDX-License-Identifier: GPL-2.0-or-later
// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AboutDialogHost, REPOSITORY_URL, show_about } from './about.tsx';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Ada Lovelace\nAlan Turing\n'));
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(createElement(AboutDialogHost)));
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('AboutDialogHost', () => {
  it('names the port, links the repository and lists the upstream authors', async () => {
    await act(async () => show_about());
    const dialog = document.querySelector('.about-dialog')!;
    expect(dialog.textContent).toContain('port of Inkscape');
    expect(dialog.querySelector(`a[href="${REPOSITORY_URL}"]`)).not.toBeNull();
    expect(fetch).toHaveBeenCalledWith('/AUTHORS');
    const names = [...dialog.querySelectorAll('.about-authors li')].map((li) => li.textContent);
    expect(names.sort()).toEqual(['Ada Lovelace', 'Alan Turing']);

    act(() => dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.querySelector('.about-dialog')).toBeNull();
  });
});
