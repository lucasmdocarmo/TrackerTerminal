# TrackerTerminal

A high-performance mock trading terminal mimicking the visual aesthetics and features of a Bloomberg Terminal.

## Architecture

- **Backend (C++)**: An ultra-low latency matching engine Simulator executing mock strategies via a real-time order book.
- **FrontEnd (React)**: A Vite-driven UI providing the Bloomberg neon-amber user interface, grid layout, and DOM charts.
- **Database (TimescaleDB)**: Highly optimized time-series logging for market ticks and execution reports (via Docker).

## Prerequisites

- **Docker** and **Docker Compose**
- **C++ Build Tools**:
  - `brew install cmake boost openssl nlohmann-json`
- **Node.js**: v18+

## How to Run the Project

### Phase 1: Environment Setup

Before you start the project for the first time, ensure your machine has the required build and execution dependencies:

1.  **Install Docker Desktop:** (Required for TimescaleDB) Download and launch it from [Docker's website](https://www.docker.com/products/docker-desktop).
2.  **Install Node.js & npm:** (Required for the React FrontEnd) Install via Homebrew: `brew install node`.
3.  **Install C++ Build Tools:** (Required for the Backend Engine)
    ```bash
    brew install cmake boost openssl nlohmann-json
    ```

### Phase 2: Launching

We have an orchestrator script (`run.sh`) that manages all 3 disconnected systems for you.

1. Give the script execution permission (from the root folder):
   ```bash
   chmod +x run.sh
   ```

2. Execute the environment:
   ```bash
   ./run.sh
   ```

**What happens when you run `./run.sh`?**
1.  **Docker** provisions the TimescaleDB container bridging port `5432`.
2.  **Node/Vite** boots the Bloomberg React UI server in the background natively.
3.  **CMake/C++** compiles `backend_quant_terminal` and starts the OrderBook in the foreground.

### Phase 3: Access the Terminal

Once the C++ logs show `System Running.` in your terminal:
*   Open your web browser.
*   Navigate to: [http://localhost:5173](http://localhost:5173)
*   You will see the fully functional Bloomberg terminal aesthetic!
*   _Note: Press `Ctrl+C` in your terminal to cleanly shut down both the UI and the Backend._

### Components

*   `Backend/`: Contains the C++ execution engine and TimescaleDB `docker-compose.yml`.
*   `FrontEnd/`: Contains the Vite + React workspace for the UI.
