#pragma once
#include "ExecutionReport.hpp"
#include "Types.hpp"
#include <functional>
#include <string>
#include <vector>
#include <mutex>

namespace quant {

struct PendingOrder {
    long long orderId;
    std::string symbol;
    Side side;
    double price;
    double quantity;
    OrderType type;
};

// The Gateway acts as an internal Limit Order Book Matching Engine.
// It rests Limit Orders and continuously evaluates them against live ticks.
class OrderGateway {
public:
  using ExecCallback = std::function<void(const ExecutionReport &)>;

  OrderGateway() {}

  void setExecutionCallback(ExecCallback callback) {
    execCallback_ = std::move(callback);
  }

  // Route an order. Market orders execute immediately against L1.
  // Limit orders rest in the internal queue.
  void sendOrder(const std::string &symbol, Side side, double price,
                 double quantity, OrderType type, long long orderId);

  // Evaluates resting Limit orders against the Live Top-of-Book
  // Emits ExecutionReports for any limits that cross the spread.
  void matchOrders(const std::string &symbol, double currentBid, double currentAsk);

private:
  ExecCallback execCallback_;
  
  std::mutex queueMutex_;
  std::vector<PendingOrder> restingOrders_;
};

} // namespace quant
