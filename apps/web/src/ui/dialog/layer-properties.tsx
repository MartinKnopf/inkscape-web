// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/layer-properties.cpp, src/ui/dialog/layer-properties.h
/*
 * Dialog for renaming layers, adding layers and moving the selection to a layer.
 *
 * Author:
 *   Bryce W. Harrington <bryce@bryceharrington.org>
 *   Andrius R. <knutux@gmail.com>
 *   Abhishek Sharma
 *
 * Copyright (C) 2004 Bryce Harrington
 * Copyright (C) 2006 Andrius R.
 */
import { _ } from '@inkscape-web/core';
import {
  LAYER_POSITIONS,
  type LayerPropertiesRequest,
  LayerRelativePosition,
  setLayerPropertiesPresenter,
} from '@inkscape-web/editor';
import { useEffect, useState } from 'react';

/** The text of a mnemonic label without the marker. */
const label = (s: string) => s.replace('_', '');

const POSITION_LABELS = [_('Above current'), _('As sublayer of current'), _('Below current')];

function Dialog({ request, onClose }: { request: LayerPropertiesRequest; onClose: () => void }) {
  const [name, setName] = useState(request.type === 'move' ? '' : request.name);
  const [position, setPosition] = useState<LayerRelativePosition>(
    request.type === 'create' ? request.position : LayerRelativePosition.LPOS_ABOVE,
  );
  const [layer, setLayer] = useState(request.type === 'move' ? request.selected : null);

  const apply = () => {
    if (request.type === 'create') request.apply(name, position);
    else if (request.type === 'rename') request.apply(name);
    else if (layer) request.apply(layer);
    onClose();
  };

  return (
    <div className="guide-dialog-backdrop">
      <form
        className="guide-dialog"
        role="dialog"
        aria-label={request.title}
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
      >
        <h3>{request.title}</h3>
        {request.type !== 'move' && (
          <label>
            <span>{_('Layer name:')}</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              ref={(el) => el?.select()}
              // biome-ignore lint/a11y/noAutofocus: the dialog asks for the name
              autoFocus
            />
          </label>
        )}
        {request.type === 'create' && request.position_visible && (
          <fieldset>
            <legend>{_('Position:')}</legend>
            {LAYER_POSITIONS.map((p, i) => (
              <label key={p}>
                <input
                  type="radio"
                  name="layer-position"
                  checked={position === p}
                  onChange={() => setPosition(p)}
                />
                <span>{POSITION_LABELS[i]}</span>
              </label>
            ))}
          </fieldset>
        )}
        {request.type === 'move' && (
          <ul className="layer-properties-layers" aria-label={_('Layers')}>
            {request.layers.map((l) => (
              <li key={l.layer.getId() ?? l.label} style={{ paddingLeft: `${l.depth * 1.2}em` }}>
                <label>
                  <input
                    type="radio"
                    name="layer"
                    checked={layer === l.layer}
                    onChange={() => setLayer(l.layer)}
                  />
                  <span>{l.label}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <div className="guide-dialog-buttons">
          <button type="button" onClick={onClose}>
            {label(_('_Cancel'))}
          </button>
          <button type="submit" disabled={request.type === 'move' && !layer}>
            {request.apply_label}
          </button>
        </div>
      </form>
    </div>
  );
}

/** Shows the layer dialog that win.layer-new, win.layer-rename or win.selection-move-to-layer ask for. */
export function LayerPropertiesDialogHost() {
  const [request, setRequest] = useState<LayerPropertiesRequest | null>(null);
  useEffect(() => setLayerPropertiesPresenter(setRequest), []);
  if (!request) return null;
  return <Dialog request={request} onClose={() => setRequest(null)} />;
}
