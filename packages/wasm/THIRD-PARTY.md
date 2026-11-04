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

Loaded only for PDF, PS and EPS export.

| Component | Source | License |
|---|---|---|
| cairo 1.18.6 | cairographics.org | LGPL-2.1-only OR MPL-1.1 |
| pixman 0.46.4 | cairographics.org | MIT |
| FreeType, libpng, zlib | Emscripten ports | FTL or GPL-2.0, libpng, Zlib |

`build.sh` copies the cairo and pixman license files into `dist/licenses/`.

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
