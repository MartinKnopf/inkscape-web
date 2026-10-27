// Spike app shell: React UI around the (React-free) desktop.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { DockviewReact, type DockviewReadyEvent, type IDockviewPanelProps } from 'dockview-react';
import 'dockview-react/dist/styles/dockview.css';
import { SPDocument, type Emitter } from '../core/document';
import type { XmlNode } from '../core/xml/node';
import { SPDesktop } from '../editor/desktop';

const BLANK = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="210mm" height="297mm" viewBox="0 0 210 297"><g inkscape:groupmode="layer" inkscape:label="Layer 1" id="layer1"/></svg>`;

export const desktop = new SPDesktop(new SPDocument(BLANK));
(window as any).desktop = desktop;

/** Re-render when an emitter fires. */
function useEmitter(e: Emitter): number {
  return useSyncExternalStore(e.subscribe, () => e.version);
}

/** Re-render when the desktop's document changes (also after "open"). */
function useDocument(): SPDocument {
  const [doc, setDoc] = useState(desktop.doc);
  useEffect(() => desktop.selectionChanged.subscribe(() => setDoc(desktop.doc)), []);
  useEmitter(doc.changed);
  return doc;
}

async function openExample(name: string) {
  const t0 = performance.now();
  const res = await fetch(`/${name}`);
  const text = await new Response(res.body!.pipeThrough(new DecompressionStream('gzip'))).text();
  const t1 = performance.now();
  const doc = new SPDocument(text);
  const t2 = performance.now();
  desktop.setDocument(doc);
  await new Promise(requestAnimationFrame);
  const t3 = performance.now();
  const count = countNodes(doc.root);
  const perf = { name, nodes: count, fetchMs: t1 - t0, parseMs: t2 - t1, displayMs: t3 - t2 };
  console.log('open', perf);
  (window as any).__lastOpen = perf;
}

const countNodes = (n: XmlNode): number => 1 + n.children.reduce((s, c) => s + countNodes(c), 0);

function CanvasPanel() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current!.append(desktop.host);
    return () => desktop.host.remove();
  }, []);
  return <div ref={ref} style={{ position: 'relative', width: '100%', height: '100%' }} />;
}

function XmlEditorPanel() {
  const doc = useDocument();
  useEmitter(desktop.selectionChanged);
  const selected = [...desktop.selection][0] ?? null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', font: '12px monospace' }}>
      <div style={{ flex: 1, overflow: 'auto', padding: 4 }}>
        <TreeNode node={doc.root} depth={0} selected={selected} />
      </div>
      {selected && <AttributeList node={selected} doc={doc} />}
    </div>
  );
}

function TreeNode({ node, depth, selected }: { node: XmlNode; depth: number; selected: XmlNode | null }) {
  const [open, setOpen] = useState(depth < 2);
  if (node.type !== 'element') return null;
  const kids = node.children.filter((c) => c.type === 'element');
  return (
    <div>
      <div
        style={{ paddingLeft: depth * 12, background: node === selected ? '#cde' : undefined, cursor: 'default' }}
        onClick={() => desktop.select([node])}
      >
        <span onClick={(e) => (e.stopPropagation(), setOpen(!open))} style={{ display: 'inline-block', width: 12 }}>
          {kids.length ? (open ? '▾' : '▸') : ''}
        </span>
        &lt;{node.name}
        {node.attribute('id') ? ` id="${node.attribute('id')}"` : ''}&gt;
      </div>
      {open && kids.map((c) => <TreeNode key={c.uid} node={c} depth={depth + 1} selected={selected} />)}
    </div>
  );
}

function AttributeList({ node, doc }: { node: XmlNode; doc: SPDocument }) {
  return (
    <table style={{ borderTop: '1px solid #ccc', maxHeight: '40%', overflow: 'auto', display: 'block' }}>
      <tbody>
        {node.attributeList().map(([k, v]) => (
          <tr key={k}>
            <td style={{ color: '#666' }}>{k}</td>
            <td>
              <input
                key={v}
                defaultValue={v}
                style={{ width: '100%', font: 'inherit' }}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  node.setAttribute(k, e.currentTarget.value);
                  doc.done('Change attribute');
                }}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function HistoryPanel() {
  const doc = useDocument();
  return (
    <ol style={{ font: '12px sans-serif', margin: 4 }}>
      {doc.undoStack.map((s, i) => <li key={i}>{s.description}</li>)}
      {[...doc.redoStack].reverse().map((s, i) => <li key={'r' + i} style={{ color: '#aaa' }}>{s.description}</li>)}
    </ol>
  );
}

const components = { canvas: CanvasPanel, xml: XmlEditorPanel, history: HistoryPanel } satisfies Record<
  string,
  React.FunctionComponent<IDockviewPanelProps>
>;

function onReady(e: DockviewReadyEvent) {
  e.api.addPanel({ id: 'canvas', component: 'canvas', title: 'Drawing' });
  e.api.addPanel({ id: 'xml', component: 'xml', title: 'XML Editor', position: { direction: 'right' }, initialWidth: 360 });
  e.api.addPanel({ id: 'history', component: 'history', title: 'Undo History', position: { referencePanel: 'xml' } });
  e.api.getPanel('xml')!.api.setActive();
}

function Toolbox() {
  useEmitter(desktop.toolChanged);
  const btn = (id: 'select' | 'rect', label: string) => (
    <button
      onClick={() => desktop.setTool(id)}
      style={{ display: 'block', width: 40, height: 40, background: desktop.tool.id === id ? '#cde' : undefined }}
      title={id}
    >
      {label}
    </button>
  );
  return <div style={{ padding: 4, borderRight: '1px solid #ccc' }}>{btn('select', '↖')}{btn('rect', '▭')}</div>;
}

export function App() {
  useEffect(() => {
    // Shortcut ids follow upstream actions (app.undo / app.redo).
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      e.preventDefault();
      if (e.shiftKey) desktop.doc.redo();
      else desktop.doc.undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div style={{ padding: 4, borderBottom: '1px solid #ccc', font: '13px sans-serif' }}>
        Open:{' '}
        {['tiger.svgz', 'car.svgz', 'gallardo.svgz'].map((n) => (
          <button key={n} onClick={() => openExample(n)}>{n}</button>
        ))}
      </div>
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <Toolbox />
        <DockviewReact className="dockview-theme-light" components={components} onReady={onReady} />
      </div>
    </div>
  );
}
