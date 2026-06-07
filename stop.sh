#!/bin/bash
export PATH="/opt/homebrew/bin:$PATH"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

echo -e "${RED}Stopping TrackerTerminal...${NC}"

# Kill by saved PIDs if available
if [ -f /tmp/tracker_pids ]; then
    read -r PIDS < /tmp/tracker_pids
    kill $PIDS 2>/dev/null
    rm -f /tmp/tracker_pids
fi

# Kill by process name as fallback
pkill -f "backend_quant_terminal" 2>/dev/null
pkill -f "ws_bridge.js"           2>/dev/null
pkill -f "hf_alpha.py"            2>/dev/null
pkill -f "vite"                   2>/dev/null

# Stop Docker containers
cd "$(dirname "$0")/Backend" && docker compose down 2>/dev/null

echo -e "${GREEN}All services stopped.${NC}"
