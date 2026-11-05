// SPDX-License-Identifier: GPL-2.0-or-later
// G_GNUC_PRINTF of glib/gmacros.h (util/safe-printf.h).
#pragma once
#define G_GNUC_PRINTF(format_idx, arg_idx) __attribute__((__format__(__printf__, format_idx, arg_idx)))
