// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/widget/desktop-widget.cpp
// The tab of a document: the canvas with rulers and a desktop.
import { CanvasGrid, SPDesktop } from '@inkscape-web/editor';
import { DockviewDefaultTab, type IDockviewPanelHeaderProps, type IDockviewPanelProps } from 'dockview-react';
import { useEffect, useRef } from 'react';
import { document_close, getDocumentWindow, registerDesktop } from './documents.ts';
import { useLayout } from './layout.ts';

/** The canvas of the document that the panel (see openDocumentWindow) shows. */
export function DrawingPanel({ api }: IDockviewPanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const grid_ref = useRef<CanvasGrid | null>(null);
  const { rulers, scrollbars } = useLayout().bars;
  useEffect(() => {
    const host = ref.current;
    const win = getDocumentWindow(api.id);
    if (!host || !win) return;
    const grid = new CanvasGrid(host);
    grid_ref.current = grid;
    const desktop = new SPDesktop(grid.canvas, win.doc);
    grid.ShowRulers(rulers);
    grid.ShowScrollbars(scrollbars);
    grid.set_desktop(desktop);
    desktop.schedule_zoom_from_document();
    registerDesktop(api.id, desktop);
    return () => {
      grid_ref.current = null;
      registerDesktop(api.id, null);
      desktop.destroy();
      grid.destroy();
    };
  }, [api.id]);
  useEffect(() => grid_ref.current?.ShowRulers(rulers), [rulers]);
  useEffect(() => grid_ref.current?.ShowScrollbars(scrollbars), [scrollbars]);
  return <div className="drawing" ref={ref} />;
}

/** A document tab: closing it checks for data loss like win.document-close. */
export function DocumentTab(props: IDockviewPanelHeaderProps) {
  return <DockviewDefaultTab {...props} closeActionOverride={() => void document_close(props.api.id)} />;
}
