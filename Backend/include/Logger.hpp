#pragma once
#include <chrono>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <sstream>

namespace quant {

// Logger (Trade Recorder)
// In HFT, we cannot use standard `std::cout` or file I/O in the critical path
// because it blocks the thread while waiting for the disk. This implementation
// uses a simple approach for the demo, but in a real system, this would write
// to a lock-free ring buffer, and a separate low-priority thread would flush
// that buffer to disk (making it asynchronous logging).
class Logger {
public:
  static Logger &instance() {
    static Logger instance;
    return instance;
  }

  // Log a message with a high-resolution timestamp
  void log(const std::string &message) {
    auto now = std::chrono::system_clock::now();
    auto now_c = std::chrono::system_clock::to_time_t(now);
    auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                  now.time_since_epoch()) %
              1000;

    std::stringstream ss;
    ss << std::put_time(std::localtime(&now_c), "%Y-%m-%d %H:%M:%S") << '.'
       << std::setfill('0') << std::setw(3) << ms.count() << " | " << message;

    // In a real system, push 'ss.str()' to a lock-free queue here.
    // For this demo, we just print to stdout to avoid complexity.
    std::cout << ss.str() << std::endl;

    // Also write to file (simulation of trade recording)
    if (logFile_.is_open()) {
      logFile_ << ss.str() << std::endl;
    }
  }

private:
  Logger() {
    logFile_.open("execution_log.txt", std::ios::out | std::ios::app);
  }

  ~Logger() {
    if (logFile_.is_open()) {
      logFile_.close();
    }
  }

  std::ofstream logFile_;
};

} // namespace quant
