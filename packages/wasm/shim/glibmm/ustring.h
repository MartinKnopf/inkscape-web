// SPDX-License-Identifier: GPL-2.0-or-later
// Minimal glibmm shim: Glib::ustring as std::string (util/enums.h, helper/geom-nodesatellite.h).
#pragma once
#include <string>
namespace Glib {
using ustring = std::string;
}
