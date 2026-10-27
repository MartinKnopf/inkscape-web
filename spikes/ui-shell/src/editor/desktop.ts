// Upstream: src/desktop.cpp, src/selection.cpp, src/ui/widget/canvas.cpp (roles only)
// Spike desktop: one document, a selection, the current tool, and a canvas
// (shadow DOM with the drawing + an overlay for controls). No React here.
import { SPDocument, Emitter } from '../core/document';
import type { XmlNode } from '../core/xml/node';
import { DisplayMirror } from './display';
import { SelectTool } from './tools/select-tool';
import { RectTool } from './tools/rect-tool';

export interface Tool {
  readonly id: string;
  pointerDown?(e: PointerEvent, p: DOMPoint): void;
  pointerMove?(e: PointerEvent, p: DOMPoint): void;
  pointerUp?(e: PointerEvent, p: DOMPoint): void;
}

export class SPDesktop {
  readonly selection = new Set<XmlNode>();
  readonly selectionChanged = new Emitter();
  readonly toolChanged = new Emitter();
  tool: Tool = new SelectTool(this);
  display: DisplayMirror;
  readonly host = document.createElement('div');
  readonly overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  private readonly viewport = document.createElement('div');
  zoom = 1;
  pan = { x: 20, y: 20 };

  constructor(public doc: SPDocument) {
    this.host.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#e8e8e8;touch-action:none';
    // Shadow DOM: document <style> rules cannot leak into the app UI (and back).
    const shadow = this.host.attachShadow({ mode: 'open' });
    this.viewport.style.cssText = 'position:absolute;left:0;top:0;transform-origin:0 0;background:white;box-shadow:0 0 4px #0004';
    this.overlay.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible';
    shadow.append(this.viewport, this.overlay);
    this.display = new DisplayMirror(doc.root);
    this.viewport.append(this.display.rootElement);
    this.applyView();
    this.host.addEventListener('pointerdown', (e) => {
      this.host.setPointerCapture(e.pointerId);
      this.tool.pointerDown?.(e, this.toDoc(e));
    });
    this.host.addEventListener('pointermove', (e) => this.tool.pointerMove?.(e, this.toDoc(e)));
    this.host.addEventListener('pointerup', (e) => this.tool.pointerUp?.(e, this.toDoc(e)));
    this.host.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    doc.changed.subscribe(() => this.updateOverlay());
  }

  setDocument(doc: SPDocument): void {
    this.doc = doc;
    this.selection.clear();
    this.display = new DisplayMirror(doc.root);
    this.viewport.replaceChildren(this.display.rootElement);
    doc.changed.subscribe(() => this.updateOverlay());
    this.selectionChanged.emit();
    this.updateOverlay();
  }

  setTool(id: 'select' | 'rect'): void {
    this.tool = id === 'rect' ? new RectTool(this) : new SelectTool(this);
    this.toolChanged.emit();
  }

  select(nodes: XmlNode[]): void {
    this.selection.clear();
    for (const n of nodes) this.selection.add(n);
    this.selectionChanged.emit();
    this.updateOverlay();
  }

  /** Screen point → document user units. */
  toDoc(e: { clientX: number; clientY: number }): DOMPoint {
    const m = this.display.rootElement.getScreenCTM()!.inverse();
    return new DOMPoint(e.clientX, e.clientY).matrixTransform(m);
  }

  /** Top-level layer or the root svg, as upstream's "current layer". */
  currentLayer(): XmlNode {
    const root = this.doc.root;
    const layers = root.children.filter((c) => c.name === 'g' && c.attribute('inkscape:groupmode') === 'layer');
    return layers.at(-1) ?? root;
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const r = this.host.getBoundingClientRect();
      const f = Math.exp(-e.deltaY * 0.01);
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      this.pan.x = sx - (sx - this.pan.x) * f;
      this.pan.y = sy - (sy - this.pan.y) * f;
      this.zoom *= f;
    } else {
      this.pan.x -= e.deltaX;
      this.pan.y -= e.deltaY;
    }
    this.applyView();
  }

  applyView(): void {
    this.viewport.style.transform = `translate(${this.pan.x}px,${this.pan.y}px) scale(${this.zoom})`;
    this.updateOverlay();
  }

  /** Draw selection bounding boxes in screen space (upstream: CanvasItemRect). */
  updateOverlay(): void {
    const host = this.host.getBoundingClientRect();
    this.overlay.replaceChildren();
    for (const n of this.selection) {
      const el = this.display.domOf(n) as SVGGraphicsElement | undefined;
      if (!el?.isConnected) continue;
      const r = el.getBoundingClientRect();
      const box = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      box.setAttribute('x', String(r.left - host.left));
      box.setAttribute('y', String(r.top - host.top));
      box.setAttribute('width', String(r.width));
      box.setAttribute('height', String(r.height));
      box.setAttribute('fill', 'none');
      box.setAttribute('stroke', '#000');
      box.setAttribute('stroke-dasharray', '4 4');
      this.overlay.append(box);
    }
  }
}
