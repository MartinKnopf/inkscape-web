// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/about.cpp, src/ui/dialog/about.h, share/ui/inkscape-about.glade
/*
 * The About dialog: version, the shuffled list of the Inkscape authors and the
 * links to the upstream project. The web app adds a note that it is a port.
 *
 * Copyright (C) Martin Owens 2019 <doctormo@gmail.com>
 */
import { _, C_, Signal } from '@inkscape-web/core';
import { INKSCAPE_VERSION } from '@inkscape-web/editor';
import { useEffect, useState, useSyncExternalStore } from 'react';

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

/** The lines of the AUTHORS file in random order, as upstream get_shuffled_lines(). */
async function load_authors(): Promise<string[]> {
  const response = await fetch('/AUTHORS');
  if (!response.ok) return [];
  const lines = (await response.text()).split('\n').filter((l) => l.trim());
  for (let i = lines.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [lines[i], lines[j]] = [lines[j]!, lines[i]!];
  }
  return lines;
}

function AboutDialog({ onClose }: { onClose: () => void }) {
  const [authors, setAuthors] = useState<string[]>([]);
  useEffect(() => {
    void load_authors().then(setAuthors, () => setAuthors([]));
  }, []);

  return (
    <div className="guide-dialog-backdrop">
      <div
        className="guide-dialog about-dialog"
        role="dialog"
        aria-label={_('About')}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
      >
        <h3>Inkscape {INKSCAPE_VERSION}</h3>
        <p>
          This is a port of Inkscape to the web browser. It copies the behavior of the Inkscape desktop
          application, and all credit for its design goes to the Inkscape developers. The source code of the
          port is on{' '}
          <a href={REPOSITORY_URL} target="_blank" rel="noreferrer">
            GitHub
          </a>
          .
        </p>
        <p>
          <strong>{_('Authors')}</strong>
        </p>
        <ul className="about-authors" title={_('List of authors who contributed to the code')}>
          {authors.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
        <p className="guide-dialog-info">
          {C_(
            "Brief copyright notice at the footer of the About screen; the placeholder '%1' represents the year as a 4-digit number.",
            '© %1 Inkscape Developers',
          ).replace('%1', String(new Date().getFullYear()))}
          {' · '}
          <a href="/COPYING" target="_blank" rel="noreferrer" title={_('Inkscape license')}>
            {_('License')}
          </a>
          {' · '}
          <a
            href="https://inkscape.org"
            target="_blank"
            rel="noreferrer"
            title={_('Link to the official website')}
          >
            www.inkscape.org
          </a>
        </p>
        <div className="guide-dialog-buttons">
          <button type="button" ref={(el) => el?.focus()} onClick={onClose}>
            {_('Close')}
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
