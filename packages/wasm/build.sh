#!/bin/bash
# SPDX-License-Identifier: GPL-2.0-or-later
# Build upstream lib2geom + livarot + path operations + libavoid + potrace and the trace filters to WebAssembly.
# Upstream: src/3rdparty/2geom, src/3rdparty/adaptagrams/libavoid/, src/3rdparty/adaptagrams/libvpsc/, src/livarot/, src/path/path-boolop.cpp, src/helper/geom-nodesatellite.cpp, src/live_effects/spiro.cpp, src/live_effects/spiro-converters.cpp, src/live_effects/lpe-dashed-stroke.cpp, src/live_effects/lpe-jointype.cpp, src/live_effects/lpe-sketch.cpp, src/live_effects/lpe-interpolate.cpp, src/live_effects/lpe-powerstroke.cpp, src/live_effects/lpe-embrodery-stitch-ordering.cpp, src/svg/stringstream.cpp, src/svg/strip-trailing-zeros.cpp, src/helper/geom-pathstroke.cpp, src/helper/geom.cpp, src/util/treeify.cpp, src/trace/imagemap.cpp, src/trace/filterset.cpp, src/trace/quantize.cpp, src/libnrtype/Layout-TNG-Scanline-Makers.cpp, src/live_effects/lpe-ruler.cpp, src/live_effects/lpe-path_length.cpp, src/live_effects/lpe-text_label.cpp, src/live_effects/lpe-tangent_to_curve.cpp, src/live_effects/lpe-transform_2pts.cpp, src/live_effects/lpe-curvestitch.cpp, src/live_effects/lpe-interpolate_points.cpp
# Upstream sources are compiled unchanged; shim/ replaces the few glib calls and the preferences.
#
# Needs: emcc (version in ./emscripten-version), Boost headers, curl.
# Env:   INKSCAPE_SRC  upstream checkout (default: ../inkscape next to the repo)
#        BOOST_INCLUDE folder that contains boost/ (default: Homebrew or /usr/include)
set -euo pipefail
cd "$(dirname "$0")"
HERE=$PWD
INK=$(cd "${INKSCAPE_SRC:-$HERE/../../../inkscape}" && pwd)
G=$INK/src/3rdparty/2geom
B=$HERE/build
P=$B/prefix
JOBS=$(getconf _NPROCESSORS_ONLN)

[ -f "$G/CMakeLists.txt" ] || { echo "lib2geom not found in $G (git submodule update --init src/3rdparty/2geom)"; exit 1; }
WANT=$(cat emscripten-version)
HAVE=$(emcc --version | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
[ "$WANT" = "$HAVE" ] || echo "warning: emcc $HAVE, expected $WANT"

# --- Boost headers (only header-only parts are used) ---
if [ -z "${BOOST_INCLUDE:-}" ]; then
    if command -v brew >/dev/null && [ -d "$(brew --prefix boost 2>/dev/null)/include/boost" ]; then
        BOOST_INCLUDE=$(brew --prefix boost)/include
    else
        BOOST_INCLUDE=/usr/include
    fi
fi
[ -d "$BOOST_INCLUDE/boost" ] || { echo "Boost headers not found in $BOOST_INCLUDE"; exit 1; }
# Link only boost/ into a private folder: adding a system include dir would mix in host headers.
mkdir -p "$B/boost-include" && ln -sfn "$BOOST_INCLUDE/boost" "$B/boost-include/boost"

# --- Third-party C libraries, pinned and checksummed ---
# Configure scripts run their test programs with Node: keep them out of our ESM package scope.
echo '{ "type": "commonjs" }' > "$B/package.json"
fetch() { # url sha256 dir
    [ -d "$B/vendor/$3" ] && return
    mkdir -p "$B/vendor" && curl -sSL "$1" -o "$B/vendor/$3.tar.gz"
    echo "$2  $B/vendor/$3.tar.gz" | shasum -a 256 -c - >/dev/null
    mkdir "$B/vendor/$3" && tar xzf "$B/vendor/$3.tar.gz" -C "$B/vendor/$3" --strip-components 1
}
fetch https://ftp.gnu.org/gnu/gsl/gsl-2.8.tar.gz \
    6a99eeed15632c6354895b1dd542ed5a855c0f15d9ad1326c6fe2b2c9e423190 gsl
fetch https://github.com/google/double-conversion/archive/refs/tags/v3.4.0.tar.gz \
    42fd4d980ea86426e457b24bdfa835a6f5ad9517ddb01cdb42b99ab9c8dd5dc9 double-conversion
# Upstream links the system libpotrace (find_package(Potrace), no pinned version): use the latest release.
fetch https://potrace.sourceforge.net/download/1.16/potrace-1.16.tar.gz \
    be8248a17dedd6ccbaab2fcc45835bb0502d062e40fbded3bc56028ce5eb7acc potrace

if [ ! -f "$P/lib/libdouble-conversion.a" ]; then
    mkdir -p "$B/double-conversion" && (cd "$B/double-conversion" &&
        emcmake cmake "$B/vendor/double-conversion" -DCMAKE_INSTALL_PREFIX="$P" -DCMAKE_BUILD_TYPE=Release >/dev/null &&
        emmake make -j"$JOBS" install >/dev/null)
fi
# libpotrace: the library sources of potrace's src/Makefile.am (libsources), without its config.h.
if [ ! -f "$P/lib/libpotrace.a" ]; then
    mkdir -p "$B/potrace" "$P/lib" "$P/include" && (cd "$B/potrace" &&
        for f in curve trace decompose potracelib; do
            emcc -O3 -DVERSION='"1.16"' -DHAVE_INTTYPES_H -c "$B/vendor/potrace/src/$f.c" -o "$f.o"
        done &&
        emar rcs "$P/lib/libpotrace.a" curve.o trace.o decompose.o potracelib.o &&
        cp "$B/vendor/potrace/src/potracelib.h" "$P/include/")
fi
if [ ! -f "$P/lib/libgsl.a" ]; then
    mkdir -p "$B/gsl" && (cd "$B/gsl" &&
        emconfigure "$B/vendor/gsl/configure" --prefix="$P" --disable-shared CFLAGS=-O2 >/dev/null 2>&1 &&
        emmake make -j"$JOBS" >/dev/null 2>&1 && emmake make install >/dev/null 2>&1)
fi

# --- Upstream sources ---
# lib2geom: same file list as its CMakeLists.txt (+ the pre-generated SVG path parser).
GEOM=$(sed -n '/target_sources(2geom PRIVATE/,/^)/p' "$G/src/2geom/CMakeLists.txt" | grep -oE '[a-z0-9_/-]+\.cpp')
SRCS=""
for f in $GEOM svg-path-parser.cpp; do SRCS="$SRCS $G/src/2geom/$f"; done
SRCS="$SRCS $(ls "$INK"/src/livarot/*.cpp)"
# libavoid (connector routing): same file list as its CMakeLists.txt.
A=$INK/src/3rdparty/adaptagrams
for f in $(sed -n '/target_sources(avoid_LIB PRIVATE/,/^)/p' "$A/libavoid/CMakeLists.txt" | grep -oE '[a-z0-9_]+\.cpp'); do
    SRCS="$SRCS $A/libavoid/$f"
done
# libvpsc (Remove Overlaps): same file list as its CMakeLists.txt.
for f in $(sed -n '/target_sources(vpsc_LIB PRIVATE/,/^)/p' "$A/libvpsc/CMakeLists.txt" | grep -oE '[a-z0-9_A-Z]+\.cpp'); do
    SRCS="$SRCS $A/libvpsc/$f"
done
SRCS="$SRCS $INK/src/path/path-boolop.cpp $INK/src/svg/stringstream.cpp $INK/src/svg/strip-trailing-zeros.cpp"
# split_non_intersecting_paths() for Path > Break Apart.
SRCS="$SRCS $INK/src/helper/geom-pathstroke.cpp $INK/src/helper/geom.cpp $INK/src/util/treeify.cpp"
# Replaces src/util/numeric/precision.cpp (it reads the preferences).
SRCS="$SRCS $HERE/shim/precision.cpp"
# Arc length helpers of the Corners (Fillet/Chamfer) LPE.
SRCS="$SRCS $INK/src/helper/geom-nodesatellite.cpp"
# Spiro splines (Spiro LPE and the Spiro mode of the drawing tools).
SRCS="$SRCS $INK/src/live_effects/spiro.cpp $INK/src/live_effects/spiro-converters.cpp"
# The sub-path ordering of the Embroidery stitch LPE (shim/live_effects/effect.h for its header).
SRCS="$SRCS $INK/src/live_effects/lpe-embrodery-stitch-ordering.cpp"
# The filters and color quantization of Trace Bitmap and the paint bucket (shim/gdkmm for their headers).
SRCS="$SRCS $INK/src/trace/imagemap.cpp $INK/src/trace/filterset.cpp $INK/src/trace/quantize.cpp"
# The scanline maker of flowed text (libnrtype; shim/pango and shim/sigc++ for its header).
SRCS="$SRCS $INK/src/libnrtype/Layout-TNG-Scanline-Makers.cpp"

# WASM has no FP rounding-mode control, so Boost.Interval gets its default (no-op)
# rounding: we skip its hw_rounding.hpp (only used by 2geom/geometric-intersection.cpp).
export FLAGS="-O3 -std=c++20 -fexceptions -DHAVE_GSL -DBOOST_NUMERIC_INTERVAL_HW_ROUNDING_HPP \
    -include $HERE/shim/glib.h -I$HERE/shim -I$INK/src -I$G/include -I$A -I$P/include -I$B/boost-include \
    -Wno-deprecated-declarations"
OBJ=$B/obj && mkdir -p "$OBJ"
obj() { echo "$OBJ/$(echo "${1#"$INK"/}" | tr / _).o"; }
for s in $SRCS; do
    o=$(obj "$s")
    [ "$o" -nt "$s" ] || echo "$s $o"
done | xargs -P "$JOBS" -n 2 sh -c 'em++ $FLAGS -c "$0" -o "$1"'

OBJS=""
for s in $SRCS; do OBJS="$OBJS $(obj "$s")"; done
mkdir -p dist
# shellcheck disable=SC2086
em++ $FLAGS -lembind bindings/geom.cpp bindings/lpe.cpp bindings/lpe-convert.cpp bindings/lpe-generate.cpp bindings/lpe-powerstroke.cpp bindings/lpe-pwd2.cpp bindings/lpe-pwd2-constructions.cpp bindings/paths.cpp bindings/avoid.cpp bindings/trace.cpp bindings/text-layout.cpp $OBJS "$P/lib/libpotrace.a" "$P/lib/libgsl.a" "$P/lib/libgslcblas.a" "$P/lib/libdouble-conversion.a" \
    -sMODULARIZE -sEXPORT_ES6 -sALLOW_MEMORY_GROWTH -sENVIRONMENT=web,worker,node \
    --emit-tsd geom-module.d.mts -o dist/geom-module.mjs
git -C "$INK" rev-parse HEAD > dist/upstream-commit
scripts/inputs-hash.sh > dist/inputs-hash
# License files of everything linked into the module (see THIRD-PARTY.md).
mkdir -p dist/licenses
cp "$INK/COPYING" dist/licenses/inkscape-COPYING
cp "$INK"/LICENSES/GPL-2.0.txt "$INK"/LICENSES/GPL-3.0.txt dist/licenses/
cp "$G/COPYING-LGPL-2.1" "$G/COPYING-MPL-1.1" dist/licenses/
cp "$A/libavoid/LICENSE.LGPL" dist/licenses/libavoid-LICENSE.LGPL
cp "$B/vendor/gsl/COPYING" dist/licenses/gsl-COPYING
cp "$B/vendor/double-conversion/LICENSE" dist/licenses/double-conversion-LICENSE
cp "$B/vendor/potrace/COPYING" dist/licenses/potrace-COPYING
echo "wasm: $(du -h dist/geom-module.wasm | cut -f1) ($(gzip -9c dist/geom-module.wasm | wc -c | tr -d ' ') bytes gzip)"

# --- cairo-module: cairo + pixman for PDF, PS and EPS export (loaded only when exporting) ---
# Upstream links the system cairo (>= 1.18.6, see CMakeScripts/DefineDependsandFlags.cmake).
# There is no meson here: the library sources of src/meson.build (cairo) and
# pixman/meson.build (pixman) are compiled directly, with the config headers in shim/cairo
# and shim/pixman. FreeType, libpng and zlib are Emscripten ports.
fetch_xz() { # url sha256 dir
    [ -d "$B/vendor/$3" ] && return
    mkdir -p "$B/vendor" && curl -sSL "$1" -o "$B/vendor/$3.tar.xz"
    echo "$2  $B/vendor/$3.tar.xz" | shasum -a 256 -c - >/dev/null
    mkdir "$B/vendor/$3" && tar xJf "$B/vendor/$3.tar.xz" -C "$B/vendor/$3" --strip-components 1
}
fetch https://cairographics.org/releases/pixman-0.46.4.tar.gz \
    d09c44ebc3bd5bee7021c79f922fe8fb2fb57f7320f55e97ff9914d2346a591c pixman
fetch_xz https://cairographics.org/releases/cairo-1.18.6.tar.xz \
    1c767308174337a74694da0f3ec069c271452163a1ef4540964c50c301f157d4 cairo
PX=$B/vendor/pixman/pixman
CA=$B/vendor/cairo/src
mkdir -p "$B/cairo-include"
sed -e 's/@PIXMAN_VERSION_MAJOR@/0/' -e 's/@PIXMAN_VERSION_MINOR@/46/' -e 's/@PIXMAN_VERSION_MICRO@/4/' \
    "$PX/pixman-version.h.in" > "$B/cairo-include/pixman-version.h"
CAIRO_SRCS=""
for f in $(sed -n '/^pixman_files = files(/,/^)/p' "$PX/meson.build" | grep -oE "'[a-z0-9-]+\.c'" | tr -d "'"); do
    CAIRO_SRCS="$CAIRO_SRCS $PX/$f"
done
# The core sources plus the features of shim/cairo/cairo-features.h.
for f in $(sed -n '/^cairo_sources = \[/,/^\]/p' "$CA/meson.build" | grep -oE "'[a-z0-9-]+\.c'" | tr -d "'") \
    cairo-png.c cairo-ft-font.c cairo-colr-glyph-render.c cairo-svg-glyph-render.c \
    cairo-ps-surface.c cairo-pdf-surface.c cairo-pdf-interchange.c cairo-svg-surface.c; do
    CAIRO_SRCS="$CAIRO_SRCS $CA/$f"
done
export CAIRO_FLAGS="-O3 -sUSE_FREETYPE=1 -sUSE_LIBPNG=1 -sUSE_ZLIB=1 -DHAVE_CONFIG_H -D_GNU_SOURCE \
    -DCAIRO_COMPILATION -I$HERE/shim/cairo -I$HERE/shim/pixman -I$B/cairo-include -I$PX -I$CA \
    -Wno-attributes -Wno-unused-but-set-variable -Wno-missing-field-initializers -Wno-unused-parameter \
    -Wno-enum-conversion -Wno-parentheses-equality -Wno-unused-function -Wno-unused-variable"
CAIRO_OBJ=$B/cairo-obj && mkdir -p "$CAIRO_OBJ"
cobj() { echo "$CAIRO_OBJ/$(basename "$(dirname "$1")")_$(basename "$1" .c).o"; }
for s in $CAIRO_SRCS; do
    o=$(cobj "$s")
    [ "$o" -nt "$s" ] && [ "$o" -nt "$HERE/shim/cairo/config.h" ] && [ "$o" -nt "$HERE/shim/cairo/cairo-features.h" ] ||
        echo "$s $o"
done | xargs -P "$JOBS" -n 2 sh -c 'emcc $CAIRO_FLAGS -c "$0" -o "$1"'
CAIRO_OBJS=""
for s in $CAIRO_SRCS; do CAIRO_OBJS="$CAIRO_OBJS $(cobj "$s")"; done

# --- PDF import in cairo-module: poppler + upstream src/extension/internal/pdfinput ---
# The PDF import shares cairo and FreeType with the export, so it lives in the same module.
# Upstream links the system poppler; 26.07 is the newest version that its pdfinput code knows
# (POPPLER_CHECK_VERSION in poppler-transition-api.h). Poppler and lcms2 are built from their
# release tarballs. The upstream pdfinput sources (PdfParser, SvgBuilder) are compiled unchanged:
# shim/pdfinput gives them a small XML tree, document, colors and font list (Inkscape's object
# model stays in TypeScript); the tree goes to the app as SVG text (bindings/pdf.cpp).
fetch https://github.com/mm2/Little-CMS/releases/download/lcms2.17/lcms2-2.17.tar.gz \
    d11af569e42a1baa1650d20ad61d12e41af4fead4aa7964a01f93b08b53ab074 lcms2
fetch_xz https://poppler.freedesktop.org/poppler-26.07.0.tar.xz \
    304832f48f8a47fdca90c6b6d1f684e68f37c10c9a0726f345f4ca9df4ca01e2 poppler
if [ ! -f "$P/lib/liblcms2.a" ]; then
    mkdir -p "$B/lcms2" "$P/lib" "$P/include" && (cd "$B/lcms2" &&
        for f in "$B"/vendor/lcms2/src/*.c; do
            emcc -O2 -DCMS_NO_PTHREADS=1 -I"$B/vendor/lcms2/include" -c "$f" -o "$(basename "$f" .c).o"
        done &&
        emar rcs "$P/lib/liblcms2.a" ./*.o &&
        cp "$B"/vendor/lcms2/include/*.h "$P/include/")
fi
EMLIB=$(em-config CACHE)/sysroot
POP=$B/vendor/poppler
PB=$B/poppler
# In C++23 the libc++ of Emscripten instantiates ~unique_ptr<Array> where Array is incomplete:
# shim/poppler/complete-deleters.h declares the deleters of the incomplete poppler types.
DELETERS="-include $HERE/shim/poppler/complete-deleters.h"
if [ ! -f "$PB/libpoppler.a" ]; then
    embuilder build libjpeg freetype libpng zlib >/dev/null
    mkdir -p "$PB" && (cd "$PB" &&
        emcmake cmake "$POP" -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF "-DCMAKE_CXX_FLAGS=$DELETERS" \
            -DENABLE_UTILS=OFF -DENABLE_CPP=OFF -DENABLE_GLIB=OFF -DENABLE_QT5=OFF -DENABLE_QT6=OFF \
            -DENABLE_GOBJECT_INTROSPECTION=OFF -DENABLE_BOOST=OFF -DENABLE_LIBOPENJPEG=OFF \
            -DENABLE_LIBCURL=OFF -DENABLE_LIBTIFF=OFF -DENABLE_NSS3=OFF -DENABLE_GPGME=OFF \
            -DBUILD_GTK_TESTS=OFF -DBUILD_QT5_TESTS=OFF -DBUILD_QT6_TESTS=OFF -DBUILD_CPP_TESTS=OFF \
            -DBUILD_MANUAL_TESTS=OFF -DRUN_GPERF_IF_PRESENT=OFF -DFONT_CONFIGURATION=generic \
            -DCMAKE_DISABLE_FIND_PACKAGE_Cairo=ON \
            -DENABLE_LCMS=ON -DLCMS2_INCLUDE_DIR="$P/include" -DLCMS2_LIBRARIES="$P/lib/liblcms2.a" \
            -DFREETYPE_INCLUDE_DIRS="$EMLIB/include/freetype2" -DFREETYPE_LIBRARY="$EMLIB/lib/wasm32-emscripten/libfreetype.a" \
            -DZLIB_INCLUDE_DIR="$EMLIB/include" -DZLIB_LIBRARY="$EMLIB/lib/wasm32-emscripten/libz.a" \
            -DPNG_PNG_INCLUDE_DIR="$EMLIB/include" -DPNG_LIBRARY="$EMLIB/lib/wasm32-emscripten/libpng.a" \
            -DJPEG_INCLUDE_DIR="$EMLIB/include" -DJPEG_LIBRARY="$EMLIB/lib/wasm32-emscripten/libjpeg.a" \
            >/dev/null &&
        emmake make -j"$JOBS" poppler >/dev/null)
fi
# Upstream objects of the geom module that the PDF import needs too (2geom, livarot, svg streams).
rm -f "$B/libinkgeom.a" && emar rcs "$B/libinkgeom.a" "$OBJ"/*.o
PI=$INK/src/extension/internal/pdfinput
PDF_SRCS="$PI/pdf-parser.cpp $PI/svg-builder.cpp $PI/pdf-utils.cpp $PI/poppler-utils.cpp $PI/poppler-cairo-font-engine.cpp \
    $INK/src/svg/svg-affine.cpp $INK/src/svg/svg-affine-parser.cpp $INK/src/svg/svg-path.cpp $INK/src/svg/path-string.cpp $INK/src/svg/css-ostringstream.cpp \
    $INK/src/util/uri.cpp $INK/src/util-string/string-convert.cpp \
    $(ls "$HERE"/shim/pdfinput/*.cpp) $HERE/shim/poppler/complete-deleters.cpp"
export PDF_FLAGS="-O2 -std=c++23 -fexceptions -sUSE_FREETYPE=1 -sUSE_LIBPNG=1 $DELETERS -include $HERE/shim/pdfinput/glib.h \
    -I$HERE/shim/pdfinput -I$HERE/shim -I$INK/src -I$G/include -I$P/include -I$B/boost-include \
    -I$POP -I$POP/poppler -I$PB -I$PB/poppler -I$HERE/shim/cairo -I$CA -Wno-deprecated-declarations"
PDF_OBJ=$B/pdf-obj && mkdir -p "$PDF_OBJ"
pobj() { echo "$PDF_OBJ/$(echo "${1#"$INK"/}" | tr / _ | sed 's|^.*shim_|shim_|').o"; }
for s in $PDF_SRCS; do
    o=$(pobj "$s")
    [ "$o" -nt "$s" ] && [ -z "$(find "$HERE/shim/pdfinput" "$HERE/shim/poppler" -newer "$o" -name '*.h')" ] || echo "$s $o"
done | xargs -P "$JOBS" -n 2 sh -c 'em++ $PDF_FLAGS -c "$0" -o "$1"'
PDF_OBJS=""
for s in $PDF_SRCS; do PDF_OBJS="$PDF_OBJS $(pobj "$s")"; done
# Poppler's Cairo output device (upstream gets it through poppler-glib) for the page preview and
# the Cairo import. Upstream's poppler-cairo-font-engine.cpp is a copy of poppler's
# CairoFontEngine with the same class names: poppler's classes get other names here.
export POPPLER_CAIRO_FLAGS="-DCairoFont=PopplerCairoFont -DCairoFontEngine=PopplerCairoFontEngine \
    -DCairoFreeTypeFont=PopplerCairoFreeTypeFont -DCairoType3Font=PopplerCairoType3Font"
for f in CairoOutputDev CairoFontEngine CairoRescaleBox; do
    o=$PDF_OBJ/poppler_$f.o
    [ "$o" -nt "$POP/poppler/$f.cc" ] || echo "$POP/poppler/$f.cc $o"
done | xargs -P "$JOBS" -n 2 sh -c 'em++ $PDF_FLAGS $POPPLER_CAIRO_FLAGS -c "$0" -o "$1"'
for f in CairoOutputDev CairoFontEngine CairoRescaleBox; do PDF_OBJS="$PDF_OBJS $PDF_OBJ/poppler_$f.o"; done
# The bindings that use the Cairo output device need the same names.
em++ $PDF_FLAGS $POPPLER_CAIRO_FLAGS -c bindings/pdf-cairo.cpp -o "$PDF_OBJ/bindings_pdf-cairo.o"
PDF_OBJS="$PDF_OBJS $PDF_OBJ/bindings_pdf-cairo.o"

# shellcheck disable=SC2086
em++ $PDF_FLAGS -lembind bindings/cairo.cpp bindings/pdf.cpp $PDF_OBJS $CAIRO_OBJS \
    "$PB/libpoppler.a" "$P/lib/liblcms2.a" "$B/libinkgeom.a" "$P/lib/libgsl.a" "$P/lib/libgslcblas.a" \
    "$P/lib/libdouble-conversion.a" -sUSE_LIBJPEG=1 -sUSE_ZLIB=1 -Wl,--error-limit=0 \
    -sMODULARIZE -sEXPORT_ES6 -sALLOW_MEMORY_GROWTH -sENVIRONMENT=web,worker,node \
    --emit-tsd cairo-module.d.mts -o dist/cairo-module.mjs
cp "$B/vendor/poppler/COPYING" dist/licenses/poppler-COPYING
cp "$B/vendor/lcms2/LICENSE" dist/licenses/lcms2-LICENSE
cp "$B/vendor/cairo/COPYING-LGPL-2.1" dist/licenses/cairo-COPYING-LGPL-2.1
cp "$B/vendor/cairo/COPYING-MPL-1.1" dist/licenses/cairo-COPYING-MPL-1.1
cp "$B/vendor/pixman/COPYING" dist/licenses/pixman-COPYING
echo "cairo wasm: $(du -h dist/cairo-module.wasm | cut -f1) ($(gzip -9c dist/cairo-module.wasm | wc -c | tr -d ' ') bytes gzip)"

# --- Text module: HarfBuzz, FriBidi and libunibreak for text layout, and fallback fonts ---
# Its own module (text-module.wasm) that libnrtype loads with the fonts; the geom module stays small.
# Upstream links Pango (shaping with HarfBuzz, bidi with FriBidi, its own line breaking) and
# FreeType; bindings/text.cpp gives libnrtype the same information.
fetch_tar() { # url sha256 dir (any compression)
    [ -d "$B/vendor/$3" ] && return
    mkdir -p "$B/vendor" && curl -sSL "$1" -o "$B/vendor/$3.tar"
    echo "$2  $B/vendor/$3.tar" | shasum -a 256 -c - >/dev/null
    mkdir "$B/vendor/$3" && tar xf "$B/vendor/$3.tar" -C "$B/vendor/$3" --strip-components 1
}
fetch_tar https://github.com/harfbuzz/harfbuzz/releases/download/11.2.1/harfbuzz-11.2.1.tar.xz \
    093714c8548a285094685f0bdc999e202d666b59eeb3df2ff921ab68b8336a49 harfbuzz
fetch_tar https://github.com/fribidi/fribidi/releases/download/v1.0.16/fribidi-1.0.16.tar.xz \
    1b1cde5b235d40479e91be2f0e88a309e3214c8ab470ec8a2744d82a5a9ea05c fribidi
fetch_tar https://github.com/adah1972/libunibreak/releases/download/libunibreak_6_1/libunibreak-6.1.tar.gz \
    cc4de0099cf7ff05005ceabff4afed4c582a736abc38033e70fdac86335ce93f libunibreak
# Fonts for when the system fonts are not available (no Local Font Access API permission).
fetch_tar https://github.com/dejavu-fonts/dejavu-fonts/releases/download/version_2_37/dejavu-fonts-ttf-2.37.tar.bz2 \
    fa9ca4d13871dd122f61258a80d01751d603b4d3ee14095d65453b4e846e17d7 dejavu

TX=$B/text && mkdir -p "$TX"
FB=$B/vendor/fribidi/lib
UB=$B/vendor/libunibreak/src
sed -e 's/@configure_input@/generated by build.sh/' -e 's/@PACKAGE@/fribidi/' -e 's/@PACKAGE_NAME@/GNU FriBidi/' \
    -e 's/@PACKAGE_BUGREPORT@//' -e 's/@FRIBIDI_VERSION@/1.0.16/' -e 's/@FRIBIDI_MAJOR_VERSION@/1/' \
    -e 's/@FRIBIDI_MINOR_VERSION@/0/' -e 's/@FRIBIDI_MICRO_VERSION@/16/' -e 's/@FRIBIDI_INTERFACE_VERSION@/4/' \
    -e 's/@SIZEOF_INT@/4/' -e 's/@FRIBIDI_MSVC_BUILD_PLACEHOLDER@/#undef FRIBIDI_BUILT_WITH_MSVC/' \
    "$FB/fribidi-config.h.in" > "$TX/fribidi-config.h"
TEXT_OBJS=""
text_cc() { # compiler source flags...
    local o
    o="$TX/$(basename "$2").o"
    [ "$o" -nt "$2" ] || "$1" -O3 "${@:3}" -c "$2" -o "$o"
    TEXT_OBJS="$TEXT_OBJS $o"
}
text_cc em++ "$B/vendor/harfbuzz/src/harfbuzz.cc" -std=c++17 -DHB_NO_MT -fno-exceptions
for f in fribidi fribidi-bidi fribidi-bidi-types fribidi-brackets fribidi-mirroring fribidi-run \
    fribidi-joining fribidi-joining-types fribidi-arabic fribidi-shape fribidi-deprecated; do
    text_cc emcc "$FB/$f.c" -DHAVE_STDLIB_H=1 -DHAVE_STRING_H=1 -DHAVE_STRINGIZE=1 -DFRIBIDI_LIB_STATIC -I"$TX" -I"$FB"
done
for f in unibreakbase unibreakdef linebreak linebreakdata linebreakdef wordbreak graphemebreak \
    eastasianwidthdef emojidef; do
    text_cc emcc "$UB/$f.c" -I"$UB"
done
# shellcheck disable=SC2086
em++ -O3 -std=c++20 -lembind -I"$B/vendor/harfbuzz/src" -I"$FB" -I"$TX" -I"$UB" -DFRIBIDI_LIB_STATIC \
    bindings/text.cpp $TEXT_OBJS \
    -sMODULARIZE -sEXPORT_ES6 -sALLOW_MEMORY_GROWTH -sENVIRONMENT=web,worker,node \
    --emit-tsd text-module.d.mts -o dist/text-module.mjs
mkdir -p dist/fonts
for f in DejaVuSans DejaVuSans-Bold DejaVuSans-Oblique DejaVuSans-BoldOblique DejaVuSerif DejaVuSerif-Bold \
    DejaVuSansMono DejaVuSansMono-Bold; do
    cp "$B/vendor/dejavu/ttf/$f.ttf" dist/fonts/
done
cp "$B/vendor/harfbuzz/COPYING" dist/licenses/harfbuzz-COPYING
cp "$B/vendor/fribidi/COPYING" dist/licenses/fribidi-COPYING
cp "$B/vendor/libunibreak/LICENCE" dist/licenses/libunibreak-LICENCE
cp "$B/vendor/dejavu/LICENSE" dist/licenses/dejavu-fonts-LICENSE
echo "text wasm: $(du -h dist/text-module.wasm | cut -f1) ($(gzip -9c dist/text-module.wasm | wc -c | tr -d ' ') bytes gzip)"
