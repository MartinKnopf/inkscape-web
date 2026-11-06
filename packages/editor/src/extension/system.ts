// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/system.cpp, src/extension/system.h
/*
 * This is file is kind of the junk file.  Basically everything that
 * didn't fit in one of the other well defined areas, well, it's now
 * here.  Which is good in someways, but this file really needs some
 * definition.  Hopefully that will come ASAP.
 *
 * Authors:
 *   Ted Gould <ted@gould.cx>
 *   Johan Engelen <johan@shouraizou.nl>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *
 * Copyright (C) 2006-2007 Johan Engelen
 * Copyright (C) 2002-2004 Ted Gould
 */
import { readMem, type XmlDocument } from '@inkscape-web/core';
import { db } from './db.ts';
import { Effect } from './effect.ts';
import type { Extension } from './extension.ts';
import type { Implementation } from './implementation/implementation.ts';
import { Script } from './implementation/script.ts';
import { Input } from './input.ts';
import { Output } from './output.ts';
import { INKSCAPE_EXTENSION_NS, INKSCAPE_EXTENSION_URI } from './prefdialog/widget.ts';
import { Print } from './print.ts';
import { Template } from './template.ts';

/**
 * Build an extension from an .inx document and register it (upstream build_from_reprdoc).
 * Returns the extension, or null if it is not valid, not compatible or has no implementation
 * in the browser (XSLT and plugins).
 * TODO: path effect extensions, XSLT.
 */
export function build_from_reprdoc(
  doc: XmlDocument,
  in_imp: Implementation | null,
  baseDir = '',
  file_name = '',
): Extension | null {
  const repr = doc.root();
  if (!repr || repr.name() !== `${INKSCAPE_EXTENSION_NS}inkscape-extension`) {
    console.warn(
      `Extension definition started with <${repr?.name()}> instead of <${INKSCAPE_EXTENSION_NS}inkscape-extension>.  Extension will not be created.`,
    );
    return null;
  }

  let functional: 'input' | 'output' | 'effect' | 'template' | 'print' | 'other' = 'other';
  let implementation: 'script' | 'xslt' | 'plugin' | 'unknown' = 'unknown';
  for (const child_repr of repr.children()) {
    switch (child_repr.name()) {
      case `${INKSCAPE_EXTENSION_NS}input`:
        functional = 'input';
        break;
      case `${INKSCAPE_EXTENSION_NS}output`:
        functional = 'output';
        break;
      case `${INKSCAPE_EXTENSION_NS}effect`:
        functional = 'effect';
        break;
      case `${INKSCAPE_EXTENSION_NS}template`:
        functional = 'template';
        break;
      case `${INKSCAPE_EXTENSION_NS}print`:
        functional = 'print';
        break;
      case `${INKSCAPE_EXTENSION_NS}script`:
        implementation = 'script';
        break;
      case `${INKSCAPE_EXTENSION_NS}xslt`:
        implementation = 'xslt';
        break;
      case `${INKSCAPE_EXTENSION_NS}plugin`:
        implementation = 'plugin';
        break;
    }
  }

  const imp = in_imp ?? (implementation === 'script' ? new Script() : null);
  if (!imp) return null; // no implementation was found

  let module: Extension;
  try {
    switch (functional) {
      case 'input':
        module = new Input(repr, imp, baseDir);
        break;
      case 'output':
        module = new Output(repr, imp, baseDir);
        break;
      case 'effect':
        module = new Effect(repr, imp, baseDir, file_name);
        break;
      case 'template':
        module = new Template(repr, imp, baseDir);
        break;
      case 'print':
        module = new Print(repr, imp, baseDir);
        break;
      default:
        return null; // TODO: path effects
    }
  } catch (e) {
    if (!(e instanceof Error && e.message === 'extension_not_compatible'))
      console.warn(`Building extension failed: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
  db.register_ext(module);
  return module;
}

/**
 * Build an extension from the text of an .inx file (upstream build_from_mem and
 * build_from_file). path is the path of the file, for its folder and name.
 */
export function build_from_mem(
  text: string,
  in_imp: Implementation | null = null,
  path = '',
): Extension | null {
  const doc = readMem(text, INKSCAPE_EXTENSION_URI);
  if (!doc) {
    console.warn(`Inkscape::Extension::build_from_file() - XML description loaded from '${path}' not valid.`);
    return null;
  }
  const slash = path.lastIndexOf('/');
  return build_from_reprdoc(doc, in_imp, slash >= 0 ? path.slice(0, slash) : '', path.slice(slash + 1));
}
