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
