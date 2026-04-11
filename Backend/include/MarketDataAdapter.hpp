#pragma once
#include <functional>
#include <memory>
#include <string>
#include <vector>

namespace quant {

struct BookTicker {
  std::string symbol;
  double best_bid_price;
  double best_bid_qty;
  double best_ask_price;
  double best_ask_qty;
  long long update_id;
};

using MarketDataCallback = std::function<void(const BookTicker &)>;

class MarketDataAdapter {
public:
  virtual ~MarketDataAdapter() = default;

  // Connect to the exchange market data feed
  virtual void connect(const std::string &symbol) = 0;

  // Subscribe to updates for a specific symbol
  virtual void subscribe(const std::string &symbol) = 0;

  // Set callback for market data updates
  virtual void setCallback(MarketDataCallback callback) = 0;

  // Start the event loop (blocking or non-blocking depending on implementation)
  virtual void run() = 0;
};

} // namespace quant
