// SPDX-License-Identifier: GPL-2.0-or-later
// SPItem and SPRoot of the EMF and WMF import shim: the members that the print functions and
// Metafile::setViewBoxIfMissing use (the WASM module does not call them).
#pragma once
#include <2geom/affine.h>
#include <2geom/point.h>

class SPPrintContext;
namespace Inkscape {
class Drawing;
class DrawingItem;
} // namespace Inkscape

enum { SP_ITEM_SHOW_DISPLAY = 1 };

class SPItem
{
public:
    static unsigned display_key_new(unsigned) { return 0; }
    Inkscape::DrawingItem *invoke_show(Inkscape::Drawing &, unsigned, unsigned) { return nullptr; }
    void invoke_hide(unsigned) {}
    void invoke_print(SPPrintContext *) {}
};

class SPRoot : public SPItem
{
public:
    bool viewBox_set = true;
    void scaleChildItemsRec(Geom::Scale const &, Geom::Point const &, bool) {}
};
