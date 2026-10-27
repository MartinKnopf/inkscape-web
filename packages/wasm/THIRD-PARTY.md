# Third-party code in geom-module.wasm

| Component | Source | License |
|---|---|---|
| Inkscape (livarot, `src/path`, `src/svg`) | upstream checkout | GPL-2.0-or-later |
| lib2geom | upstream `src/3rdparty/2geom` | LGPL-2.1-or-later OR MPL-1.1 |
| GNU Scientific Library 2.8 | ftp.gnu.org | GPL-3.0-or-later |
| double-conversion 3.4.0 | github.com/google/double-conversion | BSD-3-Clause |
| Boost (headers only) | system / Homebrew | BSL-1.0 |

Because GSL is GPL-3.0-or-later, the built module is covered by the GNU GPL
version 3 or later. `build.sh` copies the license files of all components into
`dist/licenses/`. Boost is used as headers only; the Boost Software License
does not require a notice in compiled code.
