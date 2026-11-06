// SPDX-License-Identifier: GPL-2.0-or-later
// Glib::ustring of the EMF and WMF import: a std::string with raw().
#pragma once
#include <string>
namespace Glib {
class ustring : public std::string
{
public:
    using std::string::string;
    ustring() = default;
    ustring(std::string s)
        : std::string(std::move(s))
    {}
    std::string const &raw() const { return *this; }
};
} // namespace Glib
