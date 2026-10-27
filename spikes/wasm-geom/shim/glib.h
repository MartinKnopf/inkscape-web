// Minimal glib shim: only what livarot / path-boolop use.
#pragma once
#include <cassert>
#include <cstdio>
#include <cstdlib>
#include <random>
typedef int gint;
typedef unsigned int guint;
typedef double gdouble;
typedef int gboolean;
typedef char gchar;
#define g_malloc(n) std::malloc(n)
#define g_realloc(p, n) std::realloc(p, n)
#define g_free(p) std::free(p)
#define g_assert(x) assert(x)
#define g_assert_not_reached() assert(false)
#define g_warning(...) std::fprintf(stderr, __VA_ARGS__)
inline double g_random_double_range(double a, double b) {
    static std::mt19937 gen(0);
    return std::uniform_real_distribution<double>(a, b)(gen);
}
#define g_error(...) (std::fprintf(stderr, __VA_ARGS__), std::abort())
