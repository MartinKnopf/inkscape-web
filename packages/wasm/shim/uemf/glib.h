// SPDX-License-Identifier: GPL-2.0-or-later
// The glib functions that the EMF and WMF import sources use (no glib in WASM).
#pragma once
#include "../pdfinput/glib.h"
#ifdef __cplusplus
#include <string>

/** Escape &, <, >, ' and " for XML text (as glib's g_markup_escape_text). */
inline gchar *g_markup_escape_text(gchar const *text, gssize length)
{
    std::string out;
    size_t n = length < 0 ? std::strlen(text) : size_t(length);
    for (size_t i = 0; i < n; i++) {
        switch (text[i]) {
            case '&': out += "&amp;"; break;
            case '<': out += "&lt;"; break;
            case '>': out += "&gt;"; break;
            case '\'': out += "&#39;"; break;
            case '"': out += "&quot;"; break;
            default: out += text[i];
        }
    }
    return g_strdup(out.c_str());
}
#endif
