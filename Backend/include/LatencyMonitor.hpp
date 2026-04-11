#pragma once
#include <algorithm>
#include <chrono>
#include <iomanip>
#include <iostream>
#include <string>
#include <vector>

namespace quant {

// LatencyMonitor
// A high-performance, low-overhead latency histogram.
// This class uses a fixed-size bucket array to store latency samples in
// nanoseconds. It avoids dynamic allocation during runtime to prevent pauses
// (jitter).
class LatencyMonitor {
public:
  // Buckets: 0-1us, 1-2us ... up to MaxLatency
  // We use a simple linear bucket size of 100ns for high precision.
  static constexpr size_t BUCKET_SIZE_NS = 100;
  static constexpr size_t NUM_BUCKETS = 10000; // Covers up to 1ms (1000us)

  LatencyMonitor(const std::string &name)
      : name_(name), count_(0), min_(UINT64_MAX), max_(0) {
    // Initialize buckets to zero
    for (size_t i = 0; i < NUM_BUCKETS; ++i) {
      buckets_[i] = 0;
    }
  }

  // Start a measurement
  inline void start() {
    start_time_ = std::chrono::high_resolution_clock::now();
  }

  // Stop and record measurement
  inline void stop() {
    auto end_time = std::chrono::high_resolution_clock::now();
    auto duration = std::chrono::duration_cast<std::chrono::nanoseconds>(
                        end_time - start_time_)
                        .count();
    record((uint64_t)duration);
  }

  // Directly record a duration in nanoseconds
  void record(uint64_t ns) {
    count_++;
    if (ns < min_)
      min_ = ns;
    if (ns > max_)
      max_ = ns;

    size_t bucket_idx = ns / BUCKET_SIZE_NS;
    if (bucket_idx >= NUM_BUCKETS) {
      bucket_idx = NUM_BUCKETS - 1; // Overflow bucket
    }
    buckets_[bucket_idx]++;
  }

  // Print histogram report to stdout
  void report() const {
    std::cout << "\n=== Latency Report: " << name_ << " ===" << std::endl;
    std::cout << "Samples: " << count_ << std::endl;
    std::cout << "Min: " << min_ << " ns" << std::endl;
    std::cout << "Max: " << max_ << " ns" << std::endl;

    if (count_ == 0)
      return;

    // Calculate percentiles (p50, p99, p99.9)
    uint64_t accumulated = 0;
    uint64_t p50_val = 0, p99_val = 0, p999_val = 0;
    bool p50_found = false, p99_found = false, p999_found = false;

    uint64_t target_p50 = count_ * 0.50;
    uint64_t target_p99 = count_ * 0.99;
    uint64_t target_p999 = count_ * 0.999;

    for (size_t i = 0; i < NUM_BUCKETS; ++i) {
      accumulated += buckets_[i];
      uint64_t bucket_end_ns = (i + 1) * BUCKET_SIZE_NS;

      if (!p50_found && accumulated >= target_p50) {
        p50_val = bucket_end_ns;
        p50_found = true;
      }
      if (!p99_found && accumulated >= target_p99) {
        p99_val = bucket_end_ns;
        p99_found = true;
      }
      if (!p999_found && accumulated >= target_p999) {
        p999_val = bucket_end_ns;
        p999_found = true;
      }
    }

    std::cout << "P50: " << p50_val << " ns (" << (p50_val / 1000.0) << " us)"
              << std::endl;
    std::cout << "P99: " << p99_val << " ns (" << (p99_val / 1000.0) << " us)"
              << std::endl;
    std::cout << "P99.9: " << p999_val << " ns (" << (p999_val / 1000.0)
              << " us)" << std::endl;

    std::cout << "Distribution:" << std::endl;
    // Print compressed buckets (e.g., combine into 1us chunks for readability)
    // Group every 10 buckets (10 * 100ns = 1us)
    for (size_t i = 0; i < 20; ++i) { // Show first 20us
      size_t group_count = 0;
      for (size_t j = 0; j < 10; ++j) {
        group_count += buckets_[i * 10 + j];
      }

      if (group_count > 0) {
        std::cout << std::setw(3) << i << "-" << std::setw(3) << (i + 1)
                  << " us: ";
        int bars = (group_count * 50) / count_; // Normalize to 50 chars width
        if (bars == 0 && group_count > 0)
          bars = 1;
        for (int k = 0; k < bars; ++k)
          std::cout << "#";
        std::cout << " (" << group_count << ")" << std::endl;
      }
    }
  }

private:
  std::string name_;
  std::chrono::time_point<std::chrono::high_resolution_clock> start_time_;

  // Statistics
  uint64_t count_;
  uint64_t min_;
  uint64_t max_;

  // Fixed size array for histogram buckets.
  // Index i corresponds to range [i*BUCKET_SIZE, (i+1)*BUCKET_SIZE)
  uint64_t buckets_[NUM_BUCKETS];
};

} // namespace quant
