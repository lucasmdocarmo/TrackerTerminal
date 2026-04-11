#pragma once
#include "OrderGateway.hpp"
#include "ExecutionReport.hpp"
#include <boost/asio.hpp>
#include <nlohmann/json.hpp>
#include <iostream>
#include <memory>
#include <string>
#include <vector>
#include <mutex>
#include <atomic>
#include <chrono>

namespace quant {

using boost::asio::ip::tcp;

class ExecutionServer {
public:
    ExecutionServer(boost::asio::io_context& io_context, short port, OrderGateway& gateway)
        : acceptor_(io_context, tcp::endpoint(tcp::v4(), port)), gateway_(gateway) {
        do_accept();
    }

    void broadcastReport(const ExecutionReport& report) {
        nlohmann::json j;
        j["msg_type"] = "ExecutionReport";
        j["order_id"] = report.orderId;
        j["instrument_id"] = report.symbol; // Standardize symbol mapping
        
        std::string status = "UNKNOWN";
        if (report.orderState == OrderState::Filled) status = "FILLED";
        else if (report.execType == ExecType::PartialFill) status = "PARTIALLY_FILLED";
        else if (report.orderState == OrderState::Canceled) status = "CANCELED";
        else if (report.orderState == OrderState::Rejected) status = "REJECTED";
        
        j["status"] = status;
        j["executed_price"] = report.lastPrice;
        j["executed_quantity"] = report.lastQty;
        j["leaves_qty"] = report.leavesQty;
        
        auto msg = std::make_shared<std::string>(j.dump() + "\n");
        
        std::lock_guard<std::mutex> lock(sockets_mutex_);
        for (auto& socket : sockets_) {
            boost::asio::async_write(*socket, boost::asio::buffer(*msg),
                [msg, socket](boost::system::error_code ec, std::size_t /*length*/) {
                    if (ec) {
                        std::cerr << "Error broadcasting ExecutionReport: " << ec.message() << std::endl;
                    }
                });
        }
    }

private:
    void do_accept() {
        auto socket = std::make_shared<tcp::socket>(acceptor_.get_executor());
        acceptor_.async_accept(*socket,
            [this, socket](boost::system::error_code ec) {
                if (!ec) {
                    std::cout << "[ExecutionServer] Python Client Connected!" << std::endl;
                    {
                        std::lock_guard<std::mutex> lock(sockets_mutex_);
                        sockets_.push_back(socket);
                    }
                    do_read(socket);
                }
                do_accept();
            });
    }

    void do_read(std::shared_ptr<tcp::socket> socket) {
        auto buffer = std::make_shared<boost::asio::streambuf>();
        boost::asio::async_read_until(*socket, *buffer, '\n',
            [this, socket, buffer](boost::system::error_code ec, std::size_t /*length*/) {
                if (!ec) {
                    std::istream is(buffer.get());
                    std::string line;
                    std::getline(is, line);
                    
                    try {
                        auto j = nlohmann::json::parse(line);
                        if (j["msg_type"] == "NewOrderSingle") {
                            std::string symbol = j["instrument_id"];
                            Side side = (j["side"] == "BUY") ? Side::Buy : Side::Sell;
                            double price = j["price"];
                            double qty = j["quantity"];
                            
                            // High-performance atomic ID generation (never use std::rand() in HFT)
                            long long target_order_id = ++order_id_counter_;
                            
                            gateway_.sendOrder(symbol, side, price, qty, OrderType::Limit, target_order_id);
                        }
                    } catch (const std::exception& e) {
                        std::cerr << "[ExecutionServer] JSON error: " << e.what() << std::endl;
                    }
                    
                    do_read(socket); // continue reading
                } else {
                    // Socket closed
                    std::lock_guard<std::mutex> lock(sockets_mutex_);
                    sockets_.erase(std::remove(sockets_.begin(), sockets_.end(), socket), sockets_.end());
                    std::cout << "[ExecutionServer] Python Client Disconnected." << std::endl;
                }
            });
    }

    tcp::acceptor acceptor_;
    OrderGateway& gateway_;
    std::vector<std::shared_ptr<tcp::socket>> sockets_;
    std::mutex sockets_mutex_;
    std::atomic<long long> order_id_counter_{
        std::chrono::duration_cast<std::chrono::nanoseconds>(
            std::chrono::system_clock::now().time_since_epoch()
        ).count()
    };
};

} // namespace quant
