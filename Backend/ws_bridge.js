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

const wss = new WebSocketServer({ port: 8000 });
let trades = [];

// Connect to C++ backend
const cppSocket = new net.Socket();
function connectCpp() {
    cppSocket.connect({ port: 9001, host: '127.0.0.1' }, () => {
        console.log('[Bridge] Connected to C++ Backend TCP Server');
    });
}
cppSocket.on('data', (data) => {
   try {
       const msgs = data.toString().trim().split('\n');
       msgs.forEach(msgStr => {
           if (!msgStr) return;
           const j = JSON.parse(msgStr);
           if (j.msg_type === 'ExecutionReport') {
               trades.unshift({
                   time: new Date().toISOString().substring(11,19),
                   symbol: j.instrument_id,
                   side: "BUY", // Mock
                   price: j.executed_price,
                   qty: j.executed_quantity
               });
               if (trades.length > 50) trades.pop();
               
               // Persist to TimescaleDB
               pgClient.query(
                   'INSERT INTO mock_trades (time, symbol, side, price, quantity) VALUES (NOW(), $1, $2, $3, $4)',
                   [j.instrument_id, "BUY", j.executed_price, j.executed_quantity]
               ).catch(() => {}); // catch silently to prevent crash if db is offline
           }
       });
   } catch(e){}
});
cppSocket.on('error', () => { setTimeout(connectCpp, 2000); });
connectCpp();

console.log('[Bridge] Websocket server started on port 8000');
console.log('[Bridge] Connecting to Binance L2 Streams...');

// Connect to Binance for UI visual data (Combined Stream)
const streams = 'btcusdt@depth10@100ms/btcusdt@ticker/ethusdt@ticker/ethusdt@depth10@100ms';
const binanceWs = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);

let lastWatchlist = [
    { symbol: 'BTCUSDT', price: 0, change: 0 },
    { symbol: 'ETHUSDT', price: 0, change: 0 }
];
let lastDom = { 
    BTCUSDT: { bids: [], asks: [] },
    ETHUSDT: { bids: [], asks: [] }
};

binanceWs.on('message', (msg) => {
    const parsed = JSON.parse(msg.toString());
    if (!parsed.data) return;
    
    const stream = parsed.stream;
    const data = parsed.data;

    if (stream.includes('@ticker')) {
        const item = lastWatchlist.find(w => w.symbol === data.s);
        if (item) {
            item.price = parseFloat(data.c);
            item.change = parseFloat(data.P);
        }
    } else if (stream.includes('@depth')) {
        const symbol = stream.split('@')[0].toUpperCase();
        if (lastDom[symbol] && data.bids) {
            lastDom[symbol].bids = data.bids.slice(0, 10).map(b => ({ price: parseFloat(b[0]), size: parseFloat(b[1]) }));
            lastDom[symbol].asks = data.asks.slice(0, 10).map(a => ({ price: parseFloat(a[0]), size: parseFloat(a[1]) }));
        }
    }
});

// Broadcast 10x a second to UI
setInterval(() => {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
                watchlist: lastWatchlist,
                dom: lastDom,
                portfolio: { trades }
            }));
        }
    });
}, 100);

wss.on('connection', (ws) => {
    ws.on('message', (msg) => {
        try {
            const parsed = JSON.parse(msg.toString());
            let cppMsg = parsed;
            if (parsed.type === "MANUAL_TRADE") {
                 cppMsg = {
                     msg_type: "NewOrderSingle",
                     instrument_id: parsed.instrument_id,
                     side: parsed.side,
                     price: parsed.price,
                     quantity: parsed.quantity
                 };
            }
            if (cppSocket && !cppSocket.destroyed) {
                cppSocket.write(JSON.stringify(cppMsg) + '\n');
            }
        } catch(e) {}
    });
});
