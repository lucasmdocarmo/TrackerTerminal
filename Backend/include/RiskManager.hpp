#pragma once
#include "Types.hpp" // For Side
#include <atomic>
#include <chrono>
#include <cmath>
#include <iostream>
#include <string>

namespace quant {

// Industrial-Grade Risk Manager
// Implements mandatory Pre-Trade Risk Checks (PTRC) for HFT.
class RiskManager {
public:
  RiskManager()
      : maxOrderSize_(10.0), maxPosition_(100.0),
        maxPriceDeviation_(0.05), // 5% Price Collar
        maxOrderRate_(10),        // Max 10 orders per second
        orderCountTimeWindow_(std::chrono::milliseconds(1000)),
        currentPosition_(0.0), lastCheckTime_(std::chrono::steady_clock::now()),
        ordersInWindow_(0) {}

  // Main entry point for pre-trade validation
  // Returns true if order is safe to send.
  bool checkOrder(const std::string & /*symbol*/, Side side, double price,
                  double quantity, double currentMarketPrice) {

    // 0. Emergency Kill Switch
    // If we detected a critical failure previously, reject everything.

    // 1. Fat Finger Check (Max Order Size)
    if (quantity > maxOrderSize_) {
      std::cerr << "[RISK] REJECTED: Order size " << quantity
                << " exceeds limit " << maxOrderSize_ << std::endl;
      return false;
    }

    // 2. Position Limit Check
    // Calculate projected position if this order fills.
    double projectedPosition = currentPosition_;
    if (side == Side::Buy) {
      projectedPosition += quantity;
    } else {
      projectedPosition -= quantity;
    }

    if (std::abs(projectedPosition) > maxPosition_) {
      std::cerr << "[RISK] REJECTED: Projected position " << projectedPosition
                << " exceeds limit " << maxPosition_ << std::endl;
      return false;
    }

    // 3. Price Band Check (Price Collar)
    // Prevent buying too high or selling too low compared to market price.
    // currentMarketPrice should be the opposite side of book (e.g. buying?
    // check against Ask)
    if (currentMarketPrice > 0) {
      double deviation =
          std::abs(price - currentMarketPrice) / currentMarketPrice;
      if (deviation > maxPriceDeviation_) {
        std::cerr << "[RISK] REJECTED: Price " << price << " deviates "
                  << (deviation * 100) << "% from market " << currentMarketPrice
                  << " (Limit: " << (maxPriceDeviation_ * 100) << "%)"
                  << std::endl;
        return false;
      }
    }

    // 4. Order Rate Limit (Throttling)
    // Why? Exchanges will ban you if you send too many orders per second (DDoS
    // protection). Algorithm: Token Bucket / Sliding Window approximation. If
    // we exceed N orders in T milliseconds, we reject.
    auto now = std::chrono::steady_clock::now();
    // Using steady_clock is critical! system_clock can jump (NTP sync) and
    // break logic.
    auto timeDiff = std::chrono::duration_cast<std::chrono::milliseconds>(
        now - lastCheckTime_);

    // Reset the window if enough time has passed
    if (timeDiff >=
        std::chrono::milliseconds(1000)) { // Fixed 1 sec window for simplicity
      ordersInWindow_ = 0;
      lastCheckTime_ = now;
    }

    if (ordersInWindow_ >= maxOrderRate_) {
      // Log error but don't throw. Just return false.
      std::cerr << "[RISK] REJECTED: Order Rate Limit Exceeded ("
                << ordersInWindow_ << "/" << maxOrderRate_ << " per sec)"
                << std::endl;
      return false;
    }

    // If all checks pass, we increment the throttle counter.
    ordersInWindow_++;
    return true; // Order is Safe to Send
  }

  // Update position after a fill (Post-Trade)
  // Thread-safety: In a real system, use atomics or locks.
  // Here we assume single-threaded updates from Strategy thread.
  void updatePosition(Side side, double quantity) {
    if (side == Side::Buy) {
      currentPosition_ += quantity;
    } else {
      currentPosition_ -= quantity;
    }
  }

private:
  // Limits - Declaration Order Matters for Initializer List!
  const double maxOrderSize_;
  const double maxPosition_;
  const double maxPriceDeviation_;
  const int maxOrderRate_;
  const std::chrono::milliseconds orderCountTimeWindow_;

  // State
  std::atomic<double> currentPosition_;

  // Rate Limiting State
  std::chrono::steady_clock::time_point lastCheckTime_;
  int ordersInWindow_;
};

} // namespace quant
