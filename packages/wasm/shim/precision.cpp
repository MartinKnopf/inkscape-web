// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/util/numeric/precision.cpp
// Replaces upstream precision.cpp, which reads the preferences. The WASM module has no
// preferences, so it uses the default of /options/svgoutput/numericprecision.
#include "util/numeric/precision.h"

namespace Inkscape::Util {

int get_default_numeric_precision()
{
    return 10;
}

} // namespace Inkscape::Util
