// SPDX-License-Identifier: GPL-2.0-or-later
// The version macros of poppler-glib (not built here): the poppler version of build.sh.
#pragma once
#define POPPLER_MAJOR_VERSION (26)
#define POPPLER_MINOR_VERSION (7)
#define POPPLER_MICRO_VERSION (0)
#define POPPLER_CHECK_VERSION(major, minor, micro)                                                   \
    (POPPLER_MAJOR_VERSION > (major) || (POPPLER_MAJOR_VERSION == (major) && POPPLER_MINOR_VERSION > (minor)) || \
     (POPPLER_MAJOR_VERSION == (major) && POPPLER_MINOR_VERSION == (minor) && POPPLER_MICRO_VERSION >= (micro)))
