// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/xml/event.cpp, src/xml/event.h, src/xml/event-fns.h, src/xml/log-builder.cpp, src/xml/log-builder.h
/*
 * Authors:
 *   Unknown author(s)
 *   MenTaLguY <mental@rydia.net>
 *
 * Copyright 2003-2008 Authors
 */
import type { Node } from './node.ts';
import type { NodeObserver } from './node-observer.ts';

/** One recorded change of the repr tree. `ref`/`prev` is the sibling before the child. */
export type Event =
  | { kind: 'add'; repr: Node; child: Node; ref: Node | null }
  | { kind: 'del'; repr: Node; child: Node; ref: Node | null }
  | { kind: 'chgAttr'; repr: Node; key: string; oldValue: string | null; newValue: string | null }
  | { kind: 'chgContent'; repr: Node; oldContent: string | null; newContent: string | null }
  | { kind: 'chgOrder'; repr: Node; child: Node; oldRef: Node | null; newRef: Node | null }
  | { kind: 'chgElementName'; repr: Node; oldName: string; newName: string };

/** A change log, oldest event first. */
export type EventLog = readonly Event[];

/** Revert the changes of log (newest first). */
export function undoLog(log: EventLog): void {
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i]!;
    switch (e.kind) {
      case 'add':
        e.repr.removeChild(e.child);
        break;
      case 'del':
        e.repr.addChild(e.child, e.ref);
        break;
      case 'chgAttr':
        e.repr.setAttribute(e.key, e.oldValue);
        break;
      case 'chgContent':
        e.repr.setContent(e.oldContent);
        break;
      case 'chgOrder':
        e.repr.changeOrder(e.child, e.oldRef);
        break;
      case 'chgElementName':
        e.repr.setCodeUnsafe(e.oldName);
        break;
    }
  }
}

/** Apply the changes of log again (oldest first). */
export function replayLog(log: EventLog): void {
  for (const e of log) {
    switch (e.kind) {
      case 'add':
        e.repr.addChild(e.child, e.ref);
        break;
      case 'del':
        e.repr.removeChild(e.child);
        break;
      case 'chgAttr':
        e.repr.setAttribute(e.key, e.newValue);
        break;
      case 'chgContent':
        e.repr.setContent(e.newContent);
        break;
      case 'chgOrder':
        e.repr.changeOrder(e.child, e.newRef);
        break;
      case 'chgElementName':
        e.repr.setCodeUnsafe(e.newName);
        break;
    }
  }
}

/** Send the events of log to observer, as if the changes happened now (used by the XML editor and undo). */
export function replayLogToObserver(log: EventLog, observer: NodeObserver): void {
  for (const e of log) {
    switch (e.kind) {
      case 'add':
        observer.notifyChildAdded?.(e.repr, e.child, e.ref);
        break;
      case 'del':
        observer.notifyChildRemoved?.(e.repr, e.child, e.ref);
        break;
      case 'chgAttr':
        observer.notifyAttributeChanged?.(e.repr, e.key, e.oldValue, e.newValue);
        break;
      case 'chgContent':
        observer.notifyContentChanged?.(e.repr, e.oldContent, e.newContent);
        break;
      case 'chgOrder':
        observer.notifyChildOrderChanged?.(e.repr, e.child, e.oldRef, e.newRef);
        break;
      case 'chgElementName':
        observer.notifyElementNameChanged?.(e.repr, e.oldName, e.newName);
        break;
    }
  }
}

/** Collects events while a transaction is open (upstream LogBuilder). */
export class LogBuilder implements NodeObserver {
  #log: Event[] = [];

  /** Return the collected events and start a new log. */
  detach(): Event[] {
    const log = this.#log;
    this.#log = [];
    return log;
  }
  discard(): void {
    this.#log = [];
  }

  notifyChildAdded(repr: Node, child: Node, ref: Node | null): void {
    this.#log.push({ kind: 'add', repr, child, ref });
  }
  notifyChildRemoved(repr: Node, child: Node, ref: Node | null): void {
    this.#log.push({ kind: 'del', repr, child, ref });
  }
  notifyChildOrderChanged(repr: Node, child: Node, oldRef: Node | null, newRef: Node | null): void {
    this.#log.push({ kind: 'chgOrder', repr, child, oldRef, newRef });
  }
  notifyContentChanged(repr: Node, oldContent: string | null, newContent: string | null): void {
    this.#log.push({ kind: 'chgContent', repr, oldContent, newContent });
  }
  notifyAttributeChanged(repr: Node, key: string, oldValue: string | null, newValue: string | null): void {
    this.#log.push({ kind: 'chgAttr', repr, key, oldValue, newValue });
  }
  notifyElementNameChanged(repr: Node, oldName: string, newName: string): void {
    this.#log.push({ kind: 'chgElementName', repr, oldName, newName });
  }
}
