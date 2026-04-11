#pragma once
#include "MarketDataAdapter.hpp"
#include <boost/asio/ssl/stream.hpp>
#include <boost/asio/strand.hpp>
#include <boost/beast/core.hpp>
#include <boost/beast/ssl.hpp>
#include <boost/beast/websocket.hpp>
#include <boost/beast/websocket/ssl.hpp>
#include <iostream>
#include <memory>

namespace quant {

namespace beast = boost::beast;         // from <boost/beast.hpp>
namespace http = beast::http;           // from <boost/beast/http.hpp>
namespace websocket = beast::websocket; // from <boost/beast/websocket.hpp>
namespace net = boost::asio;            // from <boost/asio.hpp>
namespace ssl = boost::asio::ssl;       // from <boost/asio/ssl.hpp>
using tcp = boost::asio::ip::tcp;       // from <boost/asio/ip/tcp.hpp>

class BinanceMarketData
    : public std::enable_shared_from_this<BinanceMarketData>,
      public MarketDataAdapter {
  net::io_context &ioc_;
  ssl::context &ctx_;
  tcp::resolver resolver_;
  // websocket::stream<beast::ssl_stream<beast::tcp_stream>>
  websocket::stream<beast::ssl_stream<beast::tcp_stream>> ws_;
  beast::flat_buffer buffer_;
  std::string host_ = "stream.binance.com";
  std::string port_ = "9443";
  std::string target_; // Stores the connection target (e.g., "btcusdt")
  MarketDataCallback callback_;

public:
  explicit BinanceMarketData(net::io_context &ioc, ssl::context &ctx);
  void connect(const std::string &symbol)
      override; // We use connect to start the connection flow
  void subscribe(const std::string &symbol)
      override; // Usually sends a subscribe message if connected
  void setCallback(MarketDataCallback callback) override;
  void run() override; // Simply runs the io_context

private:
  void on_resolve(beast::error_code ec, tcp::resolver::results_type results);
  void on_connect(beast::error_code ec,
                  tcp::resolver::results_type::endpoint_type ep);
  void on_ssl_handshake(beast::error_code ec);
  void on_handshake(beast::error_code ec);
  void do_read();
  void on_read(beast::error_code ec, std::size_t bytes_transferred);
};

} // namespace quant
