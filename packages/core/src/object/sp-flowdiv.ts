// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-flowdiv.cpp, src/object/sp-flowdiv.h
/*
 * Authors: see git history
 *
 * Copyright (C) 2018 Authors
 */
import type { XmlDocument } from '../xml/document.ts';
import type { Node } from '../xml/node.ts';
import { SPItem } from './sp-item.ts';
import {
  cascadeFlags,
  SP_OBJECT_CHILD_MODIFIED_FLAG,
  SP_OBJECT_MODIFIED_FLAG,
  SP_OBJECT_WRITE_BUILD,
  type SPCtx,
  SPObject,
} from './sp-object.ts';
import { SPString } from './sp-string.ts';

/** Update the children of a flowed text element (upstream SPFlowdiv::update and friends). */
export function updateTextChildren(object: SPObject, ctx: SPCtx, flags: number): void {
  const childflags = cascadeFlags(flags);
  for (const child of object.childList()) {
    if (childflags || child.uflags & (SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_CHILD_MODIFIED_FLAG)) {
      child.updateDisplay(ctx, childflags);
    }
  }
}

export function modifiedTextChildren(object: SPObject, flags: number): void {
  const cflags = cascadeFlags(flags);
  for (const child of object.childList()) {
    if (cflags || child.mflags & (SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_CHILD_MODIFIED_FLAG))
      child.emitModified(cflags);
  }
}

/** Write the strings of the children to their reprs and update the other children (not when building). */
export function writeTextChildren(object: SPObject, flags: number): void {
  if (flags & SP_OBJECT_WRITE_BUILD) return; // the duplicated repr has the children
  for (const child of object.children) {
    if (child instanceof SPString) child.getRepr().setContent(child.string);
    else child.updateRepr(flags);
  }
}

/** Base of the flowed text elements that hold text. */
abstract class SPFlowTextItem extends SPItem {
  protected override update(ctx: SPCtx, flags: number): void {
    updateTextChildren(this, ctx, flags);
    super.update(ctx, flags);
  }
  protected override modified(flags: number): void {
    modifiedTextChildren(this, flags);
  }
  override write(xmlDoc: XmlDocument, repr: Node | null, flags: number): Node | null {
    writeTextChildren(this, flags);
    return super.write(xmlDoc, repr, flags);
  }
}

/** svg:flowDiv (upstream SPFlowdiv), a block of paragraphs. */
export class SPFlowdiv extends SPFlowTextItem {}

/** svg:flowSpan (upstream SPFlowtspan). */
export class SPFlowtspan extends SPFlowTextItem {}

/** svg:flowPara (upstream SPFlowpara), a paragraph. */
export class SPFlowpara extends SPFlowTextItem {}

/** svg:flowLine (upstream SPFlowline), a line break. */
export class SPFlowline extends SPObject {}

/** svg:flowRegionBreak (upstream SPFlowregionbreak). */
export class SPFlowregionbreak extends SPObject {}
