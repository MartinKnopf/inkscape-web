// SPDX-License-Identifier: GPL-2.0-or-later
// SPPrintContext of src/print.h (the print functions of emf-inout.cpp and wmf-inout.cpp,
// which the WASM module does not call; the EMF and WMF output is TypeScript).
#pragma once
#include "extension/print.h"

class SPPrintContext
{
public:
    Inkscape::Extension::Print *module = nullptr;
};
