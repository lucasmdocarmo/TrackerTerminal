#pragma once
#include "MarketDataAdapter.hpp"
#include <chrono>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

namespace quant {

class MarketDataReplay : public MarketDataAdapter {
public:
  MarketDataReplay(const std::string &filename) : filename_(filename) {}

  void connect(const std::string & /*streams*/) override {
    std::cout << "[Replay] Loading market data from " << filename_ << "..."
              << std::endl;
    runReplay();
  }

  void subscribe(const std::string & /*symbol*/) override {
    // No-op for replay
  }

  void run() override {
    // No-op
  }

  void setCallback(MarketDataCallback callback) override {
    callback_ = callback;
  }

private:
  void runReplay() {
    std::ifstream file(filename_);
    if (!file.is_open()) {
      std::cerr << "[Replay] Error: Could not open file " << filename_
                << std::endl;
      return;
    }

    std::string line;
    // Skip header if present (assuming casual CSV format)
    if (std::getline(file, line)) {
      // Just verify it looks like a header or log it
    }

    int count = 0;
    while (std::getline(file, line)) {
      if (line.empty())
        continue;

      // Parse CSV Line: timestamp,symbol,bid_price,bid_qty,ask_price,ask_qty
      try {
        BookTicker ticker = parseLine(line);

        if (callback_) {
          callback_(ticker);
          count++;
        }
      } catch (const std::exception &e) {
        std::cerr << "[Replay] Parse error: " << e.what() << " " << line
                  << std::endl;
      }

      // Simulate speed (optional, for now blast through as fast as possible)
      // In a real replay, you might sleep to match timestamps.
      // std::this_thread::sleep_for(std::chrono::microseconds(1));
    }
    std::cout << "[Replay] Finished processing " << count << " ticks."
              << std::endl;
  }

  BookTicker parseLine(const std::string &line) {
    std::stringstream ss(line);
    std::string segment;
    std::vector<std::string> parts;

    while (std::getline(ss, segment, ',')) {
      parts.push_back(segment);
    }

    BookTicker ticker;
    // Simple robust parsing assuming valid CSV for demo
    if (parts.size() >= 6) {
      // parts[0] is timestamp (ignored for now)
      ticker.symbol = parts[1];
      ticker.best_bid_price = std::stod(parts[2]);
      ticker.best_bid_qty = std::stod(parts[3]);
      ticker.best_ask_price = std::stod(parts[4]);
      ticker.best_ask_qty = std::stod(parts[5]);
    }
    return ticker;
  }

  std::string filename_;
  MarketDataCallback callback_;
};

} // namespace quant
