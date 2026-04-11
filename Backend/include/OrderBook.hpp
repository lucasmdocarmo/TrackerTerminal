#pragma once
#include <iostream>
#include <array>
#include <string>
#include <vector>

namespace quant {

// Represents a single level in the order book
struct PriceLevel {
  double price;
  double quantity;
};

// True HFT Flat-Array Limit Order Book
// Eliminates std::map (Red-Black Trees) to ensure contiguous memory allocation,
// preventing L1/L2 cache misses on the hot path.
class OrderBook {
public:
  OrderBook(const std::string &symbol) : symbol_(symbol) {
      bids_[0] = {0.0, 0.0};
      asks_[0] = {0.0, 0.0};
  }

  // Update Top of Book Bid (Optimized for L1 feed)
  void updateBid(double price, double quantity) {
      bids_[0].price = price;
      bids_[0].quantity = quantity;
  }

  // Update Top of Book Ask (Optimized for L1 feed)
  void updateAsk(double price, double quantity) {
      asks_[0].price = price;
      asks_[0].quantity = quantity;
  }

  double getBestBid() const { return bids_[0].price; }
  double getBestAsk() const { return asks_[0].price; }
  double getBestBidQty() const { return bids_[0].quantity; }
  double getBestAskQty() const { return asks_[0].quantity; }

  double getMidPrice() const {
    double bb = getBestBid();
    double ba = getBestAsk();
    if (bb == 0 || ba == 0) return 0.0;
    return (bb + ba) / 2.0;
  }

  void print() const {
    std::cout << "Order Book [" << symbol_ << "]" << std::endl;
    std::cout << "  ASKS:" << std::endl;
    std::cout << "    " << asks_[0].price << " x " << asks_[0].quantity << std::endl;
    std::cout << "  -----------------" << std::endl;
    std::cout << "  BIDS:" << std::endl;
    std::cout << "    " << bids_[0].price << " x " << bids_[0].quantity << std::endl;
    std::cout << std::endl;
  }

private:
  std::string symbol_;
  
  // Flat Arrays for Density. Scalable to MAX_DEPTH dynamically later.
  static constexpr size_t MAX_DEPTH = 1;
  std::array<PriceLevel, MAX_DEPTH> bids_;
  std::array<PriceLevel, MAX_DEPTH> asks_;
};

} // namespace quant
