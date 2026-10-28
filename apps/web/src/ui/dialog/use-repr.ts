// SPDX-License-Identifier: GPL-2.0-or-later
// Hooks that make dialogs follow the XML tree, the selection and the current layer.
import type { Node, NodeObserver } from '@inkscape-web/core';
import type { SPDesktop } from '@inkscape-web/editor';
import { useRef, useSyncExternalStore } from 'react';

/** An observer that calls notify for every kind of change. */
function allChanges(notify: () => void): NodeObserver {
  return {
    notifyChildAdded: notify,
    notifyChildRemoved: notify,
    notifyChildOrderChanged: notify,
    notifyContentChanged: notify,
    notifyAttributeChanged: notify,
    notifyElementNameChanged: notify,
  };
}

/** Re-render on every change in the subtree of root (upstream: the NodeObserver of the dialogs). */
export function useReprVersion(root: Node | null): number {
  const version = useRef(0);
  return useSyncExternalStore(
    (cb) => {
      if (!root) return () => {};
      const observer = allChanges(() => {
        version.current++;
        cb();
      });
      root.addSubtreeObserver(observer);
      return () => root.removeSubtreeObserver(observer);
    },
    () => version.current,
  );
}

/** Re-render when the selection or the current layer of desktop changes. */
export function useSelectionVersion(desktop: SPDesktop | null): number {
  const version = useRef(0);
  return useSyncExternalStore(
    (cb) => {
      if (!desktop) return () => {};
      const bump = () => {
        version.current++;
        cb();
      };
      const off = [
        desktop.getSelection().connectChanged(bump),
        desktop.layerManager().signal_layer_changed.connect(bump),
      ];
      return () => {
        for (const f of off) f();
      };
    },
    () => version.current,
  );
}

const keys = new WeakMap<object, number>();
let nextKey = 0;
/** A stable React key for an object (a node or a document). */
export function objectKey(object: object): number {
  const old = keys.get(object);
  if (old !== undefined) return old;
  const key = nextKey++;
  keys.set(object, key);
  return key;
}
