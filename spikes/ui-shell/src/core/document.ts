// Upstream: src/document.cpp, src/document-undo.cpp
// Spike document: owns the repr tree and an undo stack built from XML events
// (same model as upstream: mutations are logged, DocumentUndo::done() commits).
import { XmlNode, type XmlEvent, type EventSink } from './xml/node';
import { parseSvg } from './xml/parse';

export type UndoStep = { description: string; events: XmlEvent[] };

export class Emitter {
  private listeners = new Set<() => void>();
  version = 0;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  emit() {
    this.version++;
    for (const l of this.listeners) l();
  }
}

export class SPDocument implements EventSink {
  readonly root: XmlNode;
  readonly undoStack: UndoStep[] = [];
  readonly redoStack: UndoStep[] = [];
  /** Fires after each committed change, undo or redo. */
  readonly changed = new Emitter();
  private pending: XmlEvent[] = [];
  private replaying = false;

  constructor(text: string) {
    this.root = parseSvg(text);
    this.root.setSink(this);
  }

  record(e: XmlEvent): void {
    if (!this.replaying) this.pending.push(e);
  }

  /** Commit the pending events as one undo step (DocumentUndo::done). */
  done(description: string): void {
    if (!this.pending.length) return;
    this.undoStack.push({ description, events: this.pending });
    this.pending = [];
    this.redoStack.length = 0;
    this.changed.emit();
  }

  /** Merge into the last step if it has the same key (DocumentUndo::maybeDone). */
  maybeDone(key: string, description: string): void {
    const last = this.undoStack.at(-1) as (UndoStep & { key?: string }) | undefined;
    if (last && last.key === key) {
      last.events.push(...this.pending);
      this.pending = [];
      this.changed.emit();
    } else {
      this.done(description);
      (this.undoStack.at(-1) as UndoStep & { key?: string }).key = key;
    }
  }

  undo(): void {
    const step = this.undoStack.pop();
    if (!step) return;
    this.replay([...step.events].reverse(), true);
    this.redoStack.push(step);
    this.changed.emit();
  }

  redo(): void {
    const step = this.redoStack.pop();
    if (!step) return;
    this.replay(step.events, false);
    this.undoStack.push(step);
    this.changed.emit();
  }

  private replay(events: XmlEvent[], invert: boolean): void {
    this.replaying = true;
    for (const e of events) {
      switch (e.kind) {
        case 'attr':
          e.node.setAttribute(e.name, invert ? e.oldValue : e.newValue);
          break;
        case 'content':
          e.node.setContent(invert ? e.oldContent : e.newContent);
          break;
        case 'add':
          if (invert) e.parent.removeChild(e.child);
          else e.parent.addChild(e.child, e.prev);
          break;
        case 'remove':
          if (invert) e.parent.addChild(e.child, e.prev);
          else e.parent.removeChild(e.child);
          break;
      }
    }
    this.replaying = false;
  }

  createElement(name: string): XmlNode {
    return new XmlNode('element', name, 'http://www.w3.org/2000/svg', this);
  }
}
