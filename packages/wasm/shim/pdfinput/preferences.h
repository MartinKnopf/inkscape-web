// SPDX-License-Identifier: GPL-2.0-or-later
// Inkscape::Preferences for the upstream sources of the PDF import (svg/path-string.cpp,
// svg/svg-affine.cpp): the module has no preferences, every value is its default.
#pragma once
#include <glibmm/ustring.h>

namespace Inkscape {
class Preferences
{
public:
    static Preferences *get()
    {
        static Preferences prefs;
        return &prefs;
    }
    bool getBool(Glib::ustring const &, bool def = false) { return def; }
    int getInt(Glib::ustring const &, int def = 0) { return def; }
    int getIntLimited(Glib::ustring const &, int def, int, int) { return def; }
    double getDouble(Glib::ustring const &, double def = 0.0) { return def; }
};
} // namespace Inkscape
