// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/colors/xml-color.cpp, src/colors/xml-color.h
/*
 * Author:
 *   Martin Owens <doctormo@geek-2.com>
 *
 * Copyright (C) 2023 author
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */

// TODO: Colors of the CMS spaces of a document (upstream looks them up in the SPDocument and
// the icc profile system) need lcms via WASM. Here only the spaces of the Manager are found.

import { cssNumber } from '../svg/css-ostringstream.ts';
import { svgNumber } from '../svg/stringstream.ts';
import { XmlDocument } from '../xml/document.ts';
import type { Node } from '../xml/node.ts';
import { readMem, saveBuf } from '../xml/repr-io.ts';
import { Color } from './color.ts';
import { ColorError } from './forward.ts';
import { Manager } from './manager.ts';

/** No color at all, as in the SVG paint `none`. */
export class NoColor {}

// NoColor must go first for default constructor
export type Paint = NoColor | Color;

/**
 * Make an xml document of a paint.
 *
 * This format is entirely inkscape's creation and doesn't work with anything
 * outside of inkscape. It's completely safe to change at any time since the
 * data is never saved to a file.
 */
export function paint_to_xml(paint: Paint = new NoColor()): XmlDocument {
  const document = new XmlDocument();
  const root = document.createElement('paint');
  document.appendChild(root);

  if (paint instanceof NoColor) {
    root.appendChild(document.createElement('nocolor'));
    return document;
  }

  const space = paint.getSpace();
  const node = document.createElement('color');
  node.setAttribute('space', space.getName());
  if (paint.getName() !== '') node.setAttribute('name', paint.getName());
  root.appendChild(node);

  if (paint.hasOpacity()) {
    node.setAttribute('opacity', svgNumber(paint.getOpacity()));
  }

  const components = space.getComponents();
  for (let i = 0; i < components.size && i < paint.size(); i++) {
    node.setAttribute(components.at(i).id, cssNumber(paint.get(i)));
  }
  return document;
}

/** Write a paint as xml text. */
export function paint_to_xml_string(paint: Paint = new NoColor()): string {
  return saveBuf(paint_to_xml(paint), null, { inlineAttributes: false });
}

/** Read a paint from xml text, see `paint_to_xml_string`. */
export function xml_string_to_paint(xmls: string): Paint {
  const doc = readMem(xmls, null);
  if (!doc) throw new ColorError('No color data found');
  return xml_to_paint(doc);
}

function get_node(node: Node, name: string): Node | undefined {
  for (const child of node.children()) {
    if (child.name() === name) return child;
  }
  return undefined;
}

function get_double(node: Node, name: string): number {
  const value = node.attribute(name);
  return value === null ? 0 : Number.parseFloat(value) || 0;
}

/** Read a paint from an xml document, see `paint_to_xml`. */
export function xml_to_paint(xml: XmlDocument): Paint {
  const paint = get_node(xml, 'paint');
  if (paint) {
    if (get_node(paint, 'nocolor')) {
      return new NoColor();
    }
    const color_xml = get_node(paint, 'color');
    if (color_xml) {
      const space_name = color_xml.attribute('space');
      if (space_name === null) {
        throw new ColorError('Invalid color data, no space specified.');
      }
      const space = Manager.get().find(space_name);
      if (!space) {
        throw new ColorError('No color space available.');
      }

      const values: number[] = [];
      for (const comp of space.getComponents().getAll()) {
        values.push(get_double(color_xml, comp.id));
      }
      const color = new Color(space, values);
      if (color_xml.attribute('opacity') !== null) {
        color.setOpacity(get_double(color_xml, 'opacity'));
      }
      const name = color_xml.attribute('name');
      if (name !== null) {
        color.setName(name);
      }
      return color;
    }
  }
  throw new ColorError('No color data found');
}
