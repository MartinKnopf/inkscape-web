// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/implementation/script.cpp
// The script runner of the web app: runs the Python extensions in the Pyodide worker. The
// worker starts on the first run, so Pyodide only loads when an extension is used.
import type { ScriptCommand, ScriptResult, ScriptRunner } from '@inkscape-web/editor';
import type { RunRequest, WorkerMessage } from './pyodide-worker.ts';

export class PyodideRunner implements ScriptRunner {
  #worker: Worker | null = null;
  #next = 1;
  readonly #pending = new Map<number, (result: ScriptResult) => void>();
  /** Called with the loading state of Python ("" when it is ready). */
  on_status: ((text: string) => void) | null = null;

  #start(): Worker {
    if (this.#worker) return this.#worker;
    const worker = new Worker(new URL('./pyodide-worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const msg = event.data;
      if ('status' in msg) {
        this.on_status?.(msg.status);
        return;
      }
      const resolve = this.#pending.get(msg.id);
      this.#pending.delete(msg.id);
      resolve?.(msg.error ? { stdout: msg.stdout, stderr: msg.stderr, error: msg.error } : msg);
    };
    worker.onerror = (event) => {
      for (const resolve of this.#pending.values())
        resolve({
          stdout: new Uint8Array(),
          stderr: '',
          error: event.message || 'The Python worker failed.',
        });
      this.#pending.clear();
      this.#worker = null;
    };
    this.#worker = worker;
    return worker;
  }

  execute(
    command: ScriptCommand,
    params: readonly string[],
    input: Uint8Array | null,
    env: Readonly<Record<string, string>>,
  ): Promise<ScriptResult> {
    if (command.interpreter && command.interpreter !== 'python') {
      return Promise.resolve({
        stdout: new Uint8Array(),
        stderr: '',
        error: `The interpreter "${command.interpreter}" is not available in the browser.`,
      });
    }
    const worker = this.#start();
    const id = this.#next++;
    const req: RunRequest = { id, script: command.script, params: [...params], input, env: { ...env } };
    return new Promise((resolve) => {
      this.#pending.set(id, resolve);
      worker.postMessage(req);
    });
  }
}
