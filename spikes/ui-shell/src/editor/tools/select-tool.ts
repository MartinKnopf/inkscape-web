// Upstream: src/ui/tools/select-tool.cpp
// Spike: click selects the top-level item under the pointer; drag moves it.
import type { SPDesktop, Tool } from '../desktop';
import type { XmlNode } from '../../core/xml/node';

export class SelectTool implements Tool {
  readonly id = 'select';
  private drag: { from: DOMPoint; items: [XmlNode, string | null][] } | null = null;

  constructor(private desktop: SPDesktop) {}

  pointerDown(e: PointerEvent, p: DOMPoint): void {
    const item = this.pick(e);
    this.desktop.select(item ? [item] : []);
    if (item) this.drag = { from: p, items: [[item, item.attribute('transform')]] };
  }

  pointerMove(_e: PointerEvent, p: DOMPoint): void {
    if (!this.drag) return;
    const dx = p.x - this.drag.from.x, dy = p.y - this.drag.from.y;
    for (const [item, t] of this.drag.items) {
      item.setAttribute('transform', `translate(${dx},${dy})${t ? ' ' + t : ''}`);
    }
    this.desktop.updateOverlay();
  }

  pointerUp(_e: PointerEvent, p: DOMPoint): void {
    if (this.drag && (p.x !== this.drag.from.x || p.y !== this.drag.from.y)) {
      this.desktop.doc.done('Move');
    }
    this.drag = null;
  }

  /** Hit test with the browser, then walk up to the child of the current layer. */
  private pick(e: PointerEvent): XmlNode | null {
    const shadow = this.desktop.host.shadowRoot!;
    const layer = this.desktop.currentLayer();
    for (const el of shadow.elementsFromPoint(e.clientX, e.clientY)) {
      let n = this.desktop.display.reprOf.get(el) ?? null;
      while (n && n.parent && n.parent !== layer) n = n.parent;
      if (n && n.parent === layer) return n;
    }
    return null;
  }
}
