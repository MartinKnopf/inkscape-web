// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/extensions-gallery.cpp, src/ui/dialog/extensions-gallery.h, share/ui/dialog-extensions.glade
/*
 * Extension gallery
 *
 * Authors:
 *   Mike Kowalski
 *
 * Copyright (C) 2023 Authors
 */
import { _, C_, Preferences } from '@inkscape-web/core';
import {
  add_categories,
  add_effects,
  type EffectItem,
  filter_effects,
  get_thumbnail_size,
  InkscapeApplication,
  is_item_visible,
  render_icon_svg,
} from '@inkscape-web/editor';
import { useEffect, useMemo, useState } from 'react';

const PREFS = '/dialogs/extensions-gallery/filters';

let testSvg: Promise<string | null> | null = null;
/** share/ui/resources/filter-test.svg, the document of the thumbnails. */
function loadTestSvg(): Promise<string | null> {
  testSvg ??= fetch('/share/ui/resources/filter-test.svg').then((r) => (r.ok ? r.text() : null));
  return testSvg;
}

/** The thumbnails by effect id (upstream _image_cache). */
const thumbnails = new Map<string, string>();

function Thumbnail({ item, size, test }: { item: EffectItem; size: number; test: string | null }) {
  let url = thumbnails.get(item.id);
  if (!url && test) {
    const svg = render_icon_svg(item.effect, test);
    url = svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : '';
    thumbnails.set(item.id, url);
  }
  return url ? (
    <img src={url} alt="" width={size} height={size} />
  ) : (
    <span style={{ width: size, height: size }} />
  );
}

/**
 * The Filter Gallery dialog (dialog key "FilterGallery"): the filter presets with thumbnails, by
 * category and search; Apply applies the selected filter to the selection (its app action).
 * TODO: the Extensions gallery (ExtensionsGallery::Effects), the drop shadow of the thumbnails.
 */
export function FilterGalleryDialog() {
  const prefs = Preferences.get();
  const items = useMemo(() => add_effects(filter_effects), []);
  const categories = useMemo(() => add_categories(items), [items]);
  const [category, setCategory] = useState(() => {
    const c = prefs.getString(`${PREFS}/category`, 'all');
    return categories.includes(c) ? c : 'all';
  });
  const [showList, setShowList] = useState(() => prefs.getBool(`${PREFS}/show-list`, true));
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(() => prefs.getString(`${PREFS}/selected`));
  const [sizeIndex, setSizeIndex] = useState(() =>
    Math.min(Math.max(prefs.getInt(`${PREFS}/tile-size`, 6), 0), 16),
  );
  const [test, setTest] = useState<string | null>(null);
  useEffect(() => {
    void loadTestSvg().then(setTest);
  }, []);

  const visible = items.filter((i) => is_item_visible(i, category, search));
  const current = items.find((i) => i.id === selected) ?? null;
  const size = get_thumbnail_size(sizeIndex);
  const select = (item: EffectItem) => {
    setSelected(item.id);
    prefs.setString(`${PREFS}/selected`, item.id);
  };
  const run = (item: EffectItem | null) => {
    if (item) InkscapeApplication.instance().activate_action(`app.${item.id}`);
  };
  const runLabel = C_('apply-filter', '_Apply').replace('_', '');

  return (
    <div className="filter-gallery">
      <div className="docprops-row">
        <button
          type="button"
          title={_('Toggle list of filter categories')}
          aria-pressed={showList}
          onClick={() => {
            setShowList(!showList);
            prefs.setBool(`${PREFS}/show-list`, !showList);
            // don't leave hidden category selection filter active
            if (showList) setCategory('all');
          }}
        >
          ☰
        </button>
        <input
          type="search"
          placeholder={_('Search...')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="filter-gallery-main">
        {showList && (
          <div className="filter-gallery-categories">
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={c === category}
                onClick={() => {
                  setCategory(c);
                  prefs.setString(`${PREFS}/category`, c);
                }}
              >
                {c === 'all' ? _('All Filters') : c}
              </button>
            ))}
          </div>
        )}
        <div className="filter-gallery-grid">
          <p>{_('Select filter to apply:')}</p>
          {visible.map((item) => (
            <button
              key={item.id}
              type="button"
              className="filter-gallery-item"
              aria-pressed={item.id === selected}
              title={item.description ? `${item.access}\n\n${item.description}` : item.access}
              onClick={() => select(item)}
              onDoubleClick={() => run(item)}
            >
              <Thumbnail item={item} size={size} test={test} />
              <span>{item.name}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="docprops-row">
        <span title={current?.access}>{current?.access ?? ''}</span>
      </div>
      <div className="docprops-row">
        <i title={current?.description}>{current?.description ?? ''}</i>
      </div>
      <div className="docprops-row">
        <label>
          <span>{_('Thumbnail size')}</span>
          <input
            type="range"
            min={0}
            max={16}
            value={sizeIndex}
            onChange={(e) => {
              const v = Number(e.target.value);
              setSizeIndex(v);
              prefs.setInt(`${PREFS}/tile-size`, v);
            }}
          />
        </label>
        <button type="button" disabled={!current} onClick={() => run(current)}>
          {runLabel}
        </button>
      </div>
    </div>
  );
}
