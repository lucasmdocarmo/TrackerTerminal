#include "BinanceMarketData.hpp"
#include <iostream>
#include <nlohmann/json.hpp>

// Namespace aliases
namespace quant {

BinanceMarketData::BinanceMarketData(net::io_context &ioc, ssl::context &ctx)
    : ioc_(ioc), ctx_(ctx), resolver_(ioc), ws_(ioc, ctx) {}

void BinanceMarketData::setCallback(MarketDataCallback callback) {
  callback_ = std::move(callback);
}

void BinanceMarketData::connect(const std::string &symbol) {
  target_ = symbol; // Store the target streams
  // Resolve the domain name
  resolver_.async_resolve(
      host_, port_,
      beast::bind_front_handler(&BinanceMarketData::on_resolve,
                                shared_from_this()));
}

void BinanceMarketData::run() {
  // Usually managed by io_context.run() externally, but this method exists for
  // interface purposes. In this implementation, the user calls ioc.run()
}

// TODO: Implement actual subscribe logic
void BinanceMarketData::subscribe(const std::string &symbol) {
  // Binance streams are usually url-based for single stream.
  // For general stream, we connect to /ws and send subscribe message.
  // Here we assume url-based connection for simplicity: /ws/<symbol>@bookTicker
  // If not connected, we store the symbol and connect.
  connect(symbol);
}

void BinanceMarketData::on_resolve(beast::error_code ec,
                                   tcp::resolver::results_type results) {
  if (ec) {
    std::cerr << "Resolve failed: " << ec.message() << "\n";
    return;
  }

  // Set a timeout on the operation
  beast::get_lowest_layer(ws_).expires_after(std::chrono::seconds(30));

  // Make the connection on the IP address we get from a lookup
  beast::get_lowest_layer(ws_).async_connect(
      results, beast::bind_front_handler(&BinanceMarketData::on_connect,
                                         shared_from_this()));
}

void BinanceMarketData::on_connect(
    beast::error_code ec, tcp::resolver::results_type::endpoint_type ep) {
  if (ec) {
    std::cerr << "Connect failed: " << ec.message() << "\n";
    return;
  }

  // Update the host string. This will provide the value of the
  // Host HTTP header during the WebSocket handshake.
  // See https://tools.ietf.org/html/rfc7230#section-5.4
  host_ += ":" + std::to_string(ep.port());

  // Perform the SSL handshake
  ws_.next_layer().async_handshake(
      ssl::stream_base::client,
      beast::bind_front_handler(&BinanceMarketData::on_ssl_handshake,
                                shared_from_this()));
}

void BinanceMarketData::on_ssl_handshake(beast::error_code ec) {
  if (ec) {
    std::cerr << "SSL Handshake failed: " << ec.message() << "\n";
    return;
  }

  // Turn off the timeout on the tcp_stream, because
  // the websocket stream has its own timeout system.
  beast::get_lowest_layer(ws_).expires_never();

  // Set suggested timeout settings for the websocket
  ws_.set_option(
      websocket::stream_base::timeout::suggested(beast::role_type::client));

  // Perform the websocket handshake
  // For combined streams, the path is /stream?streams=<stream1>/<stream2>...
  // In the connect() call from main.cpp, we passed the full string:
  // "btcusdt@bookTicker/ethbtc@bookTicker/..."
  // So we construct the path: /stream?streams=<input>
  std::string target = "/stream?streams=" + target_;
  ws_.async_handshake(
      host_, target,
      beast::bind_front_handler(&BinanceMarketData::on_handshake,
                                shared_from_this()));
}

void BinanceMarketData::on_handshake(beast::error_code ec) {
  if (ec) {
    std::cerr << "Handshake failed: " << ec.message() << "\n";
    return;
  }

  std::cout << "Connected to Binance Market Data Stream." << std::endl;

  // Read a message
  do_read(); // Start the read loop
}

void BinanceMarketData::do_read() {
  // Read a message into our buffer
  ws_.async_read(buffer_, beast::bind_front_handler(&BinanceMarketData::on_read,
                                                    shared_from_this()));
}

void BinanceMarketData::on_read(beast::error_code ec,
                                std::size_t bytes_transferred) {
  if (ec) {
    std::cerr << "Read failed: " << ec.message() << "\n";
    return;
  }

  // Parse the message
  std::string msg = beast::buffers_to_string(buffer_.data());

  try {
    auto json_root = nlohmann::json::parse(msg);
    nlohmann::json json_data;

    // Handle Combined Stream Format
    // { "stream": "<streamName>", "data": { <actual ticker data> } }
    if (json_root.contains("data")) {
      json_data = json_root["data"];
    } else {
      // Fallback for single stream or error
      json_data = json_root;
    }

    // Binance Book Ticker Format:
    // {
    //   "u":400900217,
    //   "s":"BNBUSDT",
    //   "b":"25.35190000",
    //   "B":"31.21000000",
    //   "a":"25.36520000",
    //   "A":"40.66000000"
    // }

    if (json_data.contains("u")) {
      BookTicker ticker;
      ticker.update_id = json_data["u"].get<long long>();
      ticker.symbol = json_data["s"].get<std::string>();
      ticker.best_bid_price = std::stod(json_data["b"].get<std::string>());
      ticker.best_bid_qty = std::stod(json_data["B"].get<std::string>());
      ticker.best_ask_price = std::stod(json_data["a"].get<std::string>());
      ticker.best_ask_qty = std::stod(json_data["A"].get<std::string>());

      if (callback_) {
        callback_(ticker);
      }
    }
  } catch (const std::exception &e) {
    std::cerr << "JSON Parsing Error: " << e.what() << "\nMessage: " << msg
              << std::endl;
  }

  // Clear the buffer
  buffer_.consume(buffer_.size());

  // Loop
  do_read();
}

} // namespace quant
