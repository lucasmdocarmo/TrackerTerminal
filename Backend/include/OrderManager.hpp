#pragma once
#include "ExecutionReport.hpp"
#include "ObjectPool.hpp"
#include "OrderGateway.hpp"
#include "SymbolManager.hpp" // For SymbolId
#include "Types.hpp"         // For OrderState, Side
#include <iostream>
#include <mutex>
#include <unordered_map>

namespace quant {

struct Order {
  long long orderId;
  SymbolId symbolId; // Changed from std::string
  Side side;
  double price;
  double quantity;
  double filledQuantity;
  OrderState state;

  // Default constructor for pool compatibility
  Order() = default;

  Order(long long id, SymbolId symId, Side s, double p, double q)
      : orderId(id), symbolId(symId), side(s), price(p), quantity(q),
        filledQuantity(0.0), state(OrderState::New) {}
};

// Order Manager
// Tracks the lifecycle of every order.
// Uses an ObjectPool to avoid 'new' during runtime.
class OrderManager {
public:
  OrderManager() : nextOrderId_(1) {}

  // Create and track a new order
  // Returns the assigned Order ID.
  long long createOrder(SymbolId symbolId, Side side, double price,
                        double quantity) {
    std::lock_guard<std::mutex> lock(mutex_);

    // Acquire order from pool (zero overhead)
    Order *order =
        orderPool_.acquire(nextOrderId_, symbolId, side, price, quantity);
    if (!order)
      return -1; // Pool exhausted

    long long id = nextOrderId_++;
    orders_[id] = order;

    return id;
  }

  // Update the state of an order manually (e.g. from Strategy)
  void updateOrderState(long long orderId, OrderState newState) {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = orders_.find(orderId);
    if (it != orders_.end()) {
      it->second->state = newState;
    }
  }

  // Retrieve order details
  // Returns pointer (unowned)
  const Order *getOrder(long long orderId) {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = orders_.find(orderId);
    if (it != orders_.end()) {
      return it->second;
    }
    return nullptr;
  }

  // Track fills via explicit method (Legacy/Manual)
  void onFill(long long orderId, double fillQty, double fillPrice) {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = orders_.find(orderId);
    if (it != orders_.end()) {
      it->second->filledQuantity += fillQty;
      if (it->second->filledQuantity >= it->second->quantity) {
        it->second->state = OrderState::Filled;
        std::cout << "[OM] Order " << orderId << " Filled: " << fillQty << " @ "
                  << fillPrice << std::endl;
      } else {
        std::cout << "[OM] Order " << orderId << " Partial Fill: " << fillQty
                  << " @ " << fillPrice << std::endl;
      }
    }
  }

  // PROCESS EXECUTION REPORT (The Core OMS Logic)
  // This is called by the Gateway when an update arrives from the Exchange.
  void onExecutionReport(const ExecutionReport &report) {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = orders_.find(report.orderId);
    if (it == orders_.end()) {
      std::cerr << "[OM] Unknown Order ID in Report: " << report.orderId
                << std::endl;
      return;
    }

    Order *order = it->second;

    switch (report.execType) {
    case ExecType::New:
      order->state = OrderState::New;
      std::cout << "[OM] Order " << order->orderId << " Confirmed New."
                << std::endl;
      break;

    case ExecType::PartialFill:
    case ExecType::Fill:
      order->filledQuantity = report.cumQty;
      order->state = report.orderState;
      if (order->state == OrderState::Filled) {
        std::cout << "[OM] Order " << order->orderId
                  << " FILLED! Price: " << report.lastPrice << std::endl;
      } else {
        std::cout << "[OM] Order " << order->orderId
                  << " PARTIAL FILL. CumQty: " << report.cumQty << std::endl;
      }
      break;

    case ExecType::Canceled:
      order->state = OrderState::Canceled;
      std::cout << "[OM] Order " << order->orderId << " CANCELED." << std::endl;
      // Release back to pool? Maybe later.
      break;

    case ExecType::Rejected:
      order->state = OrderState::Rejected;
      std::cerr << "[OM] Order " << order->orderId
                << " REJECTED! Reason: " << report.text << std::endl;
      break;

    default:
      break;
    }
  }

private:
  // Map ID -> Pointer (into the pool)
  std::unordered_map<long long, Order *> orders_;
  long long nextOrderId_;
  std::mutex mutex_;

  // Pre-allocate 100,000 orders. Enough for a busy trading day.
  // 100k * sizeof(Order) ~ 8MB. Trivial for modern RAM.
  ObjectPool<Order, 100000> orderPool_;
};

} // namespace quant
