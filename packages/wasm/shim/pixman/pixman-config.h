/* SPDX-License-Identifier: GPL-2.0-or-later */
/* pixman-config.h of pixman for the Emscripten build of cairo-module (build.sh): no SIMD,
 * no threads (one pixman instance per WASM module). */
#define PACKAGE "pixman"
#define SIZEOF_LONG 4
#define HAVE_BUILTIN_CLZ 1
#define HAVE_FENV_H 1
#define HAVE_UNISTD_H 1
#define HAVE_POSIX_MEMALIGN 1
#define HAVE_GETPAGESIZE 1
#define HAVE_GETTIMEOFDAY 1
#define TOOLCHAIN_SUPPORTS_ATTRIBUTE_CONSTRUCTOR 1
#define TOOLCHAIN_SUPPORTS_ATTRIBUTE_DESTRUCTOR 1
#define PIXMAN_NO_TLS 1
