/* SPDX-License-Identifier: GPL-2.0-or-later */
/* config.h of cairo for the Emscripten build of cairo-module (build.sh): the values that
 * cairo's meson.build finds for wasm32-emscripten, without threads. */
#define SIZEOF_VOID_P 4
#define SIZEOF_INT 4
#define SIZEOF_LONG 4
#define SIZEOF_LONG_LONG 8
#define SIZEOF_SIZE_T 4
#define HAVE_STDINT_H 1
#define HAVE_INTTYPES_H 1
#define HAVE_FCNTL_H 1
#define HAVE_UNISTD_H 1
#define HAVE_SYS_STAT_H 1
#define HAVE_TIME_H 1
#define HAVE_CLOCK_GETTIME 1
#define HAVE_LIBGEN_H 1
#define HAVE_SETJMP_H 1
#define HAVE_FENV_H 1
#define HAVE_ALLOCA_H 1
#define HAVE_UINT64_T 1
#define HAVE___UINT128_T 1
#define HAVE_CTIME_R 1
#define HAVE_LOCALTIME_R 1
#define HAVE_GMTIME_R 1
#define HAVE_NEWLOCALE 1
#define HAVE_STRTOD_L 1
#define HAVE_STRNDUP 1
#define HAVE_ZLIB 1
#define HAVE_C11_ATOMIC_PRIMITIVES 1
#define ATOMIC_OP_NEEDS_MEMORY_BARRIER 1
#define HAVE_MKDIR 1
/* The module has one thread. */
#define CAIRO_NO_MUTEX 1
