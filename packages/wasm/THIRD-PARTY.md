# Third-party code in geom-module.wasm

| Component | Source | License |
|---|---|---|
| Inkscape (livarot, `src/path`, `src/svg`, `src/trace`) | upstream checkout | GPL-2.0-or-later |
| lib2geom | upstream `src/3rdparty/2geom` | LGPL-2.1-or-later OR MPL-1.1 |
| libavoid (Adaptagrams) | upstream `src/3rdparty/adaptagrams/libavoid` | LGPL-2.1-or-later |
| GNU Scientific Library 2.8 | ftp.gnu.org | GPL-3.0-or-later |
| double-conversion 3.4.0 | github.com/google/double-conversion | BSD-3-Clause |
| Potrace 1.16 (libpotrace) | potrace.sourceforge.net | GPL-2.0-or-later |
| Inkscape `src/libnrtype/Layout-TNG-Scanline-Makers.cpp` | upstream checkout | GPL-2.0-or-later |
| Boost (headers only) | system / Homebrew | BSL-1.0 |

Because GSL is GPL-3.0-or-later, the built module is covered by the GNU GPL
version 3 or later. `build.sh` copies the license files of all components into
`dist/licenses/`. Boost is used as headers only; the Boost Software License
does not require a notice in compiled code.

# Third-party code in cairo-module.wasm

Loaded only for PDF, PS and EPS export and for PDF import.

| Component | Source | License |
|---|---|---|
| cairo 1.18.6 | cairographics.org | LGPL-2.1-only OR MPL-1.1 |
| pixman 0.46.4 | cairographics.org | MIT |
| poppler 26.07.0 | poppler.freedesktop.org | GPL-2.0-or-later |
| Little CMS 2.17 | github.com/mm2/Little-CMS | MIT |
| Inkscape (`src/extension/internal/pdfinput`, `src/svg`, `src/util`) | upstream checkout | GPL-2.0-or-later |
| lib2geom, livarot (shared with geom-module) | upstream checkout | see above |
| FreeType, libpng, libjpeg, zlib | Emscripten ports | FTL or GPL-2.0, libpng, IJG, Zlib |

`build.sh` copies the cairo, pixman, poppler and lcms2 license files into `dist/licenses/`.

# Third-party code in text-module.wasm and dist/fonts

| Component | Source | License |
|---|---|---|
| HarfBuzz 11.2.1 | github.com/harfbuzz/harfbuzz | MIT ("Old MIT") |
| GNU FriBidi 1.0.16 | github.com/fribidi/fribidi | LGPL-2.1-or-later |
| libunibreak 6.1 | github.com/adah1972/libunibreak | Zlib |
| DejaVu fonts 2.37 (`dist/fonts`) | github.com/dejavu-fonts/dejavu-fonts | Bitstream Vera license, public domain changes |

The bindings (`bindings/text.cpp`) are GPL-2.0-or-later, so the text module is
covered by the GNU GPL version 2 or later. `build.sh` copies the license files
into `dist/licenses/`.

# Third-party code in revenge-module.wasm

Loaded only for the CorelDRAW, Visio and WordPerfect Graphics import.

| Component | Source | License |
|---|---|---|
| librevenge 0.0.5 | dev-www.libreoffice.org/src | MPL-2.0 OR LGPL-2.1-or-later |
| libwpd 0.10.3 | dev-www.libreoffice.org/src | MPL-2.0 OR LGPL-2.1-or-later |
| libwpg 0.3.4 | dev-www.libreoffice.org/src | MPL-2.0 OR LGPL-2.1-or-later |
| libcdr 0.1.8 | dev-www.libreoffice.org/src | MPL-2.0 |
| libvisio 0.1.8 | dev-www.libreoffice.org/src | MPL-2.0 |
| libxml2 2.14.6 | download.gnome.org | MIT |
| ICU 77.1 (converters, charset detection, a subset of its data) | github.com/unicode-org/icu | Unicode-3.0 |
| Little CMS 2.17 (shared with cairo-module) | github.com/mm2/Little-CMS | MIT |
| zlib | Emscripten port | Zlib |
| Boost (headers only) | system / Homebrew | BSL-1.0 |

The bindings (`bindings/revenge.cpp`) are GPL-2.0-or-later. `build.sh` copies the license files
into `dist/licenses/`.
