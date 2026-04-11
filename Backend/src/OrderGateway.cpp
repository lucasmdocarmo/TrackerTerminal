#include "OrderGateway.hpp"
#include "ExecutionReport.hpp"
#include <iostream>

namespace quant {

void OrderGateway::sendOrder(const std::string &symbol, Side side, double price,
                             double quantity, OrderType type,
                             long long orderId) {
  if (!execCallback_) return;
  
  ExecutionReport report;
  report.orderId = orderId;
  report.symbol = symbol;
  report.side = side;
  report.leavesQty = quantity;
  report.cumQty = 0;
  report.avgPrice = 0;

  if (type == OrderType::Market) {
    // Market Orders instantly cross the spread (Zero Latency Execution)
    report.lastQty = quantity;
    report.lastPrice = price; 
    report.leavesQty = 0;
    report.cumQty = quantity;
    report.avgPrice = price;
    report.execType = ExecType::Fill;
    report.orderState = OrderState::Filled;
    report.text = "Market Order Instantly Filled";
    execCallback_(report);
  } else {
    // Limit Orders are routed to the Resting Queue
    std::lock_guard<std::mutex> lock(queueMutex_);
    restingOrders_.push_back({orderId, symbol, side, price, quantity, type});
    
    // Acknowledge Receipt
    report.lastQty = 0;
    report.lastPrice = 0;
    report.execType = ExecType::New;
    report.orderState = OrderState::New;
    report.text = "Limit Order Resting";
    execCallback_(report);
  }
}

void OrderGateway::matchOrders(const std::string &symbol, double currentBid, double currentAsk) {
  if (!execCallback_) return;
  
  std::lock_guard<std::mutex> lock(queueMutex_);
  for (auto it = restingOrders_.begin(); it != restingOrders_.end(); ) {
      bool filled = false;
      double fillPrice = 0.0;
      
      if (it->symbol == symbol) {
          if (it->side == Side::Buy && currentAsk > 0 && currentAsk <= it->price) {
              // Market ask price dropped below or equal to our Limit Buy Target!
              filled = true;
              fillPrice = currentAsk; // Price Improvement
          } else if (it->side == Side::Sell && currentBid > 0 && currentBid >= it->price) {
              // Market bid price rose above or equal to our Limit Sell Target!
              filled = true;
              fillPrice = currentBid; // Price Improvement
          }
      }
      
      if (filled) {
          ExecutionReport report;
          report.orderId = it->orderId;
          report.symbol = it->symbol;
          report.side = it->side;
          report.lastQty = it->quantity;
          report.lastPrice = fillPrice;
          report.leavesQty = 0;
          report.cumQty = it->quantity;
          report.avgPrice = fillPrice;
          report.execType = ExecType::Fill;
          report.orderState = OrderState::Filled;
          report.text = "Resting Limit Crossed Spread";
          
          execCallback_(report);
          
          it = restingOrders_.erase(it); // Remove fulfilled order from LOB
      } else {
          ++it;
      }
  }
}

} // namespace quant
