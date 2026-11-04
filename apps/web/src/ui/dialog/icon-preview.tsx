// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/icon-preview.cpp, src/ui/dialog/icon-preview.h
/*
 * A panel showing the selection or the document as icons of several sizes.
 *
 * Authors:
 *   Jon A. Cruz
 *   Bob Jamison
 *   Other dudes from The Inkscape Organization
 *
 * Copyright (C) 2004 Bob Jamison
 * Copyright (C) 2005,2010 Jon A. Cruz
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { _, C_, Preferences } from '@inkscape-web/core';
import {
  icon_preview_label,
  icon_preview_sizes,
  icon_preview_target,
  render_icon,
  type SPDesktop,
} from '@inkscape-web/editor';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useActiveDesktop } from '../../app/active-desktop.ts';
import { objectKey } from './use-repr.ts';

const MAGNIFIED_SIZE = 128;

/** Draw src into the canvas, scaled up without smoothing (upstream: the Magnifier). */
function drawMagnified(dest: HTMLCanvasElement | null, src: HTMLCanvasElement | null): void {
  const ctx = dest?.getContext('2d');
  if (!dest || !ctx) return;
  ctx.clearRect(0, 0, dest.width, dest.height);
  if (!src) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, dest.width, dest.height);
    return;
  }
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, dest.width, dest.height);
}

/**
 * The Icon Preview dialog (dialog key "IconPreview"): the selection, or the whole drawing, drawn
 * as icons of several sizes, and one of them magnified.
 */
export function IconPreviewDialog() {
  const desktop = useActiveDesktop();
  if (!desktop) return null;
  return <IconPreviewImpl key={objectKey(desktop.doc) + objectKey(desktop)} desktop={desktop} />;
}

function IconPreviewImpl({ desktop }: { desktop: SPDesktop }) {
  const prefs = Preferences.get();
  const sizes = useMemo(icon_preview_sizes, []);
  const [hot, setHot] = useState(Math.min(1, sizes.length - 1));
  const [selectionOnly, setSelectionOnly] = useState(() => prefs.getBool('/iconpreview/selectionOnly'));
  // Bumped when the drawing or the selection changed and the previews are to be drawn again.
  const [version, setVersion] = useState(0);
  const canvases = useRef<(HTMLCanvasElement | null)[]>([]);
  const rendered = useRef<(HTMLCanvasElement | null)[]>([]);
  const magnified = useRef<HTMLCanvasElement>(null);
  const held = useRef('');
  const showFrames = prefs.getBool('/iconpreview/showFrames', true);

  // Refresh when the selection or the document changes (/iconpreview/autoRefresh), not too often.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const queue = () => {
      if (!prefs.getBool('/iconpreview/autoRefresh', true) || timer) return;
      timer = setTimeout(() => {
        timer = null;
        setVersion((v) => v + 1);
      }, 100);
    };
    const selection = desktop.getSelection();
    const off = [
      selection.connectChanged(queue),
      selection.connectModified(queue),
      desktop.getDocument().commitSignal.connect(queue),
    ];
    return () => {
      if (timer) clearTimeout(timer);
      for (const f of off) f();
    };
  }, [desktop, prefs]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: version asks for a refresh
  useEffect(() => {
    let cancelled = false;
    const { target, id } = icon_preview_target(desktop, selectionOnly, held.current);
    held.current = id;
    void (async () => {
      if (!target) return;
      for (const [i, size] of sizes.entries()) {
        const canvas = await render_icon(desktop.getDocument(), target, size).catch(() => null);
        if (cancelled) return;
        rendered.current[i] = canvas;
        const dest = canvases.current[i];
        const ctx = dest?.getContext('2d');
        if (dest && ctx) {
          ctx.clearRect(0, 0, dest.width, dest.height);
          if (canvas) ctx.drawImage(canvas, 0, 0);
        }
      }
      drawMagnified(magnified.current, rendered.current[hot] ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [desktop, sizes, selectionOnly, version, hot]);

  return (
    <div className="icon-preview-dialog">
      <fieldset>
        <legend>{_('Magnified:')}</legend>
        <canvas
          ref={magnified}
          className="icon-preview-magnified"
          width={MAGNIFIED_SIZE}
          height={MAGNIFIED_SIZE}
        />
        <div>{icon_preview_label(sizes[hot] ?? 0)}</div>
        <label title={_('Selection only or whole document')}>
          <input
            type="checkbox"
            checked={selectionOnly}
            onChange={(e) => {
              setSelectionOnly(e.target.checked);
              prefs.setBool('/iconpreview/selectionOnly', e.target.checked);
              if (!e.target.checked) held.current = '';
            }}
          />
          {C_('Icon preview window', 'Sele_ction').replace('_', '')}
        </label>
      </fieldset>
      <fieldset>
        <legend>{_('Actual Size:')}</legend>
        <div className="icon-preview-sizes">
          {sizes.map((size, i) => (
            <button
              key={size}
              type="button"
              aria-pressed={i === hot}
              title={icon_preview_label(size)}
              className={showFrames ? 'icon-preview-framed' : undefined}
              onClick={() => setHot(i)}
            >
              <canvas
                ref={(c) => {
                  canvases.current[i] = c;
                }}
                width={size}
                height={size}
              />
            </button>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
