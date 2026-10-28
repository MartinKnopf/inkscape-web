// SPDX-License-Identifier: GPL-2.0-or-later
// Icons from the upstream icon themes (share/icons, served by @inkscape-web/assets).

/**
 * The URL of an icon of the default theme: "multicolor" with symbolic icons
 * (preferences-skeleton.h: /theme/defaultIconTheme, /theme/symbolicIcons).
 * TODO: the theme preferences and recoloring of symbolic icons.
 */
export function iconUrl(name: string): string {
  return `/share/icons/multicolor/symbolic/actions/${name}-symbolic.svg`;
}

/**
 * The URL of an icon of the fallback theme "hicolor" (upstream: GTK looks there for icons that
 * the theme does not have, e.g. gradient-add-stop). Use it in the error handler of an <img>.
 */
export function iconFallbackUrl(name: string): string {
  return `/share/icons/hicolor/symbolic/actions/${name}-symbolic.svg`;
}

/** onError handler of an icon <img>: load the icon from the fallback theme, once. */
export function iconFallback(name: string): (e: { currentTarget: HTMLImageElement }) => void {
  return (e) => {
    const fallback = iconFallbackUrl(name);
    if (!e.currentTarget.src.endsWith(fallback)) e.currentTarget.src = fallback;
  };
}
