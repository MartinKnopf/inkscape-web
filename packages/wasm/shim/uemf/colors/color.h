// SPDX-License-Identifier: GPL-2.0-or-later
// The part of Inkscape::Colors::Color that the EMF and WMF import uses: an sRGB color
// printed as colors/spaces/rgb.cpp prints it (#rrggbb).
#pragma once
#include <cstdint>
#include <cstdio>
#include <string>
#include "colors/utils.h"

namespace Inkscape::Colors {
namespace Space {
enum class Type { NONE, RGB };
} // namespace Space

class Color
{
public:
    explicit Color(uint32_t rgba, bool alpha = true)
        : _rgba(alpha ? rgba : (rgba | 0xff))
    {}
    bool operator==(Color const &other) const { return _rgba == other._rgba; }
    /** Only the CSS names "black" and "white" are used. */
    bool set(std::string const &name, bool = true)
    {
        _rgba = name == "white" ? 0xffffffff : 0x000000ff;
        return true;
    }
    void invert() { _rgba = (~_rgba & 0xffffff00) | (_rgba & 0xff); }
    bool convert(Space::Type) { return true; }
    std::string toString(bool opacity = true) const
    {
        char buf[16];
        if (opacity)
            std::snprintf(buf, sizeof(buf), "#%08x", _rgba);
        else
            std::snprintf(buf, sizeof(buf), "#%06x", _rgba >> 8);
        return buf;
    }
    uint32_t toRGBA() const { return _rgba; }

private:
    uint32_t _rgba;
};
} // namespace Inkscape::Colors
