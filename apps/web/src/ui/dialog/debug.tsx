// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/debug.cpp, src/ui/dialog/debug.h, src/ui/widget/messages.cpp, src/ui/widget/memory.cpp
/*
 * A dialog which contains memory information and message logs.
 *
 * Copyright (c) 2024 Kaixo Gamorra, Authors
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { _ } from '@inkscape-web/core';
import { get_heaps, Messages, memory_rows } from '@inkscape-web/editor';
import { useEffect, useReducer, useRef, useState } from 'react';

/** The Memory tab: the heaps of the page, refreshed twice a second (upstream: a 500 ms timer). */
function MemoryTab() {
  const [, update] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const timer = setInterval(update, 500);
    return () => clearInterval(timer);
  }, []);
  const rows = memory_rows(get_heaps());
  return (
    <div className="debug-memory">
      <table>
        <thead>
          <tr>
            <th>{_('Heap')}</th>
            <th>{_('In Use')}</th>
            {/* TRANSLATORS: "Slack" refers to memory which is in the heap but currently unused. */}
            <th>{_('Slack')}</th>
            <th>{_('Total')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td>{r.name}</td>
              <td>{r.used}</td>
              <td>{r.slack}</td>
              <td>{r.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="debug-buttons">
        <button type="button" onClick={update}>
          {_('Recalculate')}
        </button>
      </div>
    </div>
  );
}

/** The Messages tab: the log, with the check box that captures the console messages and the Clear button. */
function MessagesTab() {
  const messages = useRef<Messages | null>(null);
  messages.current ??= new Messages();
  const log = messages.current;
  const [, update] = useReducer((n: number) => n + 1, 0);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const off = log.changed.connect(update);
    return () => {
      off();
      log.releaseLogMessages();
    };
  }, [log]);
  // Show the newest line.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when lines are added
  useEffect(() => end.current?.scrollIntoView?.({ block: 'end' }), [log.lines.length]);
  return (
    <div className="debug-messages">
      <pre className="debug-log" role="log" aria-label={_('Messages')}>
        {log.lines.join('\n')}
        <div ref={end} />
      </pre>
      <div className="debug-buttons">
        <label title={_('Capture log messages')}>
          <input type="checkbox" checked={log.capturing} onChange={() => log.toggleCapture()} />
          {_('Capture log messages')}
        </label>
        <button type="button" title={_('Clear log messages')} onClick={() => log.clear()}>
          {_('_Clear').replace('_', '')}
        </button>
      </div>
    </div>
  );
}

/**
 * The Debugger dialog (dialog key "DebugWindow"): memory use of the page and the log messages.
 * TODO: the GTK inspector button has no counterpart.
 */
export function DebugDialog() {
  const [tab, setTab] = useState<'memory' | 'messages'>('memory');
  return (
    <div className="docprops-tabs debug-dialog">
      <div className="docprops-tabbar" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'memory'} onClick={() => setTab('memory')}>
          Memory
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'messages'}
          onClick={() => setTab('messages')}
        >
          Messages
        </button>
      </div>
      <div className="docprops">{tab === 'memory' ? <MemoryTab /> : <MessagesTab />}</div>
    </div>
  );
}
