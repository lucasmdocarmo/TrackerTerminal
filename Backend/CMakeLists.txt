cmake_minimum_required(VERSION 3.15)
project(BackendQuantTerminal VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# Find Dependencies
find_package(OpenSSL REQUIRED)
set(Boost_USE_STATIC_LIBS OFF)
set(Boost_USE_MULTITHREADED ON)
set(Boost_USE_STATIC_RUNTIME OFF)
set(Boost_NO_BOOST_CMAKE ON)
find_package(Boost REQUIRED COMPONENTS thread)
include_directories(${Boost_INCLUDE_DIRS})

# Check for nlohmann_json
find_package(nlohmann_json QUIET)
if (NOT nlohmann_json_FOUND)
    message(STATUS "nlohmann_json not found, attempting to use FetchContent...")
    include(FetchContent)
    FetchContent_Declare(json URL https://github.com/nlohmann/json/releases/download/v3.11.2/json.tar.xz)
    FetchContent_MakeAvailable(json)
endif()

# Includes
include_directories(include)

# Executable
add_executable(backend_quant_terminal 
    src/main.cpp
    src/market_data/BinanceMarketData.cpp
    src/OrderGateway.cpp
)
target_link_libraries(backend_quant_terminal PRIVATE 
    OpenSSL::SSL 
    OpenSSL::Crypto 
    Boost::thread
    nlohmann_json::nlohmann_json
)

# Compiler warnings
if(MSVC)
    target_compile_options(backend_quant_terminal PRIVATE /W4)
else()
    target_compile_options(backend_quant_terminal PRIVATE -Wall -Wextra -Wpedantic)
endif()
