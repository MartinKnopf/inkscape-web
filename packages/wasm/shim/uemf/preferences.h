// SPDX-License-Identifier: GPL-2.0-or-later
// Preferences of the EMF and WMF import: always the defaults (svg/path-string.cpp, and
// Metafile::setViewBoxIfMissing, which the import does not call).
#pragma once
#include <string>
namespace Inkscape {
class Preferences
{
public:
    static Preferences *get()
    {
        static Preferences prefs;
        return &prefs;
    }
    bool getBool(std::string const &, bool def = false) const { return def; }
    int getInt(std::string const &, int def = 0) const { return def; }
    int getIntLimited(std::string const &, int def, int, int) const { return def; }
    void setBool(std::string const &, bool) {}
};
} // namespace Inkscape
