// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/prototype.cpp, src/ui/dialog/prototype.h
/*
 * A bare minimum example of a dialog.
 *
 * Author:
 *   Tavmjong Bah
 *
 * Copyright (C) Tavmjong Bah <tavmjong@free.fr>
 */
import { prototype_document_label, prototype_selection_line } from '@inkscape-web/editor';
import { useEffect, useState } from 'react';
import { useActiveDesktop, useActiveDocument } from '../../app/active-desktop.ts';

/**
 * The Prototype dialog (dialog key "Prototype"): the example of a dialog. It shows the id of the
 * root of the document and a line for each selection change; the button writes to the console.
 */
export function PrototypeDialog() {
  const desktop = useActiveDesktop();
  const document_ = useActiveDocument();
  const [lines, setLines] = useState<string[]>([]);

  // The label starts again for another document (upstream documentReplaced).
  useEffect(() => setLines([prototype_document_label(document_)]), [document_]);
  useEffect(() => {
    if (!desktop) return;
    const selection = desktop.getSelection();
    return selection.connectChanged(() =>
      setLines((previous) => [...previous, prototype_selection_line(selection)]),
    );
  }, [desktop]);

  return (
    <button
      type="button"
      className="prototype-debug-button"
      style={{ width: '100%', whiteSpace: 'pre-wrap' }}
      onClick={() => console.warn('Prototype: the dialog is part of this window.')}
    >
      {lines.join('\n')}
    </button>
  );
}
