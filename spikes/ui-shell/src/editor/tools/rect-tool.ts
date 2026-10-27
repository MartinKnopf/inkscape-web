// Upstream: src/ui/tools/rect-tool.cpp
import type { SPDesktop, Tool } from '../desktop';
import type { XmlNode } from '../../core/xml/node';

export class RectTool implements Tool {
  readonly id = 'rect';
  private start: DOMPoint | null = null;
  private rect: XmlNode | null = null;

  constructor(private desktop: SPDesktop) {}

  pointerDown(_e: PointerEvent, p: DOMPoint): void {
    this.start = p;
  }

  pointerMove(_e: PointerEvent, p: DOMPoint): void {
    if (!this.start) return;
    if (!this.rect) {
      this.rect = this.desktop.doc.createElement('rect');
      this.rect.setAttribute('style', 'fill:#3584e4;stroke:#1c4a80;stroke-width:2');
      this.desktop.currentLayer().appendChild(this.rect);
    }
    const s = this.start;
    this.rect.setAttribute('x', fmt(Math.min(s.x, p.x)));
    this.rect.setAttribute('y', fmt(Math.min(s.y, p.y)));
    this.rect.setAttribute('width', fmt(Math.abs(p.x - s.x)));
    this.rect.setAttribute('height', fmt(Math.abs(p.y - s.y)));
  }

  pointerUp(): void {
    if (this.rect) {
      this.desktop.doc.done('Create rectangle');
      this.desktop.select([this.rect]);
    }
    this.start = null;
    this.rect = null;
  }
}

const fmt = (n: number) => String(Math.round(n * 1000) / 1000);
