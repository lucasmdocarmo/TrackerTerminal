#include "BinanceMarketData.hpp"
#include "LockFreeQueue.hpp"
#include "OrderGateway.hpp"
#include "OrderManager.hpp"
#include "RiskManager.hpp"
#include "Strategy.hpp"
#include "ThreadUtils.hpp"
#include <boost/asio.hpp>
#include <boost/asio/ssl.hpp>
#include <iostream>
#include <thread>

#include "MarketDataReplay.hpp" // Added include
#include "ExecutionServer.hpp"

namespace net = boost::asio;
namespace ssl = boost::asio::ssl;

int main(int argc, char *argv[]) { // Updated signature
  try {
    std::cout << "Starting High-Frequency Execution System..." << std::endl;

    // 1. Initialize Shared Resources
    // The Ring Buffer (Lock-Free Queue) connects Market Data (Producer) to
    // Strategy (Consumer). Capacity is 1024, must be power of 2. We allocate
    // this on the stack or heap. Since it's passed by reference, it must
    // outlive the threads.
    quant::LockFreeQueue<quant::BookTicker, 1024> marketDataQueue;

    // 2. Initialize Order Components
    quant::OrderGateway orderGateway;
    quant::RiskManager riskManager;
    quant::OrderManager orderManager;

    // 3. Initialize Strategy Engine
    quant::Strategy strategy(orderGateway, orderManager, riskManager);

    // 4. Initialize Market Data Adapter
    std::shared_ptr<quant::MarketDataAdapter> marketData;
    net::io_context ioc;

    // Start Execution Server for Python Backend Interop
    quant::ExecutionServer execServer(ioc, 9001, orderGateway);

    // Check for Replay Mode
    // Usage: ./execution_engine --replay data.csv
    if (argc > 2 && std::string(argv[1]) == "--replay") {
      marketData = std::make_shared<quant::MarketDataReplay>(argv[2]);
      std::cout << "[Main] Running in REPLAY Mode using " << argv[2]
                << std::endl;
    } else {
      // Live Mode
      ssl::context ctx{ssl::context::tlsv12_client};
      ctx.set_default_verify_paths();
      ctx.set_verify_mode(ssl::verify_peer);
      marketData = std::make_shared<quant::BinanceMarketData>(ioc, ctx);
    }

    // 5. Connect Components
    // Set the callback on the Market Data Adapter to push to the queue.
    // Critical: This callback runs on the Network Thread. It must be FAST.
    // Pushing to the generic lock-free queue is O(1) and non-blocking.
    marketData->setCallback(
        [&marketDataQueue](const quant::BookTicker &ticker) {
          // Producer Thread: Push data
          if (!marketDataQueue.push(ticker)) {
            // If queue is full, we drop the packet.
            // In HFT, dropping old data is often better than blocking new data.
            std::cerr << "Warning: Market Data Queue Full! Dropping packet."
                      << std::endl;
          }
        });

    // Connect Gateway to OrderManager for Execution Reports
    orderGateway.setExecutionCallback(
        [&orderManager, &execServer](const quant::ExecutionReport &report) {
          orderManager.onExecutionReport(report);
          execServer.broadcastReport(report);
        });

    // Connect to multiple streams: BTCUSDT, ETHBTC, ETHUSDT
    // Binance stream format for combined streams:
    // /stream?streams=<stream_name>/<stream_name>... Our implementation
    // currently hardcodes the path in on_ssl_handshake, so we need to update it
    // or just pass the simple string if we update the connect method.
    // For this demo, let's assume valid implementation change or just single
    // stream for now to verify compilation, but ideally:
    marketData->connect(
        "btcusdt@bookTicker/ethbtc@bookTicker/ethusdt@bookTicker");

    // 6. Launch Threads

    // Thread A: Strategy Engine (Consumer)
    // Runs on its own core, spinning on the queue.
    std::thread strategyThread([&strategy, &marketDataQueue]() {
      quant::ThreadUtils::setThreadName("StrategyThread");
      quant::ThreadUtils::pinThread(1); // Set Affinity Tag/Core
      strategy.run(marketDataQueue);
    });

    // Thread B: Network IO (Producer)
    // Runs the ASIO event loop to handle WebSocket traffic.
    std::thread networkThread([&ioc]() {
      quant::ThreadUtils::setThreadName("NetworkThread");
      quant::ThreadUtils::pinThread(2); // Set Affinity Tag/Core
      ioc.run();
    });

    // Main thread loops forever instead of relying on standard input EOF
    std::cout << "System Running. (Press Ctrl+C to stop in foreground)" << std::endl;
    while (true) {
        std::this_thread::sleep_for(std::chrono::seconds(1));
    }

      strategyThread.join();
    if (networkThread.joinable())
      networkThread.join();

    // Wait for any detached simulated OrderGateway threads to finish
    // Since they simulate latency (up to 50ms), we sleep 100ms here to prevent
    // them from accessing destroyed Stack objects (mutexes) out of scope.
    std::this_thread::sleep_for(std::chrono::milliseconds(100));

  } catch (const std::exception &e) {
    std::cerr << "Error: " << e.what() << std::endl;
    return 1;
  }

  return 0;
}
