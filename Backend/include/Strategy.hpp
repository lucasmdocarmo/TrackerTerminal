#pragma once
#include "LatencyMonitor.hpp"
#include "LockFreeQueue.hpp"
#include "Logger.hpp"
#include "MarketDataAdapter.hpp" // For BookTicker struct
#include "OrderBook.hpp"
#include "OrderGateway.hpp"
#include "OrderManager.hpp"
#include "RiskManager.hpp"
#include "SymbolManager.hpp"
#include <string>
#include <thread>
#include <unordered_map>

namespace quant {

// The Strategy Engine.
class Strategy {
public:
  Strategy(OrderGateway &gateway, OrderManager &orderManager,
           RiskManager &riskManager)
      : gateway_(gateway), orderManager_(orderManager),
        riskManager_(riskManager), latencyMonitor_("Strategy::onMarketData") {

    // Register symbols and get IDs
    btcUsdtId_ = SymbolManager::instance().getId("BTCUSDT");
    ethBtcId_ = SymbolManager::instance().getId("ETHBTC");
    ethUsdtId_ = SymbolManager::instance().getId("ETHUSDT");

    // Initialize books using SymbolId as key
    orderBooks_.emplace(btcUsdtId_, OrderBook("BTCUSDT"));
    orderBooks_.emplace(ethBtcId_, OrderBook("ETHBTC"));
    orderBooks_.emplace(ethUsdtId_, OrderBook("ETHUSDT"));
  }

  // The Core Loop: Consumes market data from the Lock-Free Queue.
  // This runs on a dedicated, pinned CPU core (isolated from OS noise).
  void run(LockFreeQueue<BookTicker, 1024> &queue) {
    Logger::instance().log("Strategy Engine started.");
    BookTicker ticker;

    // Busy-Wait Loop (Spinning)
    // Why? OS Sleep/Wakeup takes microseconds. Spinning takes nanoseconds.
    // In HFT, 99.9% of CPU time is spent checking "Is there data?".
    while (running_) {
      while (queue.pop(ticker)) {
        // Latency Measurement: Start clock
        latencyMonitor_.start();

        onMarketData(ticker);

        // Latency Measurement: Stop clock
        latencyMonitor_.stop();
      }
      // Yield to OS only if queue is empty to prevent 100% CPU burn on laptop.
      // In production, we would NOT yield. We would burn the core.
      std::this_thread::yield();
    }

    latencyMonitor_.report();
  }

  void stop() { running_ = false; }

private:
  // PROCESSED ON EVERY TICK (HOT PATH)
  // Latency Budget: < 1 microsecond.
  void onMarketData(const BookTicker &ticker) {
    // 1. Symbol Lookup
    // We Map "BTCUSDT" (string) -> 1 (int) at startup.
    // Hash map lookups with int keys are O(1) and extremely fast.
    SymbolId symId = SymbolManager::instance().getId(ticker.symbol);

    // 2. Update Order Book
    // We maintain a local view of the market state.
    auto it = orderBooks_.find(symId);
    if (it != orderBooks_.end()) {
      it->second.updateBid(ticker.best_bid_price, ticker.best_bid_qty);
      it->second.updateAsk(ticker.best_ask_price, ticker.best_ask_qty);
      
      // Execute the native C++ Matching Engine against the tick!
      gateway_.matchOrders(ticker.symbol, ticker.best_bid_price, ticker.best_ask_price);
    } else {
      return; // Unknown symbol
    }

    // 3. Strategy Logic: Triangular Arbitrage
    // Path: USDT -> BTC -> ETH -> USDT
    // We need 3 live prices:
    // A. Ask Price of BTC/USDT (Buying BTC)
    // B. Ask Price of ETH/BTC (Buying ETH with BTC)
    // C. Bid Price of ETH/USDT (Selling ETH for USDT)

    // We check existence first (map.count is O(1))
    if (orderBooks_.count(btcUsdtId_) && orderBooks_.count(ethBtcId_) &&
        orderBooks_.count(ethUsdtId_)) {

      double btcUsdtAsk = orderBooks_.at(btcUsdtId_).getBestAsk();
      double ethBtcAsk = orderBooks_.at(ethBtcId_).getBestAsk();
      double ethUsdtBid = orderBooks_.at(ethUsdtId_).getBestBid();

      // Ensure markets are active (prices > 0)
      if (btcUsdtAsk > 0 && ethBtcAsk > 0 && ethUsdtBid > 0) {
        // Calculation:
        // Start with 100 USDT.
        // Step 1: Buy BTC.  BTC = 100 / Price(BTCUSDT)
        // Step 2: Buy ETH.  ETH = BTC / Price(ETHBTC)
        // Step 3: Sell ETH. USDT = ETH * Price(ETHUSDT)
        double amountUSDT = 100.0;
        double btcAmount = amountUSDT / btcUsdtAsk;
        double ethAmount = btcAmount / ethBtcAsk;
        double endUSDT = ethAmount * ethUsdtBid;

        double profit = endUSDT - amountUSDT;

        // Trade Threshold: > 0.0 USDT profit (0%)
        if (profit > 0.0 || !tradeExecuted_) {
          // Logging is expensive! In prod, log asynchronously or only on fills.
          if (profit > 0.0) {
            Logger::instance().log("ARBITRAGE OPPORTUNITY FOUND! Profit: " +
                                   std::to_string(profit));
          } else {
            // For this Demo, we force 1 trade to prove the OMS works.
            Logger::instance().log("Forcing 1 trade for OMS/EMS Demo...");
          }
          executeArbitrage(btcUsdtAsk, ethBtcAsk, ethUsdtBid);
          tradeExecuted_ = true;
        }
      }
    }

    // 4. Strategy Logic: Alpha Signal
    checkAlphaSignal(symId);
  }

  // Alpha Signal: Order Book Imbalance (OBI)
  // Hypothesis: If there are HUGE headers of Buy orders (Bids)
  // and very few Sell orders (Asks), the price is likely to go UP due to
  // pressure. Formula: (BidQty - AskQty) / (BidQty + AskQty) Range: [-1, +1].
  //   +1.0 = All Bids (Strong Buy Pressure)
  //   -1.0 = All Asks (Strong Sell Pressure)
  void checkAlphaSignal(SymbolId symId) {
    if (symId != btcUsdtId_)
      return; // Simple demo: Only trade BTC

    const auto &book = orderBooks_.at(symId);
    double bidQty = book.getBestBidQty();
    double askQty = book.getBestAskQty();
    double totalQty = bidQty + askQty;

    if (totalQty <= 0)
      return;

    double imbalance = (bidQty - askQty) / totalQty;

    // Threshold: > 0.1 (10% more bids than asks)
    if (imbalance > 0.1) {
      Logger::instance().log(
          "ALPHA SIGNAL: Strong Buy Pressure on BTCUSDT! Imbalance: " +
          std::to_string(imbalance));

      double price = book.getBestAsk(); // Crossing the spread (Taker)
      double qty = 0.01;

      // RISK CHECK: Always check with RiskManager before sending!
      if (riskManager_.checkOrder("BTCUSDT", Side::Buy, price, qty,
                                  book.getBestAsk())) {

        // 1. Create Order in OMS (State: New)
        long long id =
            orderManager_.createOrder(btcUsdtId_, Side::Buy, price, qty);

        // 2. Send to Gateway (Simulated Exchange)
        gateway_.sendOrder("BTCUSDT", Side::Buy, price, qty, OrderType::Market,
                           id);

        // 3. Update Position tracking (Conservative approach: modify exposure
        // now)
        riskManager_.updatePosition(Side::Buy, qty);

        Logger::instance().log("Sent Alpha Order ID: " + std::to_string(id));
      }
    }
  }

  void executeArbitrage(double price1, double price2, double price3) {
    Logger::instance().log(
        "Executing Arbitrage Strategy at prices: " + std::to_string(price1) +
        ", " + std::to_string(price2) + ", " + std::to_string(price3));

    double qty = 0.001;

    // Risk Check: Pass current market price (Ask/Bid depending on side)
    // Leg 1: Buy BTCUSDT. We check against the current Ask (price1).
    if (riskManager_.checkOrder("BTCUSDT", Side::Buy, price1, qty,
                                orderBooks_.at(btcUsdtId_).getBestAsk())) {

      // Use efficient Integer ID for Order creation
      long long id =
          orderManager_.createOrder(btcUsdtId_, Side::Buy, price1, qty);

      // Pass ID to Gateway for tracking
      gateway_.sendOrder("BTCUSDT", Side::Buy, price1, qty, OrderType::Market,
                         id);
      Logger::instance().log("Sent leg 1 order ID: " + std::to_string(id));

      // Update Risk Position immediately (Conservative: assume fill)
      riskManager_.updatePosition(Side::Buy, qty);

      // Note: We no longer manually call orderManager_.onFill()
      // The Gateway will trigger onExecutionReport() asynchronously!

      // ... legs 2 and 3 logic (omitted for brevity)
    }
  }

  OrderGateway &gateway_;
  OrderManager &orderManager_;
  RiskManager &riskManager_;
  LatencyMonitor latencyMonitor_;

  // Pre-computed IDs for fast access
  SymbolId btcUsdtId_;
  SymbolId ethBtcId_;
  SymbolId ethUsdtId_;

  // Map of SymbolId -> OrderBook
  std::unordered_map<SymbolId, OrderBook> orderBooks_;

  std::atomic<bool> running_{true};
  bool tradeExecuted_{false};
};

} // namespace quant
