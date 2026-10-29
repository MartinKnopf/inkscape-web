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
import { CalligraphicTool } from './tools/calligraphic-tool.ts';
import { DropperTool } from './tools/dropper-tool.ts';
import { EraserTool } from './tools/eraser-tool.ts';
import { GradientTool } from './tools/gradient-tool.ts';
import { MeasureTool } from './tools/measure-tool.ts';
import { NodeTool } from './tools/node-tool.ts';
import { PagesTool } from './tools/pages-tool.ts';
import { PenTool } from './tools/pen-tool.ts';
import { PencilTool } from './tools/pencil-tool.ts';
import { RectTool } from './tools/rect-tool.ts';
import { SelectTool } from './tools/select-tool.ts';
import { SpiralTool } from './tools/spiral-tool.ts';
import { StarTool } from './tools/star-tool.ts';
import { TextTool } from './tools/text-tool.ts';
import type { ToolBase } from './tools/tool-base.ts';
import { ZoomTool } from './tools/zoom-tool.ts';

/** The tools by preferences path. TODO: the other tools. */
const TOOLS: Readonly<Record<string, new (desktop: SPDesktop) => ToolBase>> = {
  '/tools/nodes': NodeTool,
  '/tools/shapes/arc': ArcTool,
  '/tools/shapes/rect': RectTool,
  '/tools/freehand/pen': PenTool,
  '/tools/freehand/pencil': PencilTool,
  '/tools/calligraphic': CalligraphicTool,
  '/tools/eraser': EraserTool,
  '/tools/gradient': GradientTool,
  '/tools/dropper': DropperTool,
  '/tools/measure': MeasureTool,
  '/tools/pages': PagesTool,
  '/tools/zoom': ZoomTool,
  '/tools/select': SelectTool,
  '/tools/shapes/spiral': SpiralTool,
  '/tools/shapes/star': StarTool,
  '/tools/text': TextTool,
};

/** Whether createTool() knows the tool with the preferences path id. */
export function toolIsPorted(id: string): boolean {
  return id in TOOLS;
}

/** Create the tool with the preferences path id. */
export function createTool(desktop: SPDesktop, id: string): ToolBase {
  const Tool = TOOLS[id];
  if (Tool) return new Tool(desktop);
  console.warn(`WARNING: unknown tool: ${id}`);
  // Backup tool prevents crashes in signals that expect a tool to exist.
  return new SelectTool(desktop);
}
