#pragma once
#include <cassert>
#include <iostream>
#include <vector>

namespace quant {

// A high-performance Object Pool for zero-allocation runtime.
// Pre-allocates a large chunk of memory at startup and manages object lifecycle
// via a free-list stack.
// Allocation/Deallocation is O(1).
template <typename T, size_t PoolSize> class ObjectPool {
public:
  ObjectPool() {
    // Reserve memory for all objects
    pool_.resize(PoolSize);

    // Initialize the free list with pointers to all objects
    // LIFO (Last-In, First-Out) stack ensures cache locality (hot objects
    // reused).
    freeList_.reserve(PoolSize);
    for (size_t i = 0; i < PoolSize; ++i) {
      freeList_.push_back(&pool_[i]);
    }
  }

  // Acquire an object from the pool. Returns nullptr if empty.
  // Construct arguments are forwarded to the object's constructor (placement
  // new).
  // Why is this fast?
  // 1. No syscalls: Unlike 'new', we don't ask the OS for memory.
  // 2. Cache Locality: We use a LIFO stack. The object we just released
  //    is likely still in the CPU's L1/L2 cache. 'new' might give us a cold
  //    address.
  template <typename... Args> T *acquire(Args &&...args) {
    if (freeList_.empty()) {
      std::cerr << "ObjectPool Exhausted! Size: " << PoolSize << std::endl;
      return nullptr;
    }

    T *obj = freeList_.back();
    freeList_.pop_back();

    // PLACEMENT NEW
    // Syntax: new (address) Type(args...)
    // This constructs a new object at the *existing* memory location 'obj'.
    // It calls the constructor but DOES NOT allocate memory.
    // This is the secret to zero-allocation C++.
    new (obj) T(std::forward<Args>(args)...);
    return obj;
  }

  // Release an object back to the pool.
  void release(T *obj) {
    // Manually call the destructor.
    // Since we used placement new, we are responsible for cleanup.
    // 'delete obj' would try to free the memory to the OS -> CRASH!
    obj->~T();

    // Push back to free list
    // LIFO (Stack) Order: The most recently used object is at the top.
    // Strategies tend to reuse objects quickly (e.g., create order -> fill ->
    // release -> create next). This keeps the "hot" memory in the CPU cache.
    freeList_.push_back(obj);
  }

private:
  // The actual memory block.
  // std::vector guarantees contiguous memory.
  // This means all our objects are packed tight, minimizing TLB misses.
  std::vector<T> pool_;

  // Stack of available pointers.
  // Vector acts as a stack here (push_back/pop_back).
  std::vector<T *> freeList_;
};

} // namespace quant
