// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/toolbar/toolbars.cpp, src/ui/toolbar/toolbars.h
/*
 * A container for toolbars, displaying one toolbar at a time.
 *
 * Authors:
 *  Tavmjong Bah
 *  Alex Valavanis
 *  Mike Kowalski
 *  Vaibhav Malik
 *  PBS
 *
 * Copyright (C) 2024 PBS
 */
import type { SPDesktop } from '@inkscape-web/editor';
import type { FunctionComponent } from 'react';
import { useActiveDesktop, useActiveDocument } from '../../app/active-desktop.ts';
import { ArcToolbar } from './arc-toolbar.tsx';
import { NodeToolbar } from './node-toolbar.tsx';
import { PencilToolbar } from './pencil-toolbar.tsx';
import { RectToolbar } from './rect-toolbar.tsx';
import { SpiralToolbar } from './spiral-toolbar.tsx';
import { StarToolbar } from './star-toolbar.tsx';
import { useActiveTool } from './tool-toolbar.tsx';

/** The controls bar of each tool, by tool name. TODO: the other tools (the select toolbar first). */
const toolbar_data: Record<string, FunctionComponent<{ desktop: SPDesktop }>> = {
  Node: NodeToolbar,
  Rect: RectToolbar,
  Arc: ArcToolbar,
  Star: StarToolbar,
  Spiral: SpiralToolbar,
  Pencil: ({ desktop }) => <PencilToolbar desktop={desktop} pencil_mode={true} />,
  Pen: ({ desktop }) => <PencilToolbar desktop={desktop} pencil_mode={false} />,
};

/** The tool controls bar: the toolbar of the active tool of the active desktop. */
export function Toolbars() {
  const desktop = useActiveDesktop();
  // Re-render (and re-subscribe the toolbar) when the desktop shows another document.
  useActiveDocument();
  const tool = useActiveTool(desktop);
  const Toolbar = toolbar_data[tool];
  return (
    <div className="toolbars" role="toolbar">
      {desktop && Toolbar && <Toolbar key={tool} desktop={desktop} />}
    </div>
  );
}
