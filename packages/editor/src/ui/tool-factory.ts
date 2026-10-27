// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tool-factory.cpp, src/ui/tool-factory.h
/*
 * Factory for ToolBase tree
 *
 * Authors:
 *   Markus Engel
 *
 * Copyright (C) 2013 Authors
 */
import type { SPDesktop } from '../desktop.ts';
import { ArcTool } from './tools/arc-tool.ts';
import { NodeTool } from './tools/node-tool.ts';
import { RectTool } from './tools/rect-tool.ts';
import { SelectTool } from './tools/select-tool.ts';
import { SpiralTool } from './tools/spiral-tool.ts';
import { StarTool } from './tools/star-tool.ts';
import type { ToolBase } from './tools/tool-base.ts';

/** Create the tool with the preferences path id. TODO: the other tools. */
export function createTool(desktop: SPDesktop, id: string): ToolBase {
  switch (id) {
    case '/tools/nodes':
      return new NodeTool(desktop);
    case '/tools/shapes/arc':
      return new ArcTool(desktop);
    case '/tools/shapes/rect':
      return new RectTool(desktop);
    case '/tools/select':
      return new SelectTool(desktop);
    case '/tools/shapes/spiral':
      return new SpiralTool(desktop);
    case '/tools/shapes/star':
      return new StarTool(desktop);
    default:
      console.warn(`WARNING: unknown tool: ${id}`);
      // Backup tool prevents crashes in signals that expect a tool to exist.
      return new SelectTool(desktop);
  }
}
