// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/tracedialog.cpp, src/ui/dialog/tracedialog.h, share/ui/dialog-trace.glade
/*
 * Bitmap tracing settings dialog - second implementation.
 *
 * Authors:
 *   Bob Jamison
 *   Marc Jeanmougin <marc.jeanmougin@telecom-paristech.fr>
 *   PBS <pbs3141@gmail.com>
 *   Others - see git history.
 *
 * Copyright (C) 2019-2022 Authors
 */
import { _, Preferences, preview, type RgbaImage, trace } from '@inkscape-web/core';
import {
  cbt_ms_map,
  cbt_ss_map,
  getTraceData,
  Page,
  type SPDesktop,
  type TraceOptions,
  trace_defaults,
} from '@inkscape-web/editor';
import { useEffect, useRef, useState } from 'react';
import { useActiveDesktop } from '../../app/active-desktop.ts';
import { useSelectionUpdates } from '../toolbar/toolbar.tsx';
import { SpinButton } from '../widget/spinbutton.tsx';
import { objectKey } from './use-repr.ts';

const LIVE_UPDATE = '/dialogs/trace/liveUpdate';

/** Options that change the preview (upstream: the adjustments and buttons connected to updatePreview). */
const previewKey = (o: TraceOptions) =>
  JSON.stringify([
    o.page,
    o.CBT_SS,
    o.CBT_MS,
    o.SS_BC_T,
    o.SS_ED_T,
    o.SS_CQ_T,
    o.MS_scans,
    o.invert,
    o.MS_rb,
  ]);

/**
 * The Trace Bitmap dialog (dialog key "Trace"): trace the selected image with potrace, in a
 * single scan (brightness cutoff, edge detection, color quantization) or several scans
 * (brightness steps, colors, grays), with the preview of the filtered image.
 * TODO: autotrace and centerline tracing, the pixel art page (depixelize), SIOX
 * (user-assisted trace), progress and abort (the tracing runs synchronously).
 */
export function TraceDialog() {
  const desktop = useActiveDesktop();
  if (!desktop) return null;
  return <TraceDialogImpl key={objectKey(desktop.doc) + objectKey(desktop)} desktop={desktop} />;
}

function Check(props: { label: string; tooltip?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="docprops-row" title={props.tooltip}>
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
      <span>{props.label}</span>
    </label>
  );
}

function TraceDialogImpl({ desktop }: { desktop: SPDesktop }) {
  useSelectionUpdates(desktop);
  const prefs = Preferences.get();
  const [o, setOptions] = useState<TraceOptions>(trace_defaults);
  const [live, setLive] = useState(() => prefs.getBool(LIVE_UPDATE, true));
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [previewImage, setPreviewImage] = useState<RgbaImage | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const previewRun = useRef(0);
  const set = (patch: Partial<TraceOptions>) => setOptions((old) => ({ ...old, ...patch }));
  const selection = desktop.getSelection();
  const selected = selection.singleItem();
  const engine = getTraceData(o);

  const updatePreview = async () => {
    const run = ++previewRun.current;
    const eng = getTraceData(o);
    const result = eng ? await preview(eng, selection) : null;
    if (run === previewRun.current) setPreviewImage(result);
  };

  // Live preview when the selection or the options that change the filtering change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: updatePreview reads the current options.
  useEffect(() => {
    if (live) void updatePreview();
  }, [live, selected, previewKey(o)]);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!previewImage || !ctx) {
      c.width = c.height = 0;
      return;
    }
    c.width = previewImage.width;
    c.height = previewImage.height;
    ctx.putImageData(
      new ImageData(new Uint8ClampedArray(previewImage.data), previewImage.width, previewImage.height),
      0,
      0,
    );
  }, [previewImage]);

  const onTraceClicked = async () => {
    if (busy || !engine) return;
    setBusy(true);
    setStatus(_('Trace: Starting trace...'));
    // Let the status show before the synchronous tracing.
    await new Promise((r) => setTimeout(r, 0));
    const outcome = await trace(engine, selection);
    setBusy(false);
    setStatus(
      'error' in outcome
        ? outcome.error.replace(/<\/?b>/g, '')
        : _('Trace: Done. %1 node(s) created').replace('%1', String(outcome.nodes)),
    );
  };

  const details = (
    <>
      <div className="docprops-row">
        <Check
          label={_('Speckles')}
          tooltip={_('Ignore small spots (speckles) in the bitmap')}
          checked={o.speckles_on}
          onChange={(v) => set({ speckles_on: v })}
        />
        <SpinButton
          label=""
          tooltip={_('Speckles of up to this many pixels will be suppressed')}
          value={o.speckles}
          min={0}
          max={1000}
          step={1}
          digits={0}
          onChange={(v) => set({ speckles: v })}
        />
      </div>
      <div className="docprops-row">
        <Check
          label={_('Smooth corners')}
          tooltip={_('Smooth out sharp corners of the trace')}
          checked={o.smooth_on}
          onChange={(v) => set({ smooth_on: v })}
        />
        <SpinButton
          label=""
          tooltip={_('Increase this to smooth corners more')}
          value={o.smooth}
          min={0}
          max={1.34}
          step={0.01}
          digits={2}
          onChange={(v) => set({ smooth: v })}
        />
      </div>
      <div className="docprops-row">
        <Check
          label={_('Optimize')}
          tooltip={_('Try to optimize paths by joining adjacent Bezier curve segments')}
          checked={o.optimize_on}
          onChange={(v) => set({ optimize_on: v })}
        />
        <SpinButton
          label=""
          tooltip={_(
            'Increase this to reduce the number of nodes in the trace by more aggressive optimization',
          )}
          value={o.optimize}
          min={0}
          max={5}
          step={0.05}
          digits={3}
          onChange={(v) => set({ optimize: v })}
        />
      </div>
    </>
  );

  const pages: [Page, string][] = [
    [Page.SingleScan, _('Single scan')],
    [Page.MultiScan, _('Multicolor')],
    [Page.PixelArt, _('Pixel art')],
  ];

  return (
    <div className="docprops-tabs">
      <div className="docprops-tabbar" role="tablist">
        {pages.map(([page, text]) => (
          <button
            key={page}
            type="button"
            role="tab"
            aria-selected={o.page === page}
            onClick={() => set({ page })}
          >
            {text}
          </button>
        ))}
      </div>
      <div className="docprops">
        {o.page === Page.SingleScan && (
          <>
            <label className="docprops-row">
              <span>{_('Detection mode')}</span>
              <select value={o.CBT_SS} onChange={(e) => set({ CBT_SS: Number(e.target.value) })}>
                {cbt_ss_map.map(([, text], i) => (
                  <option key={text} value={i}>
                    {_(text)}
                  </option>
                ))}
              </select>
            </label>
            {o.CBT_SS === 0 && (
              <SpinButton
                label={_('Threshold')}
                tooltip={_('Threshold')}
                value={o.SS_BC_T}
                min={0}
                max={1}
                step={0.01}
                digits={3}
                onChange={(v) => set({ SS_BC_T: v })}
              />
            )}
            {o.CBT_SS === 1 && (
              <SpinButton
                label={_('Edge threshold')}
                tooltip={_('Edge threshold')}
                value={o.SS_ED_T}
                min={0}
                max={1}
                step={0.01}
                digits={3}
                onChange={(v) => set({ SS_ED_T: v })}
              />
            )}
            {o.CBT_SS === 2 && (
              <SpinButton
                label={_('Colors')}
                tooltip={_('Colors')}
                value={o.SS_CQ_T}
                min={2}
                max={64}
                step={1}
                digits={0}
                onChange={(v) => set({ SS_CQ_T: v })}
              />
            )}
            <Check
              label={_('Invert image')}
              tooltip={_('Invert black and white regions')}
              checked={o.invert}
              onChange={(v) => set({ invert: v })}
            />
            {details}
          </>
        )}
        {o.page === Page.MultiScan && (
          <>
            <label className="docprops-row">
              <span>{_('Detection mode')}</span>
              <select value={o.CBT_MS} onChange={(e) => set({ CBT_MS: Number(e.target.value) })}>
                {cbt_ms_map.map(([, text], i) => (
                  <option key={text} value={i}>
                    {_(text)}
                  </option>
                ))}
              </select>
            </label>
            <SpinButton
              label={_('Scans')}
              tooltip={_('The desired number of scans')}
              value={o.MS_scans}
              min={1}
              max={255}
              step={1}
              digits={0}
              onChange={(v) => set({ MS_scans: v })}
            />
            <Check
              label={_('Smooth')}
              tooltip={_('Apply Gaussian blur to the bitmap before tracing')}
              checked={o.MS_smooth}
              onChange={(v) => set({ MS_smooth: v })}
            />
            <Check
              label={_('Stack')}
              tooltip={_('Stack scans on top of one another (no gaps) instead of tiling (usually with gaps)')}
              checked={o.MS_stack}
              onChange={(v) => set({ MS_stack: v })}
            />
            <Check
              label={_('Remove background')}
              tooltip={_('Remove bottom (background) layer when done')}
              checked={o.MS_rb}
              onChange={(v) => set({ MS_rb: v })}
            />
            {details}
          </>
        )}
        {!engine && <p className="docprops-row">Autotrace and pixel art tracing are not available yet.</p>}
        <div className="docprops-row">
          <Check
            label={_('Live updates')}
            checked={live}
            onChange={(v) => {
              setLive(v);
              prefs.setBool(LIVE_UPDATE, v);
            }}
          />
          <button type="button" onClick={() => void updatePreview()}>
            {_('Update preview')}
          </button>
        </div>
        <fieldset className="trace-preview" style={{ border: '1px solid #ccc' }}>
          <legend>{_('Preview')}</legend>
          <canvas ref={canvas} style={{ maxWidth: '100%', imageRendering: 'pixelated' }} />
        </fieldset>
        <div className="docprops-row">
          <button type="button" title={_('Reset')} onClick={() => setOptions(trace_defaults())}>
            {_('Reset')}
          </button>
          <button type="button" disabled={busy || !engine} onClick={() => void onTraceClicked()}>
            {_('Apply')}
          </button>
        </div>
        {status && <p className="docprops-row">{status}</p>}
      </div>
    </div>
  );
}
