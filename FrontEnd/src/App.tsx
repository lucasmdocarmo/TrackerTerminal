import React, { useState, useEffect, useRef } from 'react';
import { Chart } from './Chart';
import type { CandleData } from './Chart';
import './index.css';

// ── Types ─────────────────────────────────────────────────────────────────────
interface WatchlistItem { symbol: string; price: number; change: number; }
interface DomLevel      { price: number; size: number; }
interface DomState      { bids: DomLevel[]; asks: DomLevel[]; }
interface Trade         { time: string; symbol: string; side: string; price: number; qty: number; }
interface PnL           { realized: number; unrealized: number; total: number; }
interface StopOrder     { id: string; symbol: string; side: string; stopPrice: number; quantity: number; }
interface Position {
  id:           string;
  symbol:       string;
  direction:    'LONG' | 'SHORT';
  entryPrice:   number;
  qty:          number;
  stopLoss:     number | null;
  unrealizedPnL: number;
}

type Direction = 'LONG' | 'SHORT';
type OrderTab  = 'MARKET' | 'LIMIT' | 'STOP';

const STRATEGIES = ['None', 'NaiveMarketMaker', 'MomentumTrader'] as const;

// ── Component ─────────────────────────────────────────────────────────────────
function App() {
  const [time, setTime] = useState(new Date().toLocaleTimeString());

  // Market data
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [dom,       setDom]       = useState<Record<string, DomState>>({
    BTCUSDT: { bids: [], asks: [] },
    ETHUSDT: { bids: [], asks: [] },
  });
  const [trades, setTrades] = useState<Trade[]>([]);

  // Portfolio / PnL
  const [pnl,        setPnl]        = useState<PnL>({ realized: 0, unrealized: 0, total: 0 });
  const [positions,  setPositions]  = useState<Position[]>([]);
  const [stopOrders, setStopOrders] = useState<StopOrder[]>([]);

  // Candlestick chart
  const currentCandleRef = useRef<CandleData | null>(null);
  const [candleData,  setCandleData]  = useState<CandleData[]>([]);
  const [liveCandle,  setLiveCandle]  = useState<CandleData | undefined>(undefined);

  // CLI / context
  const [activeAsset,     setActiveAsset]     = useState('BTCUSDT');
  const [cmdInput,        setCmdInput]        = useState('');
  const omniRef = useRef<HTMLInputElement>(null);

  // Strategy
  const [activeStrategy, setActiveStrategy] = useState('None');
  const [bridgeStrategy, setBridgeStrategy] = useState('None'); // confirmed by bridge

  // OMON ticket
  const [direction,  setDirection]  = useState<Direction>('LONG');
  const [orderTab,   setOrderTab]   = useState<OrderTab>('MARKET');
  const [manualQty,  setManualQty]  = useState('0.01');
  const [manualPrice, setManualPrice] = useState('');
  const [stopPrice,  setStopPrice]  = useState('');

  const wsRef = useRef<WebSocket | null>(null);

  // HuggingFace AI signal
  const [hfSignal, setHfSignal] = useState<{ forecast: string; confidence: number } | null>(null);
  useEffect(() => {
    const fetch_ = async () => {
      try {
        const res  = await fetch('http://localhost:5001/signal');
        const data = await res.json();
        setHfSignal(data);
      } catch (_) {}
    };
    const t = setInterval(fetch_, 5000);
    fetch_();
    return () => clearInterval(t);
  }, []);

  // Clock
  useEffect(() => {
    const t = setInterval(() => setTime(new Date().toLocaleTimeString()), 1000);
    return () => clearInterval(t);
  }, []);

  // WebSocket connection
  useEffect(() => {
    let ws: WebSocket;
    let alive = true;

    function connect() {
      ws = new WebSocket('ws://127.0.0.1:8000/stream');
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);

          // ── Watchlist + candle aggregation ──────────────────────────────
          if (payload.watchlist) {
            setWatchlist(payload.watchlist);

            const assetRow = payload.watchlist.find((w: WatchlistItem) => w.symbol === activeAsset);
            if (assetRow && assetRow.price > 0) {
              const price     = assetRow.price;
              const nowSec    = Math.floor(Date.now() / 1000);

              const ref = currentCandleRef.current;
              if (!ref || ref.time !== nowSec) {
                // Second boundary — finalize old candle, start new one
                const newCandle: CandleData = { time: nowSec, open: price, high: price, low: price, close: price };
                currentCandleRef.current = newCandle;

                if (ref && ref.open !== 0) {
                  // Push completed candle into history
                  setCandleData(prev => [...prev.slice(-499), { ...ref }]);
                }
              } else {
                // Same second — update running candle
                ref.high  = Math.max(ref.high,  price);
                ref.low   = Math.min(ref.low,   price);
                ref.close = price;
              }

              // Always push live candle for real-time wick rendering
              if (currentCandleRef.current && currentCandleRef.current.open !== 0) {
                setLiveCandle({ ...currentCandleRef.current });
              }

              // Update unrealized PnL on open positions
              setPositions(prev => prev.map(p => {
                const diff = p.direction === 'LONG'
                  ? (price - p.entryPrice) * p.qty
                  : (p.entryPrice - price) * p.qty;
                return { ...p, unrealizedPnL: parseFloat(diff.toFixed(4)) };
              }));
            }
          }

          if (payload.dom) setDom(payload.dom);

          if (payload.portfolio) {
            if (payload.portfolio.trades)        setTrades(payload.portfolio.trades);
            if (payload.portfolio.pnl)           setPnl(payload.portfolio.pnl);
            if (payload.portfolio.stopOrders)    setStopOrders(payload.portfolio.stopOrders);
            if (payload.portfolio.activeStrategy) setBridgeStrategy(payload.portfolio.activeStrategy);
          }
        } catch (_) {}
      };

      ws.onclose = () => { if (alive) setTimeout(connect, 2000); };
    }

    connect();
    return () => { alive = false; if (ws) ws.close(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAsset]);

  // Global keypress → focus omnibox
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && document.activeElement?.tagName !== 'INPUT') {
        omniRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── Handlers ────────────────────────────────────────────────────────────────
  const handleCommand = (e: React.FormEvent) => {
    e.preventDefault();
    const token = cmdInput.toUpperCase().trim();
    if (token === 'BTCUSDT' || token === 'ETHUSDT') {
      setActiveAsset(token);
      currentCandleRef.current = null;
      setCandleData([]);
      setLiveCandle(undefined);
    }
    setCmdInput('');
  };

  const handleStrategyChange = (name: string) => {
    setActiveStrategy(name);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'STRATEGY_CHANGE', strategy: name }));
    }
  };

  const handleExecute = () => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const side = direction === 'LONG' ? 'BUY' : 'SELL';
    const qty  = parseFloat(manualQty);
    if (!qty || qty <= 0) return;

    if (orderTab === 'STOP') {
      const sp = parseFloat(stopPrice);
      if (!sp || sp <= 0) return;
      ws.send(JSON.stringify({
        type:          'STOP_ORDER',
        instrument_id: activeAsset,
        side,
        stopPrice:     sp,
        quantity:      qty,
      }));
    } else {
      const price = orderTab === 'LIMIT' ? parseFloat(manualPrice) : currentPrice;
      if (!price || price <= 0) return;
      ws.send(JSON.stringify({
        type:          'MANUAL_TRADE',
        instrument_id: activeAsset,
        side,
        quantity:      qty,
        price,
      }));
      // Open position locally (optimistic — assumes fill)
      setPositions(prev => [...prev, {
        id:            Date.now().toString(),
        symbol:        activeAsset,
        direction,
        entryPrice:    price,
        qty,
        stopLoss:      stopPrice ? parseFloat(stopPrice) : null,
        unrealizedPnL: 0,
      }]);
    }
  };

  const closePosition = (id: string) => setPositions(prev => prev.filter(p => p.id !== id));

  // ── Derived values ──────────────────────────────────────────────────────────
  const activeDom    = dom[activeAsset] || { bids: [], asks: [] };
  const currentPrice = watchlist.find(w => w.symbol === activeAsset)?.price || 0;
  const pnlColor     = pnl.total >= 0 ? 'var(--color-up)' : 'var(--color-down)';
  const execBtnClass = orderTab === 'STOP' ? 'execute-btn execute-btn--stop'
    : direction === 'LONG' ? 'execute-btn execute-btn--long' : 'execute-btn execute-btn--short';
  const execBtnLabel = orderTab === 'STOP'
    ? `SET STOP ${direction}`
    : `EXECUTE ${direction}`;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="app-container">

      {/* ── TOP BAR ─────────────────────────────────────────────────────── */}
      <div className="top-bar">
        <div style={{ color: 'var(--color-accent)', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
          BLOOMBERG <span style={{ color: 'white' }}>MOCK</span>
        </div>
        <form onSubmit={handleCommand} style={{ flex: 1, display: 'flex' }}>
          <span style={{ color: 'var(--color-accent)', alignSelf: 'center', marginRight: '8px' }}>{'>'}</span>
          <input
            ref={omniRef}
            value={cmdInput}
            onChange={e => setCmdInput(e.target.value.toUpperCase())}
            placeholder={`${activeAsset}  <BTCUSDT|ETHUSDT>  <GO>`}
            className="mono"
            style={{
              flex: 1, backgroundColor: 'transparent', border: 'none',
              color: 'var(--color-accent)', fontSize: '14px', fontWeight: 'bold', outline: 'none',
            }}
          />
        </form>
        <div style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>SYS.TIME {time}</div>
      </div>

      {/* ── WATCHLIST ───────────────────────────────────────────────────── */}
      <div className="panel watchlist-panel">
        <div className="panel-header">
          <span>Watchlist (WL)</span>
          <span style={{ color: 'var(--color-up)' }}>LIVE</span>
        </div>
        <div className="panel-content" style={{ padding: 0 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: '96px', minWidth: '96px' }}>Symbol</th>
                <th className="numeric" style={{ width: '80px' }}>Last</th>
                <th className="numeric">Chg%</th>
              </tr>
            </thead>
            <tbody>
              {watchlist.map(w => (
                <tr
                  key={w.symbol}
                  style={{ cursor: 'pointer' }}
                  onClick={() => {
                    setActiveAsset(w.symbol);
                    currentCandleRef.current = null;
                    setCandleData([]);
                    setLiveCandle(undefined);
                  }}
                >
                  <td className="mono" style={{ color: w.symbol === activeAsset ? 'var(--color-accent)' : '' }}>
                    {w.symbol}
                  </td>
                  <td className="numeric mono">{w.price ? w.price.toFixed(2) : '—'}</td>
                  <td className={`numeric mono ${(w.change ?? 0) >= 0 ? 'up' : 'down'}`}>
                    {(w.change ?? 0) > 0 ? '+' : ''}{(w.change ?? 0).toFixed(2)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── STRATEGY CONTROL ────────────────────────────────────────────── */}
      <div className="panel strategy-panel">
        <div className="panel-header" style={{ backgroundColor: '#1a0035', borderBottomColor: '#7b00ff' }}>
          <span>Strategy Control (ALG)</span>
          <span className={bridgeStrategy !== 'None' ? 'up' : 'down'}>
            {bridgeStrategy !== 'None' ? 'RUNNING' : 'STOPPED'}
          </span>
        </div>
        <div className="panel-content" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>

          {/* Strategy selector */}
          <div>
            <label className="mono" style={{ display: 'block', color: 'var(--text-muted)', marginBottom: '6px', fontSize: '11px' }}>
              ACTIVE STRATEGY_ID:
            </label>
            <select
              value={activeStrategy}
              onChange={e => handleStrategyChange(e.target.value)}
              style={{
                width: '100%', padding: '6px',
                backgroundColor: 'var(--bg-base)', color: 'var(--text-main)',
                border: '1px solid var(--color-accent)',
                fontFamily: 'var(--font-mono)', fontSize: '13px', fontWeight: 'bold', outline: 'none',
              }}
            >
              {STRATEGIES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {/* Execution metrics */}
          <div style={{ backgroundColor: 'var(--bg-base)', padding: '10px', border: '1px solid var(--border-dim)' }}>
            <div className="mono" style={{ color: 'var(--text-muted)', fontSize: '10px', marginBottom: '6px' }}>EXECUTION METRICS</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span style={{ color: 'var(--text-muted)' }}>Realized P&L:</span>
              <span className="mono" style={{ color: pnl.realized >= 0 ? 'var(--color-up)' : 'var(--color-down)' }}>
                {pnl.realized >= 0 ? '+' : ''}${pnl.realized.toFixed(2)}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span style={{ color: 'var(--text-muted)' }}>Unrealized:</span>
              <span className="mono" style={{ color: pnl.unrealized >= 0 ? 'var(--color-up)' : 'var(--color-down)' }}>
                {pnl.unrealized >= 0 ? '+' : ''}${pnl.unrealized.toFixed(2)}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dotted var(--border-dim)', paddingTop: '4px' }}>
              <span style={{ fontWeight: 'bold' }}>Total P&L:</span>
              <span className="mono" style={{ color: pnlColor, fontWeight: 'bold' }}>
                {pnl.total >= 0 ? '+' : ''}${pnl.total.toFixed(2)}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
              <span style={{ color: 'var(--text-muted)' }}>Fills:</span>
              <span className="mono">{trades.length}</span>
            </div>
          </div>

          {/* AI Forecast */}
          <div style={{ backgroundColor: '#111', padding: '10px', border: '1px solid #4b0082' }}>
            <div className="mono" style={{ color: '#9b59b6', fontSize: '10px', marginBottom: '6px', fontWeight: 'bold' }}>
              AI FORECAST (CHRONOS-T5)
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Signal:</span>
              <span className="mono" style={{
                color: hfSignal?.forecast === 'BUY' ? 'var(--color-up)' : 'var(--color-down)',
                fontWeight: 'bold',
              }}>
                {hfSignal ? `${hfSignal.forecast} (${(hfSignal.confidence * 100).toFixed(0)}%)` : 'CONNECTING...'}
              </span>
            </div>
          </div>

          {/* Active stop orders */}
          {stopOrders.length > 0 && (
            <div style={{ backgroundColor: '#0a0008', padding: '8px', border: '1px solid var(--color-warning)' }}>
              <div className="mono" style={{ color: 'var(--color-warning)', fontSize: '10px', marginBottom: '4px', fontWeight: 'bold' }}>
                ACTIVE STOPS ({stopOrders.length})
              </div>
              {stopOrders.slice(0, 3).map(s => (
                <div key={s.id} className="mono" style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '2px' }}>
                  {s.side} {s.symbol} @ {s.stopPrice.toFixed(2)} × {s.quantity}
                </div>
              ))}
            </div>
          )}

          {/* Halt button */}
          {activeStrategy !== 'None' && (
            <button
              onClick={() => handleStrategyChange('None')}
              style={{
                padding: '8px', backgroundColor: '#3d0000', color: 'var(--color-down)',
                border: '1px solid var(--color-down)', fontWeight: 'bold',
                fontFamily: 'var(--font-mono)', cursor: 'pointer', fontSize: '12px',
              }}
            >
              ■ HALT ALGORITHM
            </button>
          )}
        </div>
      </div>

      {/* ── CHART ───────────────────────────────────────────────────────── */}
      <div className="panel chart-panel">
        <div className="panel-header">
          <span>[HP] Historical Price — Candlestick 1s</span>
          <span style={{ color: 'var(--color-accent)' }}>{activeAsset} LIVE  {currentPrice > 0 ? currentPrice.toFixed(2) : '—'}</span>
        </div>
        <div className="panel-content" style={{ padding: 0, overflow: 'hidden' }}>
          <Chart data={candleData} liveCandle={liveCandle} />
        </div>
      </div>

      {/* ── OPEN POSITIONS ──────────────────────────────────────────────── */}
      <div className="panel positions-panel">
        <div className="panel-header">
          <span>[POS] Open Positions</span>
          <span style={{ color: pnlColor, fontFamily: 'var(--font-mono)' }}>
            TOTAL P&L: {pnl.total >= 0 ? '+' : ''}${pnl.total.toFixed(2)}
          </span>
        </div>
        <div className="panel-content" style={{ padding: 0 }}>
          {positions.length === 0 ? (
            <div style={{ padding: '12px 8px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
              NO OPEN POSITIONS — USE [OMON] TO ENTER A TRADE
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Dir</th>
                  <th className="numeric">Entry</th>
                  <th className="numeric">Qty</th>
                  <th className="numeric">Stop</th>
                  <th className="numeric">Unr.PnL</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {positions.map(p => (
                  <tr key={p.id}>
                    <td className="mono">{p.symbol}</td>
                    <td className={`mono ${p.direction === 'LONG' ? 'up' : 'down'}`}>{p.direction}</td>
                    <td className="numeric mono">{p.entryPrice.toFixed(2)}</td>
                    <td className="numeric mono">{p.qty.toFixed(4)}</td>
                    <td className="numeric mono" style={{ color: 'var(--color-warning)' }}>
                      {p.stopLoss ? p.stopLoss.toFixed(2) : '—'}
                    </td>
                    <td className={`numeric mono ${p.unrealizedPnL >= 0 ? 'up' : 'down'}`}>
                      {p.unrealizedPnL >= 0 ? '+' : ''}${p.unrealizedPnL.toFixed(2)}
                    </td>
                    <td>
                      <button
                        onClick={() => closePosition(p.id)}
                        style={{
                          background: 'none', border: 'none', color: 'var(--text-muted)',
                          cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: '11px',
                        }}
                      >✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── DEPTH OF MARKET ─────────────────────────────────────────────── */}
      <div className="panel dom-panel">
        <div className="panel-header">
          <span>[MDM] Market Depth</span>
          <span>{activeAsset}</span>
        </div>
        <div className="panel-content" style={{ padding: 0, display: 'flex', flexDirection: 'column' }}>
          {/* Asks — scrollable top half */}
          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            <table className="data-table">
              <thead>
                <tr><th className="numeric">Size</th><th className="numeric">Ask</th></tr>
              </thead>
              <tbody>
                {activeDom.asks.slice().reverse().map((a, i) => (
                  <tr key={i}>
                    <td className="numeric mono" style={{ color: 'var(--text-muted)' }}>{a.size.toFixed(3)}</td>
                    <td className="numeric mono down">{a.price.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Price separator */}
          <div style={{
            padding: '5px 8px', textAlign: 'right', fontWeight: 'bold', flexShrink: 0,
            borderTop: '1px solid var(--border-dim)', borderBottom: '1px solid var(--border-dim)',
            fontFamily: 'var(--font-mono)', fontSize: '14px', color: 'var(--color-accent)',
          }}>
            {currentPrice > 0 ? currentPrice.toFixed(2) : '—'}
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginLeft: '6px' }}>LAST</span>
          </div>

          {/* Bids — scrollable bottom half */}
          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            <table className="data-table">
              <thead>
                <tr><th className="numeric">Size</th><th className="numeric">Bid</th></tr>
              </thead>
              <tbody>
                {activeDom.bids.map((b, i) => (
                  <tr key={i}>
                    <td className="numeric mono" style={{ color: 'var(--text-muted)' }}>{b.size.toFixed(3)}</td>
                    <td className="numeric mono up">{b.price.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── OMON TRADE TICKET ───────────────────────────────────────────── */}
      <div className="panel omon-panel">
        <div className="panel-header" style={{ backgroundColor: '#001a00', borderBottomColor: 'var(--color-up)' }}>
          <span>[OMON] Order Management</span>
          <span style={{ color: 'var(--text-muted)' }}>{activeAsset}</span>
        </div>
        <div className="panel-content" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>

          {/* LONG / SHORT */}
          <div className="direction-btn-group">
            <button
              className={`direction-btn ${direction === 'LONG' ? 'direction-btn--active-long' : ''}`}
              onClick={() => setDirection('LONG')}
            >▲ LONG</button>
            <button
              className={`direction-btn ${direction === 'SHORT' ? 'direction-btn--active-short' : ''}`}
              onClick={() => setDirection('SHORT')}
            >▼ SHORT</button>
          </div>

          {/* Order type tabs */}
          <div className="order-tab-group">
            {(['MARKET', 'LIMIT', 'STOP'] as const).map(tab => (
              <button
                key={tab}
                className={`order-tab ${orderTab === tab ? 'order-tab--active' : ''}`}
                onClick={() => setOrderTab(tab)}
              >{tab}</button>
            ))}
          </div>

          {/* Quantity */}
          <input
            type="number"
            placeholder="Quantity"
            value={manualQty}
            onChange={e => setManualQty(e.target.value)}
            className="omon-input"
          />

          {/* Limit price */}
          {orderTab === 'LIMIT' && (
            <input
              type="number"
              placeholder="Limit Price"
              value={manualPrice}
              onChange={e => setManualPrice(e.target.value)}
              className="omon-input"
            />
          )}

          {/* Stop price */}
          {(orderTab === 'STOP') && (
            <input
              type="number"
              placeholder="Stop Trigger Price"
              value={stopPrice}
              onChange={e => setStopPrice(e.target.value)}
              className="omon-input omon-input--stop"
            />
          )}

          {/* Market price reference */}
          <div className="mono" style={{ fontSize: '11px', color: 'var(--text-muted)', textAlign: 'right' }}>
            MKT: <span style={{ color: 'var(--color-accent)' }}>{currentPrice > 0 ? currentPrice.toFixed(2) : '—'}</span>
          </div>

          {/* Execute */}
          <button className={execBtnClass} onClick={handleExecute}>
            {execBtnLabel}
          </button>
        </div>
      </div>

      {/* ── EXECUTION TAPE ──────────────────────────────────────────────── */}
      <div className="panel execution-panel">
        <div className="panel-header">
          <span>[TAPE] Execution Tracker</span>
          <span style={{ color: 'var(--text-muted)' }}>FILTER: ALL  |  FILLS: {trades.length}</span>
        </div>
        <div className="panel-content" style={{ padding: 0 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Time (UTC)</th>
                <th>Instrument</th>
                <th>Side</th>
                <th className="numeric">Price</th>
                <th className="numeric">Quantity</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t, i) => (
                <tr key={i}>
                  <td className="mono" style={{ color: 'var(--text-muted)' }}>{t.time}</td>
                  <td className="mono">{t.symbol}</td>
                  <td className={`mono ${t.side === 'BUY' ? 'up' : 'down'}`}>{t.side}</td>
                  <td className="numeric mono">{t.price.toFixed(2)}</td>
                  <td className="numeric mono">{t.qty.toFixed(4)}</td>
                  <td className="mono" style={{ color: 'var(--color-up)' }}>FILLED</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}

export default App;
