#!/bin/bash
export PATH="/opt/homebrew/bin:$PATH"

# Ensure script halts on errors
set -e

# Colors for terminal styling
GREEN='\033[0;32m'
AMBER='\033[0;33m'
NC='\033[0m' # No Color

echo -e "${AMBER}[1/3] Starting Database layer (TimescaleDB & MongoDB)...${NC}"
cd Backend
docker compose up -d
cd ..

echo -e "${AMBER}[2/3] Preparing FrontEnd ( Vite/React )...${NC}"
cd FrontEnd
npm install
# Start frontend in the background
npm run dev &
FRONTEND_PID=$!
cd ..

echo -e "${AMBER}[3/5] Starting the Node WebSocket Bridge...${NC}"
cd Backend
# Check if ws_bridge exists
if [ -f "ws_bridge.js" ]; then
    node ws_bridge.js &
    BRIDGE_PID=$!
fi

echo -e "${AMBER}[4/5] Starting HuggingFace AI Alpha Server...${NC}"
if command -v python3 &> /dev/null; then
    python3 hf_alpha.py &
    HF_PID=$!
fi
cd ..

echo -e "${AMBER}[5/5] Compiling and Launching C++ Backend Engine...${NC}"
cd Backend
if ! command -v cmake &> /dev/null; then
    echo -e "CMake not found! Please install using: 'brew install cmake boost openssl nlohmann-json'"
    # We exit here so the user realizes why backend didn't start. Note we don't kill frontend yet.
    exit 1
fi

mkdir -p build
cd build
cmake ..
make

echo -e "${GREEN}All services launched. FrontEnd should run on localhost:5173${NC}"
echo -e "${GREEN}Running Backend Engine... Press Ctrl+C or run ./stop.sh to stop all.${NC}"

# Save PIDs for stop.sh
echo "$FRONTEND_PID $BRIDGE_PID $HF_PID" > /tmp/tracker_pids

stop_all() {
    echo "Stopping servers..."
    kill $FRONTEND_PID $BRIDGE_PID $HF_PID 2>/dev/null
    pkill -f "backend_quant_terminal" 2>/dev/null
    pkill -f "ws_bridge.js"           2>/dev/null
    pkill -f "hf_alpha.py"            2>/dev/null
    pkill -f "vite"                   2>/dev/null
    cd "$(dirname "$0")/Backend" && docker compose down 2>/dev/null
    rm -f /tmp/tracker_pids
    echo "All services stopped."
    exit 0
}

trap stop_all SIGINT SIGTERM

# Execute backend on the main thread so user sees logs
./backend_quant_terminal
