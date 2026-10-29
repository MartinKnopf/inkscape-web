// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/inkscape-preferences.cpp, src/ui/dialog/inkscape-preferences.h
/*
 * Inkscape Preferences dialog.
 *
 * Authors:
 *   Carl Hetherington
 *   Marco Scholten
 *   Bruno Dilly <bruno.dilly@gmail.com>
 *   Kris De Gussem <Kris.DeGussem@gmail.com>
 *
 * Copyright (C) 2004-2013 Authors
 */
import { _, C_, Preferences, spReprCssWriteString } from '@inkscape-web/core';
import { InkscapeApplication, take_style_from_item } from '@inkscape-web/editor';
import { type ReactNode, useEffect, useState } from 'react';
import { getActiveDesktop } from '../../app/active-desktop.ts';
import { availableLanguages } from '../../app/language.ts';
import { getRecentFiles } from '../../app/recent-files.ts';
import {
  PrefCheckButton,
  PrefCombo,
  PrefHeader,
  PrefRadioGroup,
  PrefRow,
  PrefSpinButton,
  usePref,
} from '../widget/preferences-widget.tsx';
import { languageChoices } from './preferences-languages.ts';

/** The text of a label with mnemonic marker without the marker. */
const label = (s: string) => s.replace(/_(?!_)/g, '');

/** A message of upstream's status bar without its bold markup. */
const plain = (s: string) => s.replace(/<\/?b>/g, '');

/** The page of a tool, titled with the name of the tool. */
const toolLabel = (tool: string) =>
  InkscapeApplication.instance().get_action_extra_data().get_label_for_action(`win.tool-switch('${tool}')`) ||
  tool;

// ---------------------------------------------------------------- shared parts

/** Upstream AddSelcueCheckbox. */
const Selcue = ({ path, def }: { path: string; def: boolean }) => (
  <PrefCheckButton
    label={_('Show selection cue')}
    path={`${path}/selcue`}
    def={def}
    tip={_('Whether selected objects display a selection cue (the same as in selector)')}
  />
);

/** Upstream AddGradientCheckbox. */
const GradientDrag = ({ path, def }: { path: string; def: boolean }) => (
  <PrefCheckButton
    label={_('Enable gradient editing')}
    path={`${path}/gradientdrag`}
    def={def}
    tip={_('Whether selected objects display gradient editing controls')}
  />
);

/**
 * Remove the properties that cannot be a default style: "we cannot store properties with uris -
 * they will be invalid in other documents" (upstream sp_css_attr_unset_uris).
 */
function withoutUris(style: string): string {
  return style
    .split(';')
    .filter((declaration) => declaration.trim() && !declaration.includes('url('))
    .join(';');
}

/** A swatch with the fill and stroke of the style at path. */
function StyleSwatch({ path }: { path: string }) {
  const style = Preferences.get().getStyle(`${path}/style`);
  usePref(`${path}/style`, '');
  return (
    <span
      className="pref-swatch"
      title={_("This tool's style of new objects")}
      style={{
        background: style.attribute('fill') ?? 'none',
        borderColor: style.attribute('stroke') ?? '#888',
      }}
    />
  );
}

/**
 * Which style new objects get (upstream AddNewObjectsStyle): the last used
 * style, the last used style of the object type, or the style of the tool.
 */
function NewObjectsStyle({ path, itemType, banner }: { path: string; itemType: string; banner?: string }) {
  const usecurrent = usePref(`${path}/usecurrent`, itemType);
  const [error, setError] = useState('');
  const options = [
    { label: _('Last used style'), value: '1', tip: _('Apply the style you last set on an object') },
    ...(itemType.length >= 2
      ? [
          {
            label: _("Object type's last used style"),
            value: itemType,
            tip: _('Apply the style you last set on an object of the same type that this tool creates'),
          },
        ]
      : []),
    {
      label: _("This tool's own style:"),
      value: '0',
      tip: _(
        'Each tool may store its own style to apply to the newly created objects. Use the button below to set it.',
      ),
    },
  ];

  // Upstream StyleFromSelectionToTool
  const takeFromSelection = () => {
    const selection = getActiveDesktop()?.getSelection();
    if (!selection || selection.isEmpty()) {
      setError(plain(_('<b>No objects selected</b> to take the style from.')));
      return;
    }
    const item = selection.singleItem();
    if (!item) {
      setError(plain(_('<b>More than one object selected.</b>  Cannot take style from multiple objects.')));
      return;
    }
    setError('');
    Preferences.get().setString(
      `${path}/style`,
      withoutUris(spReprCssWriteString(take_style_from_item(item))),
    );
  };

  return (
    <>
      <PrefHeader text={banner ?? _('Style of new objects')} />
      <PrefRadioGroup path={`${path}/usecurrent`} def={itemType} options={options} />
      <PrefRow indent tip={_("Remember the style of the (first) selected object as this tool's style")}>
        <StyleSwatch path={path} />{' '}
        <button type="button" disabled={usecurrent !== '0'} onClick={takeFromSelection}>
          {_('Take from selection')}
        </button>
        {error && <span className="pref-error"> {error}</span>}
      </PrefRow>
    </>
  );
}

/** Page content of a page that is not ported. */
const NotPorted = () => <p className="pref-note">{'This page is not ported yet.'}</p>;

// ---------------------------------------------------------------------- pages

const Tools = () => (
  <>
    <PrefHeader text={_('Bounding box to use')} />
    <PrefRadioGroup
      path="/tools/bounding_box"
      def={0}
      options={[
        {
          label: _('Visual bounding box'),
          value: 0,
          tip: _('This bounding box includes stroke width, markers, filter margins, etc.'),
        },
        {
          label: _('Geometric bounding box'),
          value: 1,
          tip: _('This bounding box includes only the bare path'),
        },
      ]}
    />
  </>
);

const Selector = () => (
  <>
    <Selcue path="/tools/select" def={false} />
    <GradientDrag path="/tools/select" def={false} />
    <PrefHeader text={_('Per-object selection cue')} />
    <PrefRadioGroup
      path="/options/selcue/value"
      def={2}
      options={[
        { label: C_('Selection cue', 'None'), value: 0, tip: _('No per-object selection indication') },
        {
          label: _('Mark'),
          value: 1,
          tip: _('Each selected object has a diamond mark in the top left corner'),
        },
        { label: _('Box'), value: 2, tip: _('Each selected object displays its bounding box') },
      ]}
    />
  </>
);

const Node = () => (
  <>
    <Selcue path="/tools/nodes" def />
    <GradientDrag path="/tools/nodes" def />
  </>
);

const Shapes = () => (
  <>
    <Selcue path="/tools/shapes" def />
    <GradientDrag path="/tools/shapes" def />
  </>
);

const Pencil = () => (
  <>
    <Selcue path="/tools/freehand/pencil" def />
    <NewObjectsStyle path="/tools/freehand/pencil" itemType="path" />
    <PrefHeader text={_('Sketch mode')} />
    <PrefCheckButton
      label={_('Average all sketches')}
      path="/tools/freehand/pencil/average_all_sketches"
      def={false}
      indent
      tip={_(
        'If on, the sketch result will be the normal average of all sketches made, instead of averaging the old result with the new sketch',
      )}
    />
  </>
);

const Pen = () => (
  <>
    <Selcue path="/tools/freehand/pen" def />
    <NewObjectsStyle path="/tools/freehand/pen" itemType="path" />
  </>
);

const Zoom = () => (
  <>
    <Selcue path="/tools/zoom" def />
    <GradientDrag path="/tools/zoom" def={false} />
  </>
);

/** Interface page: language and the recent files (upstream initPageUI). */
function Interface() {
  const [languages, setLanguages] = useState<string[] | null>(null);
  useEffect(() => void availableLanguages().then(setLanguages), []);
  const language = usePref('/ui/language', '');
  const [changedLanguage, setChangedLanguage] = useState(false);
  // The languages of upstream's list that have a catalog.
  const options = [
    { label: _('System default'), value: '' },
    ...languageChoices()
      .filter(([code]) => languages?.includes(code) || code === language)
      .map(([value, text]) => ({ label: text, value }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  ];
  return (
    <>
      <PrefCombo
        path="/ui/language"
        def=""
        options={options}
        label={_('Language:')}
        tip={_('Set the language for menus and number formats')}
        onChange={() => setChangedLanguage(true)}
      />
      {changedLanguage && (
        <PrefRow>
          <span className="pref-note">{_('Requires restart to take effect')} </span>
          <button type="button" onClick={() => location.reload()}>
            {'Reload'}
          </button>
        </PrefRow>
      )}
      <PrefSpinButton
        path="/options/maxrecentdocuments/value"
        min={0}
        max={1000}
        step={1}
        def={36}
        integer
        label={label(_('Maximum documents\n in Open _Recent:'))}
        tip={_('Set the maximum length of the Open Recent list in the File menu, or clear the list')}
      />
      <PrefRow>
        <button type="button" onClick={() => void getRecentFiles().clear()}>
          {_('Clear list')}
        </button>
      </PrefRow>
    </>
  );
}

const SvgOutput = () => (
  <>
    <PrefHeader text={_('Path data')} />
    <PrefCombo
      path="/options/svgoutput/pathstring_format"
      def={2}
      options={[
        { label: _('Absolute'), value: 0 },
        { label: _('Relative'), value: 1 },
        { label: _('Optimized'), value: 2 },
      ]}
      label={_('Path string format:')}
      tip={_(
        'Path data should be written: only with absolute coordinates, only with relative coordinates, or optimized for string length (mixed absolute and relative coordinates)',
      )}
    />
    <PrefCheckButton
      label={_('Force repeat commands')}
      path="/options/svgoutput/forcerepeatcommands"
      def={false}
      indent
      tip={_("Force repeating of the same path command (for example, 'L 1,2 L 3,4' instead of 'L 1,2 3,4')")}
    />
    <PrefHeader text={_('Numbers')} />
    <PrefSpinButton
      path="/options/svgoutput/numericprecision"
      min={1}
      max={16}
      step={1}
      def={10}
      integer
      indent
      label={label(_('_Numeric precision:'))}
      tip={_('Significant figures of the values written to the SVG file')}
    />
    <PrefSpinButton
      path="/options/svgoutput/minimumexponent"
      min={-32}
      max={-1}
      step={1}
      def={-8}
      integer
      indent
      label={label(_('Minimum _exponent:'))}
      tip={_(
        'The smallest number written to SVG is 10 to the power of this exponent; anything smaller is written as zero',
      )}
    />
  </>
);

const Autosave = () => (
  <>
    <PrefCheckButton
      label={_('Enable autosave')}
      path="/options/autosave/enable"
      def
      tip={_(
        'Automatically save the current document(s) at a given interval, thus minimizing loss in case of a crash',
      )}
    />
    <PrefSpinButton
      path="/options/autosave/interval"
      min={1}
      max={10800}
      step={1}
      def={10}
      integer
      label={label(_('_Interval (in minutes):'))}
      tip={_('Interval (in minutes) at which document will be autosaved')}
    />
    <PrefSpinButton
      path="/options/autosave/max"
      min={1}
      max={10000}
      step={1}
      def={10}
      integer
      label={label(_('_Maximum number of autosaves:'))}
      tip={_('Maximum number of autosaved files; use this to limit the storage space used')}
    />
  </>
);

const Transforms = () => (
  <>
    <PrefCheckButton
      label={_('Scale stroke width')}
      path="/options/transform/stroke"
      def
      tip={_('When scaling objects, scale the stroke width by the same proportion')}
    />
    <PrefCheckButton
      label={_('Scale rounded corners in rectangles')}
      path="/options/transform/rectcorners"
      def={false}
      tip={_('When scaling rectangles, scale the radii of rounded corners')}
    />
    <PrefCheckButton
      label={_('Transform gradients')}
      path="/options/transform/gradient"
      def
      tip={_('Move gradients (in fill or stroke) along with the objects')}
    />
    <PrefCheckButton
      label={_('Transform patterns')}
      path="/options/transform/pattern"
      def={false}
      tip={_('Move patterns (in fill or stroke) along with the objects')}
    />
    <PrefCheckButton
      label={_('Scale dashes with stroke')}
      path="/options/dash/scale"
      def
      tip={_('When changing stroke width, scale dash array')}
    />
    <PrefHeader text={_('Store transformation')} />
    <PrefRadioGroup
      path="/options/preservetransform/value"
      def={0}
      options={[
        {
          label: _('Optimized'),
          value: 0,
          tip: _('If possible, apply transformation to objects without adding a transform= attribute'),
        },
        {
          label: _('Preserved'),
          value: 1,
          tip: _('Always store transformation as a transform= attribute on objects'),
        },
      ]}
    />
  </>
);

const Snapping = () => (
  <>
    <PrefHeader text={_('Snap indicator')} />
    <PrefCheckButton
      label={_('Enable snap indicator')}
      path="/options/snapindicator/value"
      def
      indent
      tip={_('After snapping, a symbol is drawn at the point that has snapped')}
    />
    <PrefCheckButton
      label={_('Show snap distance in case of alignment or distribution snap')}
      path="/options/snapindicatordistance/value"
      def={false}
      indent
      tip={_('Show snap distance in case of alignment or distribution snap')}
    />
    <PrefSpinButton
      path="/options/snapindicatorpersistence/value"
      min={0.1}
      max={10}
      step={0.1}
      def={2}
      digits={1}
      indent
      label={_('Snap indicator persistence (in seconds):')}
      tip={_('Controls how long the snap indicator message will be shown, before it disappears')}
    />
    <PrefHeader text={_('What should snap')} />
    <PrefCheckButton
      label={_('Only snap the node closest to the pointer')}
      path="/options/snapclosestonly/value"
      def={false}
      indent
      tip={_('Only try to snap the node that is initially closest to the mouse pointer')}
    />
    <PrefCheckButton
      label={_('Snap the mouse pointer when dragging a constrained knot')}
      path="/options/snapmousepointer/value"
      def={false}
      indent
      tip={_(
        'When dragging a knot along a constraint line, then snap the position of the mouse pointer instead of snapping the projection of the knot onto the constraint line',
      )}
    />
    <PrefSpinButton
      path="/options/snapweight/value"
      min={0}
      max={1}
      step={0.1}
      def={0.5}
      digits={1}
      indent
      label={label(_('_Weight factor:'))}
      tip={_(
        'When multiple snap solutions are found, then Inkscape can either prefer the closest transformation (when set to 0), or prefer the node that was initially the closest to the pointer (when set to 1)',
      )}
    />
    <PrefHeader text={_('Delayed snap')} />
    <PrefSpinButton
      path="/options/snapdelay/value"
      min={0}
      max={1}
      step={0.1}
      def={0}
      digits={1}
      indent
      label={_('Delay (in seconds):')}
      tip={_(
        'Postpone snapping as long as the mouse is moving, and then wait an additional fraction of a second. This additional delay is specified here. When set to zero or to a very small number, snapping will be immediate.',
      )}
    />
    <PrefHeader text={_('Restrict Snap Targets')} />
    <PrefCheckButton
      label={_('Always snap to grids')}
      path="/options/snap/grid/always"
      def={false}
      indent
      tip={_(
        'When a grid is visible, and snapping to grids is active, other snap targets will be ignored, unless explicitly allowed below.',
      )}
    />
    <PrefCheckButton
      label={_('Always snap to guides')}
      path="/options/snap/guide/always"
      def={false}
      indent
      tip={_(
        'When there are any guidelines in the current viewport, and snapping to guides is active, other snap targets will be ignored, unless explicitly allowed below.',
      )}
    />
    <PrefHeader text={_('While Always Snapping to Grid/Guides')} />
    <PrefCheckButton
      label={_('Allow snapping to objects')}
      path="/options/snap/object/always"
      def={false}
      indent
      tip={_(
        "Allow snapping to objects while 'Always snap to grids / guides' is active, if an object is closer.",
      )}
    />
    <PrefCheckButton
      label={_('Allow alignment snapping')}
      path="/options/snap/alignment/always"
      def={false}
      indent
      tip={_(
        "Allow alignment snapping while 'Always snap to grids / guides' is active, if an alignment snap target is closer.",
      )}
    />
    <PrefCheckButton
      label={_('Allow distribution snapping')}
      path="/options/snap/distribution/always"
      def={false}
      indent
      tip={_(
        "Allow distribution snapping while 'Always snap to grids / guides' is active, if a distribution snap target is closer.",
      )}
    />
  </>
);

const Steps = () => (
  <>
    <PrefSpinButton
      path="/options/nudgedistance/value"
      min={0}
      max={1000}
      step={0.01}
      def={2}
      digits={2}
      storedSuffix="px"
      suffix="px"
      label={label(_('_Arrow keys move by:'))}
      tip={_('Pressing an arrow key moves selected object(s) or node(s) by this distance')}
    />
    <PrefSpinButton
      path="/options/defaultscale/value"
      min={0}
      max={1000}
      step={0.01}
      def={2}
      digits={2}
      storedSuffix="px"
      suffix="px"
      label={label(_('&gt; and &lt; _scale by:')).replace('&gt;', '>').replace('&lt;', '<')}
      tip={_('Pressing > or < scales selection up or down by this increment')}
    />
    <PrefSpinButton
      path="/options/defaultoffsetwidth/value"
      min={0}
      max={3000}
      step={0.01}
      def={2}
      digits={2}
      storedSuffix="px"
      suffix="px"
      label={label(_('_Inset/Outset by:'))}
      tip={_('Inset and Outset commands displace the path by this distance')}
    />
    <PrefCheckButton
      label={_('Compass-like display of angles')}
      path="/options/compassangledisplay/value"
      def
      tip={_(
        'When on, angles are displayed with 0 at north, 0 to 360 range, positive clockwise; otherwise with 0 at east, -180 to 180 range, positive counterclockwise',
      )}
    />
    {/* Stored as the number of snaps per half turn. */}
    <PrefSpinButton
      path="/options/rotationsnapsperpi/value"
      min={0.1}
      max={180}
      step={1}
      def={12}
      digits={2}
      toDisplay={(snaps) => 180 / snaps}
      fromDisplay={(degrees) => 180 / degrees}
      suffix={_('degrees')}
      label={label(_('_Rotation snaps every:'))}
      tip={_(
        'Rotating with Ctrl pressed snaps every that much degrees; also, pressing [ or ] rotates by this amount',
      )}
    />
    <PrefCheckButton
      label={_('Relative snapping of guideline angles')}
      path="/options/relativeguiderotationsnap/value"
      def={false}
      tip={_('When on, the snap angles when rotating a guideline will be relative to the original angle')}
    />
    {/* Stored as a factor, shown as a percentage. */}
    <PrefSpinButton
      path="/options/zoomincrement/value"
      min={101}
      max={500}
      step={1}
      def={Math.SQRT2}
      digits={0}
      toDisplay={(factor) => factor * 100}
      fromDisplay={(percent) => percent / 100}
      suffix={_('%')}
      label={label(_('_Zoom in/out by:'))}
      tip={_('Zoom tool click, +/- keys, and middle click zoom in and out by this multiplier')}
    />
    <PrefCheckButton
      label={_('Zoom with middle mouse click')}
      path="/options/middlemousezoom/value"
      def
      indent
      tip={_('When activated, clicking the middle mouse button (usually the mouse wheel) zooms.')}
    />
  </>
);

const Clones = () => (
  <>
    <PrefHeader text={_('Moving original: clones and linked offsets')} />
    <PrefRadioGroup
      path="/options/clonecompensation/value"
      def={0}
      options={[
        {
          label: _('Move in parallel'),
          value: 0,
          tip: _('Clones are translated by the same vector as their original'),
        },
        {
          label: _('Stay unmoved'),
          value: 1,
          tip: _('Clones preserve their positions when their original is moved'),
        },
        {
          label: _('Move according to transform'),
          value: 2,
          tip: _(
            'Each clone moves according to the value of its transform= attribute; for example, a rotated clone will move in a different direction than its original',
          ),
        },
      ]}
    />
    <PrefHeader text={_('Deleting original: clones')} />
    <PrefRadioGroup
      path="/options/cloneorphans/value"
      def={0}
      options={[
        { label: _('Are unlinked'), value: 0, tip: _('Orphaned clones are converted to regular objects') },
        {
          label: _('Are deleted'),
          value: 1,
          tip: _('Orphaned clones are deleted along with their original'),
        },
        { label: _('Become orphans'), value: 2, tip: _('Orphaned clones are not modified') },
      ]}
    />
    <PrefHeader text={_('Duplicating original+clones/linked offset')} />
    <PrefCheckButton
      label={_('Relink duplicated clones')}
      path="/options/relinkclonesonduplicate/value"
      def={false}
      indent
      tip={_(
        'When duplicating a selection containing both a clone and its original (possibly in groups), relink the duplicated clone to the duplicated original instead of the old original',
      )}
    />
    <PrefHeader text={_('Unlinking clones')} />
    <PrefCheckButton
      label={_('Path operations unlink clones')}
      path="/options/pathoperationsunlink/value"
      def
      indent
      tip={_(
        'The following path operations will unlink clones: Stroke to path, Object to path, Boolean operations, Combine, Break apart',
      )}
    />
    <PrefCheckButton
      label={_("'Object to Path' only unlinks (keeps LPEs, shapes)")}
      path="/options/clonestocurvesjustunlink/value"
      def
      indent
      tip={_(
        "'Object to path' only unlinks clones when they are converted to paths, but preserves any LPEs and shapes within the clones.",
      )}
    />
  </>
);

const Masks = () => (
  <>
    <PrefCheckButton
      label={_('When applying, use the topmost selected object as clippath/mask')}
      path="/options/maskobject/topmost"
      def
      tip={_('Uncheck this to use the bottom selected object as the clipping path or mask')}
    />
    <PrefCheckButton
      label={_('When ungrouping, clips/masks are preserved in children')}
      path="/options/maskobject/maskonungroup"
      def
      tip={_('Uncheck this to remove clip/mask on ungroup')}
    />
    <PrefCheckButton
      label={_('Remove clippath/mask object after applying')}
      path="/options/maskobject/remove"
      def
      tip={_('After applying, remove the object used as the clipping path or mask from the drawing')}
    />
    <PrefHeader text={_('Before applying')} />
    <PrefRadioGroup
      path="/options/maskobject/grouping"
      def={0}
      options={[
        {
          label: _('Do not group clipped/masked objects'),
          value: 0,
          tip: _('Apply clippath/mask to every object'),
        },
        {
          label: _('Put every clipped/masked object in its own group'),
          value: 1,
          tip: _('Apply clippath/mask to groups containing single object'),
        },
        {
          label: _('Put all clipped/masked objects into one group'),
          value: 2,
          tip: _('Apply clippath/mask to group containing all objects'),
        },
      ]}
    />
    <PrefHeader text={_('After releasing')} />
    <PrefCheckButton
      label={_('Ungroup automatically created groups')}
      path="/options/maskobject/ungrouping"
      def
      indent
      tip={_('Ungroup groups created when setting clip/mask')}
    />
  </>
);

const Clipboard = () => (
  <>
    <PrefHeader text={_('Copying objects to the clipboard')} />
    <PrefRadioGroup
      path="/options/copycomputedstyle/value"
      def={1}
      options={[
        {
          label: _('Copy computed style'),
          value: 1,
          tip: _(
            "The object's 'style' attribute will be set to the computed style, preserving the object's appearance as in previous Inkscape versions",
          ),
        },
        {
          label: _('Copy class and style attributes verbatim'),
          value: 0,
          tip: _(
            "The object's 'style' and 'class' values will be copied verbatim, and will replace those of the target object when using 'Paste style'",
          ),
        },
      ]}
    />
  </>
);

const Cleanup = () => (
  <>
    <PrefHeader text={_('Document cleanup')} />
    <PrefCheckButton
      label={_('Remove unused swatches when doing a document cleanup')}
      path="/options/cleanupswatches/value"
      def={false}
      indent
      tip={_('Remove unused swatches when doing a document cleanup')}
    />
  </>
);

const ImportedImages = () => (
  <>
    <PrefHeader text={_('Export')} />
    <PrefSpinButton
      path="/dialogs/export/defaultxdpi/value"
      min={0}
      max={6000}
      step={1}
      def={96}
      digits={2}
      suffix={_('dpi')}
      label={label(_('Default export _resolution:'))}
      tip={_('Default image resolution (in dots per inch) in the Export dialog')}
    />
    <PrefHeader text={_('Import')} />
    {/* Linking to files is not possible in a browser: images are embedded. */}
    <PrefCombo
      path="/dialogs/import/link"
      def="embed"
      options={[{ label: _('Embed'), value: 'embed' }]}
      label={_('Bitmap import/open mode:')}
    />
    <PrefCombo
      path="/dialogs/import/scale"
      def="auto"
      options={[
        { label: _('None (auto)'), value: 'auto' },
        { label: _('Smooth (optimizeQuality)'), value: 'optimizeQuality' },
        { label: _('Blocky (optimizeSpeed)'), value: 'optimizeSpeed' },
      ]}
      label={_('Image scale (image-rendering):')}
    />
    <PrefSpinButton
      path="/dialogs/import/defaultxdpi/value"
      min={0}
      max={6000}
      step={1}
      def={96}
      digits={2}
      suffix={_('dpi')}
      label={label(_('Default _import resolution:'))}
      tip={_('Default import resolution (in dots per inch) for bitmap and SVG import')}
    />
    <PrefCheckButton
      label={_('Override file resolution')}
      path="/dialogs/import/forcexdpi"
      def={false}
      tip={_('Use default bitmap resolution in favor of information from file')}
    />
  </>
);

// ----------------------------------------------------------------------- tree

interface Page {
  /** Key of the page in /dialogs/preferences/page. */
  id: string;
  title: string;
  content?: () => ReactNode;
  children?: Page[];
}

/** The pages as upstream lists them (initPageTools, initPageUI, initPageBehavior, initPageIO, ...). */
function pages(): Page[] {
  const tool = (id: string, tool: string, content?: () => ReactNode): Page => ({
    id,
    title: toolLabel(tool),
    ...(content && { content }),
  });
  const style = (path: string, type: string) => () => <NewObjectsStyle path={path} itemType={type} />;
  return [
    {
      id: 'tools',
      title: _('Tools'),
      content: Tools,
      children: [
        tool('tools-selector', 'Select', Selector),
        tool('tools-node', 'Node', Node),
        {
          id: 'tools-shapes',
          title: _('Shapes'),
          content: Shapes,
          children: [
            tool('tools-rect', 'Rect', style('/tools/shapes/rect', 'rect')),
            tool('tools-arc', 'Arc', style('/tools/shapes/arc', 'arc')),
            tool('tools-star', 'Star', style('/tools/shapes/star', 'star')),
            tool('tools-3dbox', '3DBox', style('/tools/shapes/3dbox', '3dbox')),
            tool('tools-spiral', 'Spiral', style('/tools/shapes/spiral', 'spiral')),
          ],
        },
        tool('tools-pen', 'Pen', Pen),
        tool('tools-pencil', 'Pencil', Pencil),
        tool('tools-calligraphy', 'Calligraphic'),
        tool('tools-text', 'Text'),
        tool('tools-gradient', 'Gradient'),
        tool('tools-dropper', 'Dropper'),
        tool('tools-paintbucket', 'PaintBucket'),
        tool('tools-tweak', 'Tweak'),
        tool('tools-spray', 'Spray'),
        tool('tools-eraser', 'Eraser'),
        tool('tools-connector', 'Connector'),
        tool('tools-lpetool', 'LPETool'),
        tool('tools-measure', 'Measure'),
        tool('tools-zoom', 'Zoom', Zoom),
      ],
    },
    {
      id: 'ui',
      title: _('Interface'),
      content: Interface,
      children: [
        { id: 'ui-theme', title: _('Theming') },
        { id: 'ui-toolbars', title: _('Toolbars') },
        { id: 'ui-windows', title: _('Windows') },
        { id: 'ui-color-pickers', title: _('Color Selector') },
        { id: 'ui-grids', title: _('Grids') },
        { id: 'ui-command-palette', title: _('Command Palette') },
        { id: 'ui-keyboard-shortcuts', title: _('Keyboard Shortcuts') },
      ],
    },
    {
      id: 'behavior',
      title: _('Behavior'),
      children: [
        { id: 'behavior-selecting', title: _('Selecting') },
        { id: 'behavior-transforms', title: _('Transforms'), content: Transforms },
        { id: 'behavior-scrolling', title: _('Scrolling') },
        { id: 'behavior-snapping', title: _('Snapping'), content: Snapping },
        { id: 'behavior-steps', title: _('Steps'), content: Steps },
        { id: 'behavior-clones', title: _('Clones'), content: Clones },
        { id: 'behavior-masks', title: _('Clippaths and masks'), content: Masks },
        { id: 'behavior-clipboard', title: _('Clipboard'), content: Clipboard },
        { id: 'behavior-cleanup', title: _('Cleanup'), content: Cleanup },
        { id: 'behavior-lpe', title: _('Live Path Effects (LPE)') },
      ],
    },
    {
      id: 'io',
      title: _('Input/Output'),
      children: [
        { id: 'io-mouse', title: _('Input devices') },
        { id: 'io-svgoutput', title: _('SVG output'), content: SvgOutput },
        { id: 'io-svgexport', title: _('SVG export') },
        { id: 'io-cms', title: _('Color management') },
        { id: 'io-autosave', title: _('Autosave'), content: Autosave },
      ],
    },
    { id: 'system', title: _('System') },
    { id: 'bitmaps', title: _('Imported Images'), content: ImportedImages },
    { id: 'rendering', title: _('Rendering') },
    { id: 'spellcheck', title: _('Spellcheck') },
    { id: 'templates', title: _('Templates') },
  ];
}

function findPage(list: readonly Page[], id: string): Page | undefined {
  for (const page of list) {
    if (page.id === id) return page;
    const found = page.children && findPage(page.children, id);
    if (found) return found;
  }
  return undefined;
}

function PageTree({ list, current, depth = 0 }: { list: readonly Page[]; current: string; depth?: number }) {
  return (
    <>
      {list.map((page) => (
        <div key={page.id}>
          <button
            type="button"
            className={`pref-tree-item${page.id === current ? ' selected' : ''}`}
            style={{ paddingLeft: 8 + depth * 14 }}
            onClick={() => Preferences.get().setString('/dialogs/preferences/page', page.id)}
          >
            {page.title}
          </button>
          {page.children && <PageTree list={page.children} current={current} depth={depth + 1} />}
        </div>
      ))}
    </>
  );
}

/**
 * The Preferences dialog (dialog key "Preferences"): the tree of pages and the
 * page. The page is remembered in /dialogs/preferences/page.
 * TODO: the pages that show "not ported yet", the search, the units of the Steps page.
 */
export function InkscapePreferencesDialog() {
  const list = pages();
  const id = usePref('/dialogs/preferences/page', 'tools');
  const page = findPage(list, id) ?? list[0];
  if (!page) return null;
  const Content = page.content ?? NotPorted;
  return (
    <div className="prefs-dialog">
      <nav className="pref-tree" aria-label={_('Preferences')}>
        <PageTree list={list} current={page.id} />
      </nav>
      <section className="pref-page">
        <h3 className="pref-title">{page.title}</h3>
        <Content />
      </section>
    </div>
  );
}
