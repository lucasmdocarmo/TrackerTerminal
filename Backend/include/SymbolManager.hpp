#pragma once
#include <iostream>
#include <string>
#include <unordered_map>
#include <vector>

namespace quant {

// Using integers for symbol IDs is much faster than string comparisons.
// Comparison: O(1) integer op vs O(N) string compare.
using SymbolId = int;

class SymbolManager {
public:
  static SymbolManager &instance() {
    static SymbolManager instance;
    return instance;
  }

  // Register or retrieve a symbol ID
  SymbolId getId(const std::string &symbol) {
    auto it = symbolToId_.find(symbol);
    if (it != symbolToId_.end()) {
      return it->second;
    }

    // Register new symbol
    SymbolId id = nextId_++;
    symbolToId_[symbol] = id;
    idToSymbol_.push_back(symbol);
    return id;
  }

  // Retrieve string from ID (for logging/display)
  const std::string &getSymbol(SymbolId id) const {
    if (id >= 0 && id < (int)idToSymbol_.size()) {
      return idToSymbol_[id];
    }
    static const std::string unknown = "UNKNOWN";
    return unknown;
  }

private:
  SymbolManager() : nextId_(0) {}

  SymbolId nextId_;
  std::unordered_map<std::string, SymbolId> symbolToId_;
  std::vector<std::string> idToSymbol_;
};

} // namespace quant
