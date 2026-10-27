// Upstream: src/xml/node.h, src/xml/node-observer.h, src/xml/simple-node.cpp
// Spike version of the XML repr tree. Every mutation notifies observers and
// is written to the document's event log (for undo).

export interface NodeObserver {
  notifyChildAdded?(node: XmlNode, child: XmlNode, prev: XmlNode | null): void;
  notifyChildRemoved?(node: XmlNode, child: XmlNode, prev: XmlNode | null): void;
  notifyAttributeChanged?(node: XmlNode, name: string, oldValue: string | null, newValue: string | null): void;
  notifyContentChanged?(node: XmlNode, oldContent: string, newContent: string): void;
}

/** One reversible mutation. The undo system stores lists of these. */
export type XmlEvent =
  | { kind: 'add'; parent: XmlNode; child: XmlNode; prev: XmlNode | null }
  | { kind: 'remove'; parent: XmlNode; child: XmlNode; prev: XmlNode | null }
  | { kind: 'attr'; node: XmlNode; name: string; oldValue: string | null; newValue: string | null }
  | { kind: 'content'; node: XmlNode; oldContent: string; newContent: string };

export interface EventSink {
  record(e: XmlEvent): void;
}

let nextId = 1;

export class XmlNode {
  readonly uid = nextId++;
  parent: XmlNode | null = null;
  readonly children: XmlNode[] = [];
  private readonly attrs = new Map<string, string>();
  private readonly observers = new Set<NodeObserver>();
  content = '';

  constructor(
    readonly type: 'element' | 'text' | 'comment',
    /** Qualified name as in the file, e.g. "svg:rect" is stored as "rect" + namespace. */
    readonly name: string,
    readonly namespace: string | null,
    private sink: EventSink | null = null,
  ) {}

  attribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  attributeList(): [string, string][] {
    return [...this.attrs];
  }

  setAttribute(name: string, value: string | null): void {
    const old = this.attribute(name);
    if (old === value) return;
    if (value === null) this.attrs.delete(name);
    else this.attrs.set(name, value);
    this.sink?.record({ kind: 'attr', node: this, name, oldValue: old, newValue: value });
    for (const o of this.observers) o.notifyAttributeChanged?.(this, name, old, value);
  }

  setContent(value: string): void {
    const old = this.content;
    if (old === value) return;
    this.content = value;
    this.sink?.record({ kind: 'content', node: this, oldContent: old, newContent: value });
    for (const o of this.observers) o.notifyContentChanged?.(this, old, value);
  }

  /** Insert `child` after `after` (null = first). */
  addChild(child: XmlNode, after: XmlNode | null): void {
    const index = after ? this.children.indexOf(after) + 1 : 0;
    this.children.splice(index, 0, child);
    child.parent = this;
    child.setSink(this.sink);
    this.sink?.record({ kind: 'add', parent: this, child, prev: after });
    for (const o of this.observers) o.notifyChildAdded?.(this, child, after);
  }

  appendChild(child: XmlNode): void {
    this.addChild(child, this.children.at(-1) ?? null);
  }

  removeChild(child: XmlNode): void {
    const index = this.children.indexOf(child);
    const prev = index > 0 ? this.children[index - 1] : null;
    this.children.splice(index, 1);
    child.parent = null;
    this.sink?.record({ kind: 'remove', parent: this, child, prev });
    for (const o of this.observers) o.notifyChildRemoved?.(this, child, prev);
  }

  addObserver(o: NodeObserver): void {
    this.observers.add(o);
  }

  removeObserver(o: NodeObserver): void {
    this.observers.delete(o);
  }

  setSink(sink: EventSink | null): void {
    this.sink = sink;
    for (const c of this.children) c.setSink(sink);
  }
}
