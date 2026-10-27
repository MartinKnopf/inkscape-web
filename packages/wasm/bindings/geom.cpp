// SPDX-License-Identifier: GPL-2.0-or-later
// Embind API of geom-module.wasm. Keep it small: one function per upstream
// operation, geometry in and out as SVG path data. src/index.ts wraps it with types.
#include <emscripten/bind.h>
#include <2geom/svg-path-parser.h>
#include <2geom/svg-path-writer.h>
#include "path/path-boolop.h"

// Upstream: src/path/path-boolop.cpp sp_pathvector_boolop()
std::string boolop(std::string const &a, std::string const &b, int op, int fill_a, int fill_b)
{
    auto result = sp_pathvector_boolop(Geom::parse_svg_path(a.c_str()), Geom::parse_svg_path(b.c_str()),
                                       static_cast<BooleanOp>(op), static_cast<FillRule>(fill_a),
                                       static_cast<FillRule>(fill_b));
    return Geom::write_svg_path(result);
}

// Parse and write path data with fixed precision, absolute commands and no shorthands.
std::string normalize_path(std::string const &d, int precision)
{
    return Geom::write_svg_path(Geom::parse_svg_path(d.c_str()), precision, false, false);
}

EMSCRIPTEN_BINDINGS(geom)
{
    emscripten::function("boolop", &boolop);
    emscripten::function("normalizePath", &normalize_path);
}
