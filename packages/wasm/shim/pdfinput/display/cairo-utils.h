// SPDX-License-Identifier: GPL-2.0-or-later
// The two functions of display/cairo-utils.cpp that the PDF import uses (same code as upstream;
// the rest of that file needs Inkscape's renderer).
#pragma once
#include <optional>
#include <cairo.h>
#include <2geom/affine.h>
#include <2geom/path-sink.h>
#include <2geom/pathvector.h>

inline void ink_cairo_transform(cairo_t *ct, Geom::Affine const &m)
{
    cairo_matrix_t cm;
    cm.xx = m[0];
    cm.xy = m[2];
    cm.x0 = m[4];
    cm.yx = m[1];
    cm.yy = m[3];
    cm.y0 = m[5];
    cairo_transform(ct, &cm);
}

inline std::optional<Geom::PathVector> extract_pathvector_from_cairo(cairo_t *ct)
{
    cairo_path_t *path = cairo_copy_path(ct);
    if (!path)
        return std::nullopt;

    Geom::PathBuilder res;
    auto end = &path->data[path->num_data];
    bool ok = true;
    for (auto p = &path->data[0]; ok && p < end; p += p->header.length) {
        switch (p->header.type) {
            case CAIRO_PATH_MOVE_TO:
                ok = p->header.length == 2;
                if (ok)
                    res.moveTo(Geom::Point(p[1].point.x, p[1].point.y));
                break;
            case CAIRO_PATH_LINE_TO:
                ok = p->header.length == 2;
                if (ok)
                    res.lineTo(Geom::Point(p[1].point.x, p[1].point.y));
                break;
            case CAIRO_PATH_CURVE_TO:
                ok = p->header.length == 4;
                if (ok)
                    res.curveTo(Geom::Point(p[1].point.x, p[1].point.y), Geom::Point(p[2].point.x, p[2].point.y),
                                Geom::Point(p[3].point.x, p[3].point.y));
                break;
            case CAIRO_PATH_CLOSE_PATH:
                res.closePath();
                break;
            default:
                ok = false;
                break;
        }
    }
    cairo_path_destroy(path);
    if (!ok)
        return std::nullopt;
    res.flush();
    return res.peek();
}
