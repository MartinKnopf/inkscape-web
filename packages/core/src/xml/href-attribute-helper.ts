// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/xml/href-attribute-helper.cpp, src/xml/href-attribute-helper.h
/*
 * Authors:
 *   Thomas Holder
 *
 * Copyright (C) 2022 Authors
 */
import type { Node } from './node.ts';

/**
 * Get the 'href' or 'xlink:href' (fallback) attribute from an XML node.
 *
 * @return The observed key and its value
 */
export function getHrefAttribute(node: Node): [string, string | null] {
  const href = node.attribute('href');
  if (href !== null) return ['href', href];
  const xlink = node.attribute('xlink:href');
  if (xlink !== null) return ['xlink:href', xlink];
  return ['xlink:href', null];
}

/**
 * If the 'href' attribute already exists for the given node, then set a new
 * value for it. Otherwise set the value for 'xlink:href'.
 */
export function setHrefAttribute(node: Node, value: string | null): void {
  if (node.attribute('href') !== null) node.setAttribute('href', value);
  else node.setAttribute('xlink:href', value);
}
