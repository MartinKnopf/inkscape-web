// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/popup-menu.cpp
// Shows the context menus that ContextMenu() builds (the canvas menu of ToolBase::menu_popup())
// at the pointer, with the entries of the menu bar.
import { type ContextMenuModel, InkscapeApplication, setContextMenuPresenter } from '@inkscape-web/editor';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useEffect, useMemo, useState } from 'react';
import { MenuEntries, MenuKitContext, useActionsVersion } from './desktop/menubar.tsx';

interface Open {
  menu: ContextMenuModel;
  x: number;
  y: number;
  /** The element that had the focus (the canvas); it gets it back when the menu closes. */
  focus: Element | null;
}

/** Render once in the app. */
export function ContextMenuHost() {
  const [open, setOpen] = useState<Open | null>(null);
  useActionsVersion();
  useEffect(
    () =>
      setContextMenuPresenter((menu, p) => setOpen({ menu, x: p.x, y: p.y, focus: document.activeElement })),
    [],
  );

  const kit = useMemo(() => {
    const app = InkscapeApplication.instance();
    const ctx = open?.menu.ctx;
    return {
      Item: DropdownMenu.Item,
      Separator: DropdownMenu.Separator,
      Sub: DropdownMenu.Sub,
      SubTrigger: DropdownMenu.SubTrigger,
      SubContent: DropdownMenu.SubContent,
      Portal: DropdownMenu.Portal,
      isEnabled: (action: string) => !!ctx?.has(action) || app.actions.is_enabled(action),
      activate: (action: string) => {
        const f = ctx?.get(action);
        if (f) f();
        else app.activate_action(action);
      },
    };
  }, [open]);

  if (!open) return null;
  return (
    <DropdownMenu.Root open onOpenChange={(o) => !o && setOpen(null)} modal={false}>
      {/* A point at the pointer that the menu opens from. */}
      <DropdownMenu.Trigger asChild>
        <span style={{ position: 'fixed', left: open.x, top: open.y, width: 0, height: 0 }} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="menu-popup"
          align="start"
          side="right"
          loop
          // The menu opens under the pointer, so the browser's menu event of the same click comes here.
          onContextMenu={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            // Give the focus back unless an action (a dialog) or a click has moved it elsewhere.
            const active = document.activeElement;
            if (!active || active === document.body)
              (open.focus as HTMLElement | SVGElement | null)?.focus?.({ preventScroll: true });
          }}
        >
          <MenuKitContext.Provider value={kit}>
            <MenuEntries entries={open.menu.entries} />
          </MenuKitContext.Provider>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
