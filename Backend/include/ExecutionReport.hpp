#pragma once
#include "Types.hpp" // For Side, OrderState, ExecType
#include <string>

namespace quant {

// Represents a FIX execution report (msgType=8)
struct ExecutionReport {
  long long orderId;
  std::string clientOrderId;
  // Exchange-assigned ID (simulated)
  std::string execId;
  std::string symbol;
  Side side;

  double lastQty;   // Quantity filled in this specific execution
  double lastPrice; // Price of this specific fill
  double leavesQty; // Quantity remaining to be filled
  double cumQty;    // Cumulative quantity filled so far
  double avgPrice;  // Weighted Average Price of fill so far

  ExecType execType;
  OrderState orderState;
  std::string text; // Optional message (e.g. rejection reason)
};

} // namespace quant
