// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/desktop/document-check.cpp
// A modal question with buttons (upstream Gtk::MessageDialog), as used by the data loss check.
import { Signal } from '@inkscape-web/core';
import { useSyncExternalStore } from 'react';

export interface MessageButton<T extends string> {
  /** The answer when the button is pressed. */
  id: T;
  /** Label with the mnemonic marker "_" of upstream. */
  label: string;
}

interface MessageRequest {
  title: string;
  message: string;
  buttons: readonly MessageButton<string>[];
  /** The answer for Escape. */
  cancel: string;
  /** The button that is focused first. */
  default: string;
  resolve: (answer: string) => void;
}

let current: MessageRequest | null = null;
const queue: MessageRequest[] = [];
const changed = new Signal<[]>();

function next(): void {
  current = queue.shift() ?? null;
  changed.emit();
}

/**
 * Ask the user and resolve with the id of the pressed button. Questions that
 * come while one is open wait for their turn.
 */
export function showMessageDialog<T extends string>(options: {
  title: string;
  message: string;
  buttons: readonly MessageButton<T>[];
  /** The answer for Escape. */
  cancel: T;
  /** The button that is focused first. */
  default: T;
}): Promise<T> {
  return new Promise<T>((resolve) => {
    queue.push({ ...options, resolve: (answer) => resolve(answer as T) });
    if (!current) next();
  });
}

function answer(request: MessageRequest, id: string): void {
  request.resolve(id);
  next();
}

/** Shows the question that showMessageDialog asked. Render once in the app. */
export function MessageDialogHost() {
  const request = useSyncExternalStore(
    (cb) => changed.connect(cb),
    () => current,
  );
  if (!request) return null;
  return (
    <div className="guide-dialog-backdrop">
      <div
        className="guide-dialog message-dialog"
        role="alertdialog"
        aria-label={request.title}
        onKeyDown={(e) => {
          if (e.key === 'Escape') answer(request, request.cancel);
        }}
      >
        <h3>{request.title}</h3>
        {/* As upstream, the first paragraph is bold. */}
        {request.message.split('\n\n').map((text, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the paragraphs do not change
          <p key={i}>{i === 0 ? <strong>{text}</strong> : text}</p>
        ))}
        <div className="guide-dialog-buttons">
          {request.buttons.map((b) => (
            <button
              type="button"
              key={b.id}
              ref={b.id === request.default ? (el) => el?.focus() : undefined}
              onClick={() => answer(request, b.id)}
            >
              {b.label.replace('_', '')}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
