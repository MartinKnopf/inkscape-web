// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/fill-and-stroke.cpp, src/ui/dialog/fill-and-stroke.h, src/ui/widget/stroke-style.cpp, src/ui/widget/paint-switch.cpp, src/ui/widget/color-notebook.cpp, src/ui/widget/gradient-editor.cpp
import {
  _,
  C_,
  type Colors,
  type SPGradient,
  SPGradientSpread,
  SPGradientType,
  SPRadialGradient,
  SPStrokeCapType,
  SPStrokeJoinType,
  SPWindRule,
} from '@inkscape-web/core';
import {
  addGradientStop,
  CAP_NAMES,
  colorFromHsva,
  colorFromRgba8,
  colorToHex,
  colorToHsva,
  colorToRgba8,
  DASH_PATTERNS,
  deleteGradientStop,
  gradientStops,
  type Hsva,
  JOIN_NAMES,
  type PaintInfo,
  PaintMode,
  parseHexColor,
  QUERY_STYLE_MULTIPLE_AVERAGED,
  queryOpacity,
  queryPaint,
  queryStrokeStyle,
  reverseGradient,
  type SPDesktop,
  STROKE_UNITS,
  type StrokeStyleInfo,
  type StrokeUnit,
  setFillRule,
  setFlatColor,
  setGradient,
  setGradientRepeat,
  setOpacity,
  setPaintMode,
  setStopColor,
  setStopOffset,
  setStrokeDash,
  setStrokeJoinOrCap,
  setStrokeMiter,
  setStrokeWidth,
  sliderBackground,
} from '@inkscape-web/editor';
import { useId, useState } from 'react';
import { useActiveDesktop } from '../../app/active-desktop.ts';
import { iconFallback, iconUrl } from '../icon-loader.ts';
import { SpinButton } from '../widget/spinbutton.tsx';
import { useReprVersion, useSelectionVersion } from './use-repr.ts';

const TABS = [_('_Fill'), _('Stroke _paint'), _('Stroke st_yle')];

/** Remove the GTK mnemonic marker ("_Fill" → "Fill"). */
const label = (s: string) => s.replace('_', '');

/**
 * The Fill and Stroke dialog (dialog key "FillStroke"): the tabs Fill, Stroke paint and Stroke
 * style for the selection, and the opacity.
 * TODO: mesh, pattern and swatch paints, the gradient library, the Advanced tab, markers, paint order,
 * hairline strokes, blur, blend mode and isolation, icons.
 */
export function FillAndStrokeDialog() {
  const desktop = useActiveDesktop();
  useReprVersion(desktop?.doc.rroot ?? null);
  useSelectionVersion(desktop);
  const [tab, setTab] = useState(0);
  if (!desktop) return null;

  return (
    <div className="fillstroke-dialog">
      <div className="fillstroke-tabs" role="tablist">
        {TABS.map((t, i) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === i}
            className={tab === i ? 'active' : undefined}
            onClick={() => setTab(i)}
          >
            {label(t)}
          </button>
        ))}
      </div>
      <div className="fillstroke-page" role="tabpanel">
        {tab === 0 && <PaintPage desktop={desktop} isFill={true} />}
        {tab === 1 && <PaintPage desktop={desktop} isFill={false} />}
        {tab === 2 && <StrokeStylePage desktop={desktop} />}
      </div>
      <OpacityRow desktop={desktop} />
    </div>
  );
}

// Paint -----------------------------------------------------------------------------------------

/** The paint mode buttons (upstream paint_modes in paint-switch.cpp); only the implemented modes work. */
const PAINT_MODES: { mode: PaintMode; name: string; tip: string; implemented: boolean }[] = [
  { mode: PaintMode.Solid, name: C_('Paint type', 'Flat'), tip: _('Flat color'), implemented: true },
  {
    mode: PaintMode.Gradient,
    name: C_('Paint type', 'Gradient'),
    tip: _('Linear gradient fill'),
    implemented: true,
  },
  { mode: PaintMode.Mesh, name: C_('Paint type', 'Mesh'), tip: _('Mesh fill'), implemented: false },
  {
    mode: PaintMode.Pattern,
    name: C_('Paint type', 'Pattern'),
    tip: _('Pattern and hatch fill'),
    implemented: false,
  },
  { mode: PaintMode.Swatch, name: C_('Paint type', 'Swatch'), tip: _('Swatch color'), implemented: false },
  { mode: PaintMode.Derived, name: C_('Paint type', 'Inherited'), tip: _('Inherited'), implemented: true },
  { mode: PaintMode.None, name: C_('Paint type', 'None'), tip: _('No paint'), implemented: true },
];

function PaintPage({ desktop, isFill }: { desktop: SPDesktop; isFill: boolean }) {
  const info: PaintInfo = queryPaint(desktop, isFill);
  if (info.kind === 'empty') return <p className="fillstroke-placeholder">{_('No object selected')}</p>;
  if (info.kind === 'multiple') return <p className="fillstroke-placeholder">{_('Multiple styles')}</p>;

  return (
    <div>
      <div className="paint-modes">
        {PAINT_MODES.map(({ mode, name, tip, implemented }) => (
          <button
            key={mode}
            type="button"
            aria-pressed={info.mode === mode}
            disabled={!implemented}
            title={implemented ? tip : `${tip} (TODO)`}
            onClick={() =>
              mode === PaintMode.Solid
                ? setFlatColor(desktop, info.color, isFill)
                : setPaintMode(desktop, isFill, mode)
            }
          >
            {name}
          </button>
        ))}
      </div>
      {info.mode === PaintMode.Solid && (
        <ColorEditor color={info.color} onChange={(c) => setFlatColor(desktop, c, isFill)} />
      )}
      {info.mode === PaintMode.Gradient && info.gradient && (
        <GradientEditor desktop={desktop} isFill={isFill} gradient={info.gradient} />
      )}
      {info.mode === PaintMode.None && <p className="fillstroke-placeholder">{_('No paint')}</p>}
      {info.mode === PaintMode.Derived && <p className="fillstroke-placeholder">{_('Inherited')}</p>}
      {isFill && (
        <div className="fillstroke-row">
          <span>fill-rule</span>
          <button
            type="button"
            aria-pressed={info.fillRule === SPWindRule.SP_WIND_RULE_NONZERO}
            onClick={() => setFillRule(desktop, SPWindRule.SP_WIND_RULE_NONZERO)}
          >
            {_('non-zero')}
          </button>
          <button
            type="button"
            aria-pressed={info.fillRule === SPWindRule.SP_WIND_RULE_EVENODD}
            onClick={() => setFillRule(desktop, SPWindRule.SP_WIND_RULE_EVENODD)}
          >
            {_('even-odd')}
          </button>
        </div>
      )}
    </div>
  );
}

// Gradient editor -------------------------------------------------------------------------------

/** The repeat modes (upstream sp_get_spread_repeats). */
const SPREAD_REPEATS: readonly [SPGradientSpread, string][] = [
  [SPGradientSpread.SP_GRADIENT_SPREAD_PAD, C_('Gradient repeat type', 'None')],
  [SPGradientSpread.SP_GRADIENT_SPREAD_REPEAT, C_('Gradient repeat type', 'Direct')],
  [SPGradientSpread.SP_GRADIENT_SPREAD_REFLECT, C_('Gradient repeat type', 'Reflected')],
];

/**
 * Editor of the gradient of the selection (upstream GradientEditor, reduced): linear or radial,
 * repeat, the list of stops, the offset and the color of the selected stop, add, remove, reverse.
 * TODO: the gradient library, the angle, the stops on a preview strip.
 */
function GradientEditor(props: { desktop: SPDesktop; isFill: boolean; gradient: SPGradient }) {
  const { desktop, isFill, gradient } = props;
  const [index, setIndex] = useState(0);
  const stops = gradientStops(gradient);
  const current = stops[Math.min(index, stops.length - 1)];
  const radial = gradient instanceof SPRadialGradient;
  const setType = (type: SPGradientType) => setGradient(desktop, isFill, gradient.getVector(), type);
  const background = `linear-gradient(to right, ${stops
    .map((s) => `${s.getColor().toString()} ${s.offset * 100}%`)
    .join(', ')})`;

  return (
    <div className="gradient-editor">
      <div className="fillstroke-row">
        <button
          type="button"
          title={_('Linear gradient')}
          aria-pressed={!radial}
          onClick={() => setType(SPGradientType.SP_GRADIENT_TYPE_LINEAR)}
        >
          <Icon name="paint-gradient-linear" />
        </button>
        <button
          type="button"
          title={_('Radial gradient')}
          aria-pressed={radial}
          onClick={() => setType(SPGradientType.SP_GRADIENT_TYPE_RADIAL)}
        >
          <Icon name="paint-gradient-radial" />
        </button>
        <select
          title={_('Repeat mode')}
          value={gradient.getSpread()}
          onChange={(e) => setGradientRepeat(gradient, Number(e.target.value) as SPGradientSpread)}
        >
          {SPREAD_REPEATS.map(([mode, label]) => (
            <option key={mode} value={mode}>
              {label}
            </option>
          ))}
        </select>
        <button
          type="button"
          title={_('Reverse the direction of the gradient')}
          onClick={() => reverseGradient(gradient)}
        >
          <Icon name="object-flip-horizontal" />
        </button>
      </div>
      <div className="gradient-preview" style={{ backgroundImage: background }} />
      <div className="gradient-stops" role="listbox" aria-label={_('Stop')}>
        {stops.map((s, i) => (
          <button
            key={s.getId() ?? i}
            type="button"
            role="option"
            aria-selected={s === current}
            onClick={() => setIndex(i)}
          >
            <span className="stop-swatch" style={{ background: s.getColor().toString() }} />
            {s.getId()}
          </button>
        ))}
      </div>
      {current && (
        <>
          <div className="fillstroke-row">
            <SpinButton
              label={_('Offset')}
              tooltip={_('Offset of selected stop')}
              value={current.offset * 100}
              min={0}
              max={100}
              step={1}
              digits={1}
              suffix="%"
              onChange={(v) => setStopOffset(current, v / 100)}
            />
            <button
              type="button"
              title={_('Add stop')}
              onClick={() => {
                const added = addGradientStop(gradient, current);
                if (added) setIndex(gradientStops(gradient).indexOf(added));
              }}
            >
              <Icon name="gradient-add-stop" />
            </button>
            <button
              type="button"
              title={_('Remove stop')}
              disabled={stops.length <= 2}
              onClick={() => deleteGradientStop(gradient, current)}
            >
              <Icon name="gradient-remove-stop" />
            </button>
          </div>
          <ColorEditor color={current.getColor()} onChange={(c) => setStopColor(current, c)} />
        </>
      )}
    </div>
  );
}

/** An icon of the icon theme. */
function Icon({ name }: { name: string }) {
  return <img src={iconUrl(name)} alt="" width={16} height={16} onError={iconFallback(name)} />;
}

// Color editor ----------------------------------------------------------------------------------

type Channel = 'r' | 'g' | 'b' | 'a' | 'h' | 's' | 'v';

/** A slider with a color gradient as background; value and max are in the shown units. */
function ChannelSlider(props: {
  name: string;
  channel: Channel;
  color: Colors.Color;
  value: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const { name, channel, color, value, max, onChange } = props;
  const id = useId();
  return (
    <div className="channel-row">
      <label htmlFor={id}>{name}</label>
      <input
        id={id}
        type="range"
        className={`channel-slider${channel === 'a' ? ' alpha' : ''}`}
        style={{ backgroundImage: sliderBackground(channel, color) }}
        min={0}
        max={max}
        step={1}
        value={Math.round(value)}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <SpinButton
        label=""
        tooltip={name}
        value={Math.round(value)}
        min={0}
        max={max}
        step={1}
        digits={0}
        onChange={onChange}
      />
    </div>
  );
}

/**
 * Editor of a flat color: RGBA and HSV sliders, a saturation/value picker and a hex entry
 * (upstream ColorNotebook with the RGB and HSV pages). A hue and saturation that the color
 * cannot hold (grays) are kept while the user edits.
 */
function ColorEditor({ color, onChange }: { color: Colors.Color; onChange: (color: Colors.Color) => void }) {
  const rgba = colorToRgba8(color);
  const hex = colorToHex(color);
  // The hsva that the user last set: valid while the color is the one that it produced.
  const [kept, setKept] = useState<{ hex: string; hsva: Hsva } | null>(null);
  const hsva = kept?.hex === hex ? kept.hsva : colorToHsva(color);

  const emitRgba = (next: typeof rgba) => {
    setKept(null);
    onChange(colorFromRgba8(next));
  };
  const emitHsva = (next: Hsva) => {
    const c = colorFromHsva(next);
    setKept({ hex: colorToHex(c), hsva: next });
    onChange(c);
  };
  const [hexText, setHexText] = useState<string | null>(null);
  const commitHex = () => {
    const parsed = hexText === null ? undefined : parseHexColor(hexText);
    setHexText(null);
    if (parsed) {
      setKept(null);
      onChange(parsed);
    }
  };

  return (
    <div className="color-editor">
      <SaturationValuePicker hsva={hsva} onChange={emitHsva} />
      <ChannelSlider
        name={_('R')}
        channel="r"
        color={color}
        value={rgba[0]}
        max={255}
        onChange={(v) => emitRgba([v, rgba[1], rgba[2], rgba[3]])}
      />
      <ChannelSlider
        name={_('G')}
        channel="g"
        color={color}
        value={rgba[1]}
        max={255}
        onChange={(v) => emitRgba([rgba[0], v, rgba[2], rgba[3]])}
      />
      <ChannelSlider
        name={_('B')}
        channel="b"
        color={color}
        value={rgba[2]}
        max={255}
        onChange={(v) => emitRgba([rgba[0], rgba[1], v, rgba[3]])}
      />
      <ChannelSlider
        name={_('A')}
        channel="a"
        color={color}
        value={rgba[3]}
        max={255}
        onChange={(v) => emitRgba([rgba[0], rgba[1], rgba[2], v])}
      />
      <ChannelSlider
        name={_('H')}
        channel="h"
        color={color}
        value={hsva.h * 360}
        max={360}
        onChange={(v) => emitHsva({ ...hsva, h: v / 360 })}
      />
      <ChannelSlider
        name={_('S')}
        channel="s"
        color={color}
        value={hsva.s * 100}
        max={100}
        onChange={(v) => emitHsva({ ...hsva, s: v / 100 })}
      />
      <ChannelSlider
        name={_('V')}
        channel="v"
        color={color}
        value={hsva.v * 100}
        max={100}
        onChange={(v) => emitHsva({ ...hsva, v: v / 100 })}
      />
      <label className="channel-row hex-row">
        <span>{_('RGBA:')}</span>
        <input
          type="text"
          className="hex-entry"
          spellCheck={false}
          value={hexText ?? hex}
          aria-invalid={hexText !== null && !parseHexColor(hexText)}
          onChange={(e) => setHexText(e.target.value)}
          onBlur={commitHex}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitHex();
            else if (e.key === 'Escape') setHexText(null);
          }}
        />
      </label>
    </div>
  );
}

/** The 2D picker: saturation to the right, value up, on the color of the hue. */
function SaturationValuePicker({ hsva, onChange }: { hsva: Hsva; onChange: (hsva: Hsva) => void }) {
  const pick = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const s = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
    const v = Math.min(1, Math.max(0, 1 - (e.clientY - box.top) / box.height));
    onChange({ ...hsva, s, v });
  };
  return (
    <div
      className="sv-picker"
      role="presentation"
      style={{ backgroundColor: colorFromHsva({ h: hsva.h, s: 1, v: 1, a: 1 }).toString(false) }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        pick(e);
      }}
      onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && pick(e)}
    >
      <div className="sv-handle" style={{ left: `${hsva.s * 100}%`, top: `${(1 - hsva.v) * 100}%` }} />
    </div>
  );
}

// Stroke style ----------------------------------------------------------------------------------

const JOINS = [
  { value: SPStrokeJoinType.SP_STROKE_LINEJOIN_BEVEL, name: _('Bevel'), tip: _('Bevel join') },
  { value: SPStrokeJoinType.SP_STROKE_LINEJOIN_ROUND, name: _('Round'), tip: _('Round join') },
  { value: SPStrokeJoinType.SP_STROKE_LINEJOIN_MITER, name: _('Miter'), tip: _('Miter join') },
];
const CAPS = [
  { value: SPStrokeCapType.SP_STROKE_LINECAP_BUTT, name: _('Butt'), tip: _('Butt cap') },
  { value: SPStrokeCapType.SP_STROKE_LINECAP_ROUND, name: _('Round'), tip: _('Round cap') },
  { value: SPStrokeCapType.SP_STROKE_LINECAP_SQUARE, name: _('Square'), tip: _('Square cap') },
];

const sameDash = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((x, i) => Math.abs(x - (b[i] ?? Number.NaN)) < 1e-6);

function StrokeStylePage({ desktop }: { desktop: SPDesktop }) {
  const info: StrokeStyleInfo | null = queryStrokeStyle(desktop);
  // The unit that the user chose; averaged widths are shown in percent (upstream updateLine).
  const [unitAbbr, setUnitAbbr] = useState('px');
  if (!info) return <p className="fillstroke-placeholder">{_('No object selected')}</p>;

  const percent = STROKE_UNITS.find((u) => u.abbr === '%') as StrokeUnit;
  const chosen = STROKE_UNITS.find((u) => u.abbr === unitAbbr) ?? (STROKE_UNITS[0] as StrokeUnit);
  const unit =
    info.widthResult === QUERY_STYLE_MULTIPLE_AVERAGED
      ? percent
      : chosen.pxPerUnit === null
        ? (STROKE_UNITS[0] as StrokeUnit)
        : chosen;
  const shownWidth = unit.pxPerUnit === null ? 100 : info.width / unit.pxPerUnit;

  return (
    <div className="stroke-style">
      <div className="fillstroke-row">
        <SpinButton
          label={C_('Stroke width', 'Width')}
          tooltip={_('Stroke width')}
          value={shownWidth}
          min={0}
          max={100000}
          step={unit.abbr === 'px' ? 1 : 0.1}
          digits={3}
          onChange={(v) => setStrokeWidth(desktop, v, unit)}
        />
        <select
          value={unit.abbr}
          aria-label={_('Stroke width')}
          onChange={(e) => setUnitAbbr(e.target.value)}
        >
          {STROKE_UNITS.map((u) => (
            <option key={u.abbr} value={u.abbr}>
              {u.abbr}
            </option>
          ))}
        </select>
      </div>

      <div className="fillstroke-row">
        <span>{_('Join')}</span>
        {JOINS.map((j) => (
          <button
            key={j.value}
            type="button"
            title={j.tip}
            disabled={!info.enabled}
            aria-pressed={info.join === j.value}
            onClick={() => setStrokeJoinOrCap(desktop, 'stroke-linejoin', JOIN_NAMES[j.value])}
          >
            {j.name}
          </button>
        ))}
      </div>
      <div className="fillstroke-row">
        <span>{_('Cap')}</span>
        {CAPS.map((c) => (
          <button
            key={c.value}
            type="button"
            title={c.tip}
            disabled={!info.enabled}
            aria-pressed={info.cap === c.value}
            onClick={() => setStrokeJoinOrCap(desktop, 'stroke-linecap', CAP_NAMES[c.value])}
          >
            {c.name}
          </button>
        ))}
      </div>
      <div className="fillstroke-row">
        <SpinButton
          label={_('Miter limit')}
          tooltip={_('Maximum length of the miter (in units of stroke width)')}
          value={info.miterLimit}
          min={0}
          max={100000}
          step={0.1}
          digits={2}
          disabled={!info.enabled}
          onChange={(v) => setStrokeMiter(desktop, v)}
        />
      </div>

      <div className="fillstroke-row dashes-label">
        <span>{_('Dashes')}</span>
      </div>
      <div className="dash-list" role="listbox" aria-label={_('Dashes')}>
        {DASH_PATTERNS.map((dash) => (
          <button
            key={dash.join(',') || 'solid'}
            type="button"
            role="option"
            aria-selected={sameDash(dash, info.dash)}
            disabled={!info.enabled}
            title={dash.join(' ') || _('Solid')}
            onClick={() => setStrokeDash(desktop, dash, info.dashOffset)}
          >
            <svg width="100%" height="8" viewBox="0 0 80 8" preserveAspectRatio="none" aria-hidden="true">
              <line
                x1="0"
                y1="4"
                x2="80"
                y2="4"
                stroke="currentColor"
                strokeWidth="2"
                strokeDasharray={dash.length ? dash.map((d) => d * 2).join(' ') : undefined}
              />
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
}

// Opacity ---------------------------------------------------------------------------------------

/** The opacity slider at the bottom (upstream ObjectCompositeSettings). TODO: blur, blend mode, isolation. */
function OpacityRow({ desktop }: { desktop: SPDesktop }) {
  const opacity = queryOpacity(desktop);
  const percent = Math.round((opacity ?? 1) * 1000) / 10;
  return (
    <div className="fillstroke-opacity channel-row">
      <label htmlFor="fillstroke-opacity">{_('Opacity (%)')}</label>
      <input
        id="fillstroke-opacity"
        type="range"
        min={0}
        max={100}
        step={0.1}
        value={percent}
        disabled={opacity === null}
        onChange={(e) => setOpacity(desktop, Number(e.target.value) / 100)}
      />
      <SpinButton
        label=""
        tooltip={_('Opacity (%)')}
        value={percent}
        min={0}
        max={100}
        step={1}
        digits={1}
        disabled={opacity === null}
        onChange={(v) => setOpacity(desktop, v / 100)}
      />
    </div>
  );
}
