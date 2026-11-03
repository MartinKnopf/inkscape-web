// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/implementation/script.cpp
/*
 * Authors:
 *   Bryce Harrington <bryce@osdl.org>
 *   Ted Gould <ted@gould.cx>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *
 * Copyright (C) 2002-2007 Authors
 */
// The Python interpreter of the extensions (upstream Script::execute spawns python): a Web
// Worker with Pyodide. The first run loads Pyodide, the Python packages of inkex and
// share/extensions (extensions.zip) into /share/extensions. Each run writes the input as a
// temporary file, runs the script with upstream's argv and returns stdout and stderr.

/** The version of Pyodide; its packages come from the same CDN folder. */
const PYODIDE_URL = 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/';
/** The folder of the extensions in the Pyodide file system (= the URL path of the assets). */
const EXTENSIONS_DIR = '/share/extensions';
/** The Python packages of inkex (share/extensions/pyproject.toml) that Pyodide provides. */
const PYODIDE_PACKAGES = [
  'micropip',
  'lxml',
  'numpy',
  'pillow',
  'pyparsing',
  'packaging',
  'cssselect',
  'six',
];
/** The pure Python packages that are not in Pyodide; micropip installs them from PyPI. scour has no wheel (only a source package), so the Optimized SVG output does not work. */
const PYPI_PACKAGES = ['tinycss2'];

export interface RunRequest {
  id: number;
  script: string;
  params: string[];
  input: Uint8Array | null;
  env: Record<string, string>;
}
export type WorkerMessage =
  | { id: number; stdout: Uint8Array; stderr: string; error?: string }
  | { status: string };

interface PyProxy {
  toJs(): unknown;
  destroy(): void;
}
interface Pyodide {
  loadPackage(names: string[]): Promise<void>;
  pyimport(name: string): { install(names: string[]): Promise<void> };
  unpackArchive(buffer: ArrayBuffer, format: string, options: { extractDir: string }): void;
  runPython(code: string): unknown;
  globals: { get(name: string): (...args: unknown[]) => PyProxy };
  FS: {
    writeFile(path: string, data: Uint8Array): void;
    unlink(path: string): void;
    mkdirTree(path: string): void;
  };
  toPy(value: unknown): unknown;
}

/** Runs a script like the python executable: script directory first in sys.path, cwd there. */
const RUNNER_PY = `
import io, os, runpy, sys, traceback, warnings

# Pyodide has a newer pyparsing than the extensions are written for; its deprecation warnings
# would show as script errors.
warnings.filterwarnings("ignore", message=".*deprecated - use")

sys.path.insert(0, ${JSON.stringify(EXTENSIONS_DIR)})

def _ink_run(script, argv, env):
    script_dir = os.path.dirname(script)
    os.chdir(script_dir)
    os.environ.update(dict(env))
    sys.argv = [os.path.basename(script)] + list(argv)
    sys.path.insert(0, script_dir)
    out = io.BytesIO()
    err = io.StringIO()
    stdout = io.TextIOWrapper(out, encoding="utf-8", write_through=True)
    old = sys.stdout, sys.stderr
    sys.stdout, sys.stderr = stdout, err
    try:
        runpy.run_path(script, run_name="__main__")
    except SystemExit as e:
        if e.code not in (None, 0) and not isinstance(e.code, int):
            print(e.code, file=err)
    except BaseException:
        traceback.print_exc(file=err)
    finally:
        try:
            stdout.flush()
        except Exception:
            pass
        sys.stdout, sys.stderr = old
        sys.path.remove(script_dir)
    return [out.getvalue(), err.getvalue()]
`;

let pyodide: Promise<Pyodide> | null = null;

function status(text: string): void {
  postMessage({ status: text } satisfies WorkerMessage);
}

async function load(): Promise<Pyodide> {
  status('Loading Python...');
  const mod = (await import(/* @vite-ignore */ `${PYODIDE_URL}pyodide.mjs`)) as {
    loadPyodide(options: { indexURL: string }): Promise<Pyodide>;
  };
  const py = await mod.loadPyodide({ indexURL: PYODIDE_URL });
  status('Loading Python packages...');
  await py.loadPackage(PYODIDE_PACKAGES);
  await py.pyimport('micropip').install(PYPI_PACKAGES);
  status('Loading extensions...');
  const zip = await fetch(`${EXTENSIONS_DIR}/extensions.zip`);
  if (!zip.ok) throw new Error(`${EXTENSIONS_DIR}/extensions.zip: ${zip.status}`);
  py.FS.mkdirTree(EXTENSIONS_DIR);
  py.unpackArchive(await zip.arrayBuffer(), 'zip', { extractDir: EXTENSIONS_DIR });
  py.runPython(RUNNER_PY);
  status('');
  return py;
}

async function run(req: RunRequest): Promise<WorkerMessage> {
  pyodide ??= load();
  let py: Pyodide;
  try {
    py = await pyodide;
  } catch (e) {
    pyodide = null;
    return { id: req.id, stdout: new Uint8Array(), stderr: '', error: `Could not load Python: ${String(e)}` };
  }
  const argv = [...req.params];
  let tempfile: string | null = null;
  if (req.input) {
    tempfile = `/tmp/ink_ext_${Math.random().toString(36).slice(2, 8)}.svg`;
    py.FS.writeFile(tempfile, req.input);
    argv.push(tempfile);
  }
  try {
    const result = py.globals.get('_ink_run')(req.script, py.toPy(argv), py.toPy(req.env));
    const [stdout, stderr] = result.toJs() as [Uint8Array | { toJs(): Uint8Array }, string];
    result.destroy();
    const bytes = stdout instanceof Uint8Array ? stdout : stdout.toJs();
    return { id: req.id, stdout: bytes, stderr };
  } catch (e) {
    return { id: req.id, stdout: new Uint8Array(), stderr: '', error: String(e) };
  } finally {
    if (tempfile) py.FS.unlink(tempfile);
  }
}

// The runs are serial: Python has one sys.argv and one working directory.
let queue: Promise<unknown> = Promise.resolve();
self.onmessage = (event: MessageEvent<RunRequest>) => {
  const req = event.data;
  queue = queue.then(async () => postMessage(await run(req)));
};
