#pragma once
#include <atomic>
#include <cstddef>
#include <iostream>
#include <vector>

namespace quant {

// A Lock-Free Single-Producer Single-Consumer (SPSC) Ring Buffer.
// This data structure is critical for HFT systems because it allows
// passing messages between threads (e.g., Market Data -> Strategy)
// without using mutexes, which introduce expensive context switches.
template <typename T, size_t Capacity> class LockFreeQueue {
public:
  // Ensure capacity is a power of 2 for bitwise modulo optimization
  static_assert((Capacity & (Capacity - 1)) == 0,
                "Capacity must be a power of 2");

  LockFreeQueue() : head_(0), tail_(0) {}

  // Push an item into the queue. Returns true if successful, false if full.
  // This is called by the PRODUCER thread (Market Data Thread).
  bool push(const T &item) {
    // Load the current tail index. We use memory_order_relaxed because
    // only the producer writes to tail_, so we don't need synchronization here.
    size_t current_tail = tail_.load(std::memory_order_relaxed);

    // Calculate the next tail position.
    // Using bitwise AND is faster than modulo (%) for power-of-2 capacity.
    // Example: If Capacity is 1024 (10000000000 in binary), Mask is 1023
    // (01111111111).
    size_t next_tail = (current_tail + 1) & (Capacity - 1);

    // Check if the queue is full.
    // We load head_ with acquire semantics to ensure we see the latest
    // updates from the consumer.
    // Full Condition: If (tail + 1) % Capacity == head, the queue is full.
    size_t current_head = head_.load(std::memory_order_acquire);

    if (next_tail == current_head) {
      return false; // Queue is full
    }

    // CRITICAL: We write to the buffer BEFORE we update the tail index.
    // If we updated tail first, the consumer might read garbage data.
    buffer_[current_tail] = item;

    // COMMIT: Make the new item visible to the consumer.
    // memory_order_release: Ensures that all previous writes (line 43)
    // are completed and visible to any thread that loads 'tail_' with
    // 'acquire'. This acts as a barrier: "Finish writing data, THEN switch the
    // flag".
    tail_.store(next_tail, std::memory_order_release);
    return true;
  }

  // Pop an item from the queue. Returns true if successful, false if empty.
  // This is called by the CONSUMER thread (Strategy Thread).
  // Goal: Read data as fast as possible without locking the Producer.
  bool pop(T &item) {
    // Load current head. We own head, so relaxed is fine.
    size_t current_head = head_.load(std::memory_order_relaxed);

    // Load current tail to see how much data is available.
    // memory_order_acquire: Ensures we see all the data writes that happened
    // before the producer released this tail index.
    // If we used 'relaxed' here, we might see the updated tail index
    // BUT read stale/garbage data from buffer_[current_head] due to CPU
    // reordering.
    size_t current_tail = tail_.load(std::memory_order_acquire);

    if (current_head == current_tail) {
      return false; // Queue is empty
    }

    // Read the item. This is safe because we established a synchronizes-with
    // relationship via tail_ (release) -> tail_ (acquire).
    item = buffer_[current_head];

    // Calculate next head position.
    size_t next_head = (current_head + 1) & (Capacity - 1);

    // COMMIT: Free up the slot for the producer to overwrite.
    // memory_order_release: Ensures we are done reading 'item' BEFORE
    // we tell the producer "I'm done with this slot".
    // If we used 'relaxed', the CPU might reorder this store to happen BEFORE
    // line 69, causing the producer to overwrite data we haven't read yet!
    head_.store(next_head, std::memory_order_release);
    return true;
  }

  // Check if the queue is empty
  bool empty() const {
    return head_.load(std::memory_order_acquire) ==
           tail_.load(std::memory_order_acquire);
  }

private:
  // The buffer must be large enough to handle bursts of market data.
  // Example: 1024 items. At 100 bytes/item, this is ~100KB, fitting in L2
  // cache.
  std::vector<T> buffer_{Capacity};

  // CACHE LINE PADDING
  // alignas(64): Forces this variable to start on a new 64-byte cache line.
  // Why? "False Sharing".
  // If head_ and tail_ are on the same cache line:
  // 1. Core 1 writes to head_. This invalidates the cache line on Core 2.
  // 2. Core 2 tries to read tail_. Cache miss! It has to fetch from RAM/L3.
  // 3. This ping-ponging destroys performance (can be 100x slower).
  // By padding, we ensure Core 1 owns Line A and Core 2 owns Line B.
  alignas(64) std::atomic<size_t> head_;
  alignas(64) std::atomic<size_t> tail_;
};

} // namespace quant
