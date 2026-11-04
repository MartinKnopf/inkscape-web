// SPDX-License-Identifier: GPL-2.0-or-later
// Included first in every poppler source and every source that uses poppler (see build.sh).
// In C++23 the libc++ of Emscripten makes ~unique_ptr constexpr, so clang instantiates
// default_delete<Array>::operator() in Object.h, where Array is incomplete. These deleters
// are declared here and defined in complete-deleters.cpp, where the types are complete.
#pragma once
#ifdef __cplusplus
#include <memory>

class Array;
class Dict;

template<>
struct std::default_delete<Array>
{
    constexpr default_delete() noexcept = default;
    void operator()(Array *p) const noexcept;
};

template<>
struct std::default_delete<Dict>
{
    constexpr default_delete() noexcept = default;
    void operator()(Dict *p) const noexcept;
};
#endif
