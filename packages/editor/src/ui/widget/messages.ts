// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/widget/messages.cpp, src/ui/widget/messages.h
/*
 * A dialog widget to show log messages.
 *
 * Authors:
 *   Bob Jamison
 *   Other dudes from The Inkscape Organization
 *
 * Copyright (C) 2004, 2005 Authors
 */
import { _, Signal } from '@inkscape-web/core';

const METHODS = ['error', 'warn', 'info', 'log', 'debug'] as const;
type Saved = Partial<Record<(typeof METHODS)[number], (...args: unknown[]) => void>>;

/**
 * The log of the Messages tab of the debug dialog. Capturing redirects the messages that the
 * application writes to the console (upstream: g_log() messages) into the log.
 */
export class Messages {
  readonly lines: string[] = [];
  /** Emitted when the lines change. */
  readonly changed = new Signal<[]>();
  #saved: Saved | null = null;
  #onError: ((e: ErrorEvent) => void) | null = null;

  constructor() {
    this.message(_('Ready.'));
  }

  /** Remove all text from the log. */
  clear(): void {
    this.lines.length = 0;
    this.changed.emit();
  }

  /** Display a message. */
  message(msg: string): void {
    this.lines.push(msg.endsWith('\n') ? msg.slice(0, -1) : msg);
    this.changed.emit();
  }

  get capturing(): boolean {
    return this.#saved !== null;
  }

  /** Redirect the console messages (and the uncaught errors) to the log; they still reach the console. */
  captureLogMessages(): void {
    if (this.#saved) return;
    const saved: Saved = {};
    for (const name of METHODS) {
      const original = console[name].bind(console) as (...args: unknown[]) => void;
      saved[name] = console[name];
      console[name] = (...args: unknown[]) => {
        original(...args);
        this.message(args.map((a) => (typeof a === 'string' ? a : safeString(a))).join(' '));
      };
    }
    this.#saved = saved;
    if (typeof window !== 'undefined') {
      this.#onError = (e) => this.message(e.message);
      window.addEventListener('error', this.#onError);
    }
    this.message(_('Log capture started.'));
  }

  /** Return the console messages to normal handling. */
  releaseLogMessages(): void {
    if (!this.#saved) return;
    for (const name of METHODS) {
      const original = this.#saved[name];
      if (original) console[name] = original;
    }
    this.#saved = null;
    if (this.#onError) window.removeEventListener('error', this.#onError);
    this.#onError = null;
    this.message(_('Log capture stopped.'));
  }

  toggleCapture(): void {
    if (this.capturing) this.releaseLogMessages();
    else this.captureLogMessages();
  }
}

function safeString(value: unknown): string {
  if (value instanceof Error) return value.message;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
