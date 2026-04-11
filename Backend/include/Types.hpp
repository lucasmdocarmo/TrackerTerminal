#pragma once

namespace quant {

enum class OrderState { New, PendingNew, Filled, Canceled, Rejected };

enum class OrderType { Limit, Market, IOC, FOK };

enum class Side { Buy, Sell };

enum class ExecType {
  New,           // 0: Order Accepted
  PartialFill,   // 1: Partially Executed
  Fill,          // 2: Fully Execution
  Canceled,      // 4: Order Canceled
  Rejected,      // 8: Order Rejected
  PendingCancel, // 6: Cancel Request Received
  PendingNew     // A: Order Sent
};

} // namespace quant
