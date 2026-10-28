// SPDX-License-Identifier: GPL-2.0-or-later
// Test helper: an in-memory Drawing that records what SPItem.show() and update() set.
// Not used in production code.
import type { Affine, OptRect, PathVector, Point, Rect } from '@inkscape-web/geom';
import type { SPItem } from '../object/sp-item.ts';
import type { SPStyle } from '../style.ts';
import type { Pixbuf } from './cairo-utils.ts';
import type { Drawing, DrawingGroup, DrawingImage, DrawingItem, DrawingShape } from './drawing.ts';

export class FakeDrawingItem implements DrawingItem {
  parent: FakeDrawingItem | null = null;
  children: FakeDrawingItem[] = [];
  keyValue = 0;
  item: SPItem | null = null;
  transform: Affine | null = null;
  opacity = 1;
  visible = true;
  sensitive = true;
  isolation = false;
  blendMode = 0;
  antialias = true;
  style: SPStyle | null = null;
  contextStyle: SPStyle | null = null;
  itemBounds: OptRect = null;
  unlinked = false;

  constructor(readonly kind: 'group' | 'shape' | 'image') {}

  key(): number {
    return this.keyValue;
  }
  setKey(key: number): void {
    this.keyValue = key;
  }
  setItem(item: SPItem | null): void {
    this.item = item;
  }
  appendChild(child: DrawingItem): void {
    const c = child as FakeDrawingItem;
    c.parent = this;
    this.children.push(c);
  }
  prependChild(child: DrawingItem): void {
    const c = child as FakeDrawingItem;
    c.parent = this;
    this.children.unshift(c);
  }
  clearChildren(): void {
    for (const c of [...this.children]) c.unlink();
  }
  setZOrder(z: number): void {
    const siblings = this.parent?.children;
    if (!siblings) return;
    siblings.splice(siblings.indexOf(this), 1);
    siblings.splice(Math.min(z, siblings.length), 0, this);
  }
  setTransform(transform: Affine): void {
    this.transform = transform;
  }
  setOpacity(opacity: number): void {
    this.opacity = opacity;
  }
  setVisible(visible: boolean): void {
    this.visible = visible;
  }
  setSensitive(sensitive: boolean): void {
    this.sensitive = sensitive;
  }
  setIsolation(isolate: boolean): void {
    this.isolation = isolate;
  }
  setBlendMode(mode: number): void {
    this.blendMode = mode;
  }
  setAntialiasing(antialias: boolean): void {
    this.antialias = antialias;
  }
  setStyle(style: SPStyle | null, contextStyle: SPStyle | null = null): void {
    this.style = style;
    this.contextStyle = contextStyle;
  }
  setItemBounds(bounds: OptRect): void {
    this.itemBounds = bounds;
  }
  unlink(): void {
    this.clearChildren();
    if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
    this.unlinked = true;
  }

  /** The tree as nested arrays of "kind#id", for assertions. */
  dump(): unknown {
    const name = `${this.kind}#${this.item?.getId() ?? ''}`;
    return this.children.length ? [name, this.children.map((c) => c.dump())] : name;
  }
}

export class FakeDrawingGroup extends FakeDrawingItem implements DrawingGroup {
  childTransform: Affine | null = null;
  pickChildren = false;
  constructor() {
    super('group');
  }
  setChildTransform(transform: Affine | null): void {
    this.childTransform = transform;
  }
  setPickChildren(pick: boolean): void {
    this.pickChildren = pick;
  }
}

export class FakeDrawingShape extends FakeDrawingItem implements DrawingShape {
  path: PathVector | null = null;
  constructor() {
    super('shape');
  }
  setPath(path: PathVector | null): void {
    this.path = path;
  }
}

export class FakeDrawingImage extends FakeDrawingItem implements DrawingImage {
  pixbuf: Pixbuf | null = null;
  scale: [number, number] = [1, 1];
  origin: Point | null = null;
  clipbox: Rect | null = null;
  constructor() {
    super('image');
  }
  setPixbuf(pixbuf: Pixbuf | null): void {
    this.pixbuf = pixbuf;
  }
  setScale(sx: number, sy: number): void {
    this.scale = [sx, sy];
  }
  setOrigin(origin: Point): void {
    this.origin = origin;
  }
  setClipbox(box: Rect): void {
    this.clipbox = box;
  }
}

export class FakeDrawing implements Drawing {
  createGroup(): FakeDrawingGroup {
    return new FakeDrawingGroup();
  }
  createShape(): FakeDrawingShape {
    return new FakeDrawingShape();
  }
  createImage(): FakeDrawingImage {
    return new FakeDrawingImage();
  }
}
