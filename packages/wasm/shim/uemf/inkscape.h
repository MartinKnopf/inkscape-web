// SPDX-License-Identifier: GPL-2.0-or-later
// SP_ACTIVE_DOCUMENT of inkscape.h: there is no active document in the WASM module
// (Metafile::setViewBoxIfMissing, which the import does not call).
#pragma once
#define SP_ACTIVE_DOCUMENT static_cast<SPDocument *>(nullptr)
