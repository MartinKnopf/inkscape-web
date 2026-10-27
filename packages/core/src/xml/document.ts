// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/xml/document.h, src/xml/simple-document.cpp, src/xml/simple-document.h
/*
 * Authors:
 *   MenTaLguY <mental@rydia.net>
 *
 * Copyright 2004-2005 MenTaLguY
 */
import { type Event, LogBuilder, undoLog } from './event.ts';
import { Node } from './node.ts';
import type { NodeObserver } from './node-observer.ts';

const noLog: NodeObserver = {};

/**
 * The top node of a repr tree (upstream Inkscape::XML::SimpleDocument). Creates
 * nodes, and records changes while a transaction is open.
 */
export class XmlDocument extends Node {
  #inTransaction = false;
  #logBuilder = new LogBuilder();

  constructor() {
    super('document', 'xml', null, null);
  }

  inTransaction(): boolean {
    return this.#inTransaction;
  }
  beginTransaction(): void {
    if (this.#inTransaction) throw new Error('transaction already open');
    this.#inTransaction = true;
  }
  /** Close the transaction and revert its changes. */
  rollback(): void {
    this.#end();
    undoLog(this.#logBuilder.detach());
  }
  /** Close the transaction and forget its changes. */
  commit(): void {
    this.#end();
    this.#logBuilder.discard();
  }
  /** Close the transaction and return its changes, for undo. */
  commitUndoable(): Event[] {
    this.#end();
    return this.#logBuilder.detach();
  }

  /** Receives all changes in this document. Records them while a transaction is open. */
  logger(): NodeObserver {
    return this.#inTransaction ? this.#logBuilder : noLog;
  }

  createElement(name: string): Node {
    return new Node('element', name, null, this);
  }
  createTextNode(content: string, cdata = false): Node {
    return new Node('text', 'string', content, this, cdata);
  }
  createComment(content: string): Node {
    return new Node('comment', 'comment', content, this);
  }
  createPI(target: string, content: string): Node {
    return new Node('pi', target, content, this);
  }

  #end(): void {
    if (!this.#inTransaction) throw new Error('no open transaction');
    this.#inTransaction = false;
  }
}
