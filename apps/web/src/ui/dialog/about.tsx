// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/about.cpp, src/ui/dialog/about.h
// The About dialog: the Inkscape version and license, and below a line a note
// that this app is a port of Inkscape, with a link to its repository.
import { _, Signal } from '@inkscape-web/core';
import { INKSCAPE_VERSION } from '@inkscape-web/editor';
import { useSyncExternalStore } from 'react';

/** The repository of this port. */
export const REPOSITORY_URL = 'https://github.com/MartinKnopf/inkscape-web';

let open = false;
const changed = new Signal<[]>();

function setOpen(value: boolean): void {
  open = value;
  changed.emit();
}

/** Show the About dialog (upstream show_about()). */
export function show_about(): void {
  setOpen(true);
}

function AboutDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="guide-dialog-backdrop">
      <div
        className="guide-dialog message-dialog about-dialog"
        role="dialog"
        aria-label={_('About Inkscape')}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
      >
        <h3>{_('About Inkscape')}</h3>
        <p>
          <strong>Inkscape {INKSCAPE_VERSION}</strong>
        </p>
        <p>
          {`${_('Inkscape is a free and open source vector graphics editor.')}\n${_('Released under the GNU General Public License, version 2 or later.')}\nhttps://inkscape.org`}
        </p>
        <hr />
        <p>
          This is a port of Inkscape to the web browser. It copies the behavior of the Inkscape desktop
          application, and all credit for its design goes to the Inkscape developers. The source code of the
          port is on{' '}
          <a href={REPOSITORY_URL} target="_blank" rel="noreferrer">
            GitHub
          </a>
          .
        </p>
        <div className="guide-dialog-buttons">
          <button type="button" ref={(el) => el?.focus()} onClick={onClose}>
            {_('_OK').replace('_', '')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Shows the dialog that show_about() opened. Render once in the app. */
export function AboutDialogHost() {
  const isOpen = useSyncExternalStore(
    (cb) => changed.connect(cb),
    () => open,
  );
  return isOpen ? <AboutDialog onClose={() => setOpen(false)} /> : null;
}
