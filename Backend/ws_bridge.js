const { WebSocketServer, WebSocket } = require('ws');
const net = require('net');
const { Client } = require('pg');

const pgClient = new Client({
  user: 'postgres',
  host: '127.0.0.1',
  database: 'quant_terminal',
  password: 'password',
  port: 5432,
});

async function initDB() {
    try {
        await pgClient.connect();
        console.log("[Bridge] Connected to TimescaleDB Database");
        await pgClient.query(`
            CREATE TABLE IF NOT EXISTS mock_trades (
                time TIMESTAMPTZ NOT NULL,
                symbol TEXT NOT NULL,
                side TEXT NOT NULL,
                price DOUBLE PRECISION NOT NULL,
                quantity DOUBLE PRECISION NOT NULL
            );
        `);
        try { await pgClient.query(`SELECT create_hypertable('mock_trades', 'time');`); } catch(e){}
        await pgClient.query(`
            CREATE TABLE IF NOT EXISTS portfolio_performance (
                time TIMESTAMPTZ NOT NULL,
                total_value DOUBLE PRECISION NOT NULL
            );
        `);
        try { await pgClient.query(`SELECT create_hypertable('portfolio_performance', 'time');`); } catch(e){}
    } catch(e) {
        console.error("[Bridge] PG connection warning (is docker up?):", e.message);
    }
}
initDB();

// ── State ────────────────────────────────────────────────────────────────────
const wss = new WebSocketServer({ port: 8000 });
let trades = [];

// Side tracking: orderId (from C++) → "BUY"|"SELL"
// We don't know the C++ orderId before it assigns one, so we track the last
// sent side as a single-slot buffer (safe at our 10/s rate limit).
let pendingLastSide = 'BUY';

// Stop-loss orders resting in the bridge
let stopOrders = [];

// Strategy state
let activeStrategy = 'None';
let strategyTimer  = null;
let recentPrices   = [];   // rolling 3-tick buffer for MomentumTrader

// Live market state
let lastWatchlist = [
    { symbol: 'BTCUSDT', price: 0, change: 0 },
    { symbol: 'ETHUSDT', price: 0, change: 0 }
];
let lastDom = {
    BTCUSDT: { bids: [], asks: [] },
    ETHUSDT: { bids: [], asks: [] }
};

// ── PnL Calculation ───────────────────────────────────────────────────────────
function calcPnL() {
    let realizedPnL  = 0;
    let position     = 0;   // net quantity
    let costBasis    = 0;   // cumulative cost of open position

    const snapshot = [...trades].reverse(); // oldest-first FIFO
    for (const t of snapshot) {
        if (!t.qty || t.qty <= 0) continue;
        if (t.side === 'BUY') {
            costBasis += t.price * t.qty;
            position  += t.qty;
        } else {
            const avgCost = position > 0 ? costBasis / position : t.price;
            realizedPnL  += (t.price - avgCost) * t.qty;
            position     -= t.qty;
            costBasis    -= avgCost * t.qty;
            if (position < 0) { position = 0; costBasis = 0; }
        }
    }

    const currentBTC = lastWatchlist.find(w => w.symbol === 'BTCUSDT')?.price || 0;
    const avgCostOpen = position > 0 ? costBasis / position : 0;
    const unrealizedPnL = currentBTC > 0 && position > 0
        ? (currentBTC - avgCostOpen) * position
        : 0;

    return {
        realized:   parseFloat(realizedPnL.toFixed(4)),
        unrealized: parseFloat(unrealizedPnL.toFixed(4)),
        total:      parseFloat((realizedPnL + unrealizedPnL).toFixed(4))
    };
}

// ── Strategy Engine (bridge-side) ─────────────────────────────────────────────
function sendOrderToCpp(symbol, side, price, qty) {
    const msg = JSON.stringify({
        msg_type:      'NewOrderSingle',
        instrument_id: symbol,
        side,
        price:         parseFloat(price.toFixed(2)),
        quantity:      qty
    }) + '\n';
    pendingLastSide = side;
    if (cppSocket && !cppSocket.destroyed) cppSocket.write(msg);
}

function startStrategy(name) {
    activeStrategy = name;
    if (strategyTimer) { clearInterval(strategyTimer); strategyTimer = null; }
    recentPrices = [];
    if (name === 'None') return;

    if (name === 'NaiveMarketMaker') {
        let mmSide = 'BUY';
        strategyTimer = setInterval(() => {
            const btc = lastWatchlist.find(w => w.symbol === 'BTCUSDT');
            if (!btc || btc.price === 0) return;
            const spread = btc.price * 0.001; // 0.1% offset from mid
            const price  = mmSide === 'BUY' ? btc.price - spread : btc.price + spread;
            sendOrderToCpp('BTCUSDT', mmSide, price, 0.001);
            mmSide = mmSide === 'BUY' ? 'SELL' : 'BUY';
        }, 2000);
    }

    if (name === 'MomentumTrader') {
        strategyTimer = setInterval(() => {
            const btc = lastWatchlist.find(w => w.symbol === 'BTCUSDT');
            if (!btc || btc.price === 0) return;
            recentPrices.push(btc.price);
            if (recentPrices.length > 3) recentPrices.shift();
            if (recentPrices.length < 3) return;
            const [p0, p1, p2] = recentPrices;
            if (p2 > p1 && p1 > p0) sendOrderToCpp('BTCUSDT', 'BUY',  btc.price, 0.001);
            if (p2 < p1 && p1 < p0) sendOrderToCpp('BTCUSDT', 'SELL', btc.price, 0.001);
        }, 1000);
    }
}

// ── C++ TCP Connection ────────────────────────────────────────────────────────
const cppSocket = new net.Socket();

cppSocket.on('data', (data) => {
    const msgs = data.toString().trim().split('\n');
    msgs.forEach(msgStr => {
        if (!msgStr) return;
        try {
            const j = JSON.parse(msgStr);
            if (j.msg_type === 'ExecutionReport' && j.executed_quantity > 0) {
                // Use side from C++ broadcast (requires ExecutionServer.hpp fix)
                // Fall back to pendingLastSide if the field is absent
                const side = j.side || pendingLastSide;

                trades.unshift({
                    time:   new Date().toISOString().substring(11, 19),
                    symbol: j.instrument_id,
                    side,
                    price:  j.executed_price,
                    qty:    j.executed_quantity
                });
                if (trades.length > 50) trades.pop();

                pgClient.query(
                    'INSERT INTO mock_trades (time, symbol, side, price, quantity) VALUES (NOW(), $1, $2, $3, $4)',
                    [j.instrument_id, side, j.executed_price, j.executed_quantity]
                ).catch(() => {});
            }
        } catch(e) {}
    });
});

function connectCpp() {
    cppSocket.connect({ port: 9001, host: '127.0.0.1' }, () => {
        console.log('[Bridge] Connected to C++ Backend TCP Server');
    });
}
cppSocket.on('error', () => { setTimeout(connectCpp, 2000); });
connectCpp();

// ── Binance Market Data ───────────────────────────────────────────────────────
console.log('[Bridge] Websocket server started on port 8000');
console.log('[Bridge] Connecting to Binance L2 Streams...');

const streams = 'btcusdt@depth10@100ms/btcusdt@ticker/ethusdt@ticker/ethusdt@depth10@100ms';
const binanceWs = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);

binanceWs.on('message', (msg) => {
    const parsed = JSON.parse(msg.toString());
    if (!parsed.data) return;

    const stream = parsed.stream;
    const data   = parsed.data;

    if (stream.includes('@ticker')) {
        const symbol = data.s; // already "BTCUSDT" / "ETHUSDT"
        const item   = lastWatchlist.find(w => w.symbol === symbol);
        if (item) {
            item.price  = parseFloat(data.c);
            item.change = parseFloat(data.P); // already a percentage e.g. "2.34"
        }

        // ── Stop-loss check ───────────────────────────────────────────────
        const currentPrice = parseFloat(data.c);
        stopOrders = stopOrders.filter(stop => {
            if (stop.symbol !== symbol) return true;
            const hit = (stop.side === 'SELL' && currentPrice <= stop.stopPrice) ||
                        (stop.side === 'BUY'  && currentPrice >= stop.stopPrice);
            if (hit) {
                console.log(`[Bridge] Stop triggered: ${stop.side} ${stop.symbol} @ ${currentPrice} (stop: ${stop.stopPrice})`);
                sendOrderToCpp(stop.symbol, stop.side, currentPrice, stop.quantity);
                return false; // remove
            }
            return true;
        });

    } else if (stream.includes('@depth')) {
        const symbol = stream.split('@')[0].toUpperCase();
        if (lastDom[symbol] && data.bids) {
            lastDom[symbol].bids = data.bids.slice(0, 10).map(b => ({ price: parseFloat(b[0]), size: parseFloat(b[1]) }));
            lastDom[symbol].asks = data.asks.slice(0, 10).map(a => ({ price: parseFloat(a[0]), size: parseFloat(a[1]) }));
        }
    }
});

// ── Broadcast to UI at 10 Hz ──────────────────────────────────────────────────
setInterval(() => {
    const pnl = calcPnL();
    const payload = JSON.stringify({
        watchlist: lastWatchlist,
        dom:       lastDom,
        portfolio: {
            trades,
            pnl,
            activeStrategy,
            stopOrders: stopOrders.map(s => ({
                id: s.id, symbol: s.symbol, side: s.side,
                stopPrice: s.stopPrice, quantity: s.quantity
            }))
        }
    });

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send(payload);
    });
}, 100);

// ── Incoming messages from UI ─────────────────────────────────────────────────
wss.on('connection', (ws) => {
    ws.on('message', (msg) => {
        try {
            const parsed = JSON.parse(msg.toString());

            if (parsed.type === 'STRATEGY_CHANGE') {
                console.log(`[Bridge] Strategy → ${parsed.strategy}`);
                startStrategy(parsed.strategy);
                return;
            }

            if (parsed.type === 'STOP_ORDER') {
                const stop = {
                    id:        `${Date.now()}-${Math.floor(Math.random() * 9999)}`,
                    symbol:    parsed.instrument_id,
                    side:      parsed.side,
                    stopPrice: parsed.stopPrice,
                    quantity:  parsed.quantity
                };
                stopOrders.push(stop);
                console.log(`[Bridge] Stop order registered: ${stop.side} ${stop.symbol} @ ${stop.stopPrice}`);
                return;
            }

            if (parsed.type === 'MANUAL_TRADE') {
                const cppMsg = {
                    msg_type:      'NewOrderSingle',
                    instrument_id: parsed.instrument_id,
                    side:          parsed.side,
                    price:         parsed.price,
                    quantity:      parsed.quantity
                };
                pendingLastSide = parsed.side;
                if (cppSocket && !cppSocket.destroyed) {
                    cppSocket.write(JSON.stringify(cppMsg) + '\n');
                }
            }
        } catch(e) {}
    });
});
