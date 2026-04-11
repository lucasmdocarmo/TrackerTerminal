import React, { useState, useEffect, useRef } from 'react';
import { Chart } from './Chart';
import './index.css';

// --- MOCK DATA --- 
// (Before connecting to Python FastAPI WebSockets)
function App() {
  const [time, setTime] = useState(new Date().toLocaleTimeString());
  
  // WebSocket Data States
  const [watchlist, setWatchlist] = useState<any[]>([]);
  const [dom, setDom] = useState<any>({ BTCUSDT: {bids: [], asks: []}, ETHUSDT: {bids: [], asks: []} });
  const [trades, setTrades] = useState<any[]>([]);
  
  // CLI State
  const [activeAsset, setActiveAsset] = useState("BTCUSDT");
  const [cmdInput, setCmdInput] = useState("");
  const omniRef = useRef<HTMLInputElement>(null);

  // Strategy State
  const [activeStrategy, setActiveStrategy] = useState("None");
  const [strategies] = useState(["None", "NaiveMarketMaker", "MomentumTrader", "GridStrategy"]);
  
  // Real-time Chart Array (seeded to prevent library crash on empty)
  const [chartData, setChartData] = useState<{time: number, value: number}[]>([
    { time: Math.floor(Date.now() / 1000) - 100, value: 0 }
  ]);

  // Manual Trade State
  const [manualSide, setManualSide] = useState("BUY");
  const [manualQty, setManualQty] = useState("1.0");
  const [manualPrice, setManualPrice] = useState("");
  const [wsRef, setWsRef] = useState<WebSocket | null>(null);

  // HuggingFace AI Signal State
  const [hfSignal, setHfSignal] = useState<any>(null);
  useEffect(() => {
    const fetchHF = async () => {
        try {
            const res = await fetch("http://localhost:5001/signal");
            const data = await res.json();
            setHfSignal(data);
        } catch(e) {}
    };
    const t = setInterval(fetchHF, 5000);
    fetchHF();
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date().toLocaleTimeString()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    let ws: WebSocket;
    let isMounted = true;
    
    function connect() {
      const socket = new WebSocket("ws://127.0.0.1:8000/stream");
      setWsRef(socket);
      ws = socket;
      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.watchlist) {
             setWatchlist(payload.watchlist);
             // Plot continuous realtime graph for activeAsset
             const assetData = payload.watchlist.find((w: any) => w.symbol === activeAsset);
             if (assetData && assetData.price > 0) {
                 setChartData(prev => {
                     const lastTime = prev[prev.length - 1]?.time || 0;
                     const now = Math.floor(Date.now() / 1000);
                     // Clear chart deeply if pivoting asset context
                     if (prev.length > 5 && prev[prev.length - 1].value > 0) {
                         const variance = Math.abs(prev[prev.length-1].value - assetData.price) / assetData.price;
                         if (variance > 0.1) return [{ time: now, value: assetData.price }];
                     }
                     // Append new historical bars exclusively on exact second rolls
                     if (now > lastTime) {
                         const newData = [...prev, { time: now, value: assetData.price }];
                         return newData.slice(-500);
                     }
                     return prev;
                 });
             }
          }
          if (payload.dom) {
             setDom(payload.dom);
          }
          if (payload.portfolio && payload.portfolio.trades) {
             setTrades(payload.portfolio.trades);
          }
        } catch (err) {
          console.error("Payload breakdown", err);
        }
      };
      
      ws.onclose = () => {
        if (isMounted) {
          setTimeout(connect, 2000); // Auto-reconnect every 2 seconds
        }
      };
    }
    
    connect();

    return () => {
      isMounted = false;
      if (ws) ws.close();
    }
  }, [activeAsset]);

  // Global Keyboard Listener for Omnibox Auto-Focus
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && document.activeElement?.tagName !== 'INPUT') {
          omniRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleCommand = (e: React.FormEvent) => {
      e.preventDefault();
      const tokens = cmdInput.toUpperCase().trim().split(' ');
      if (tokens.length > 0) {
          const mainArg = tokens[0];
          if (mainArg === 'BTCUSDT' || mainArg === 'ETHUSDT') {
              setActiveAsset(mainArg);
              setChartData([{ time: Math.floor(Date.now() / 1000) - 100, value: 0 }]); // flush visual buffer
          } else if (mainArg === 'CLEAR') {
              // reset layout state if we add windowing array logic
          }
      }
      setCmdInput("");
  };

  const activeDom = dom[activeAsset] || { bids: [], asks: [] };
  const currentPrice = watchlist.find(w => w.symbol === activeAsset)?.price || 0;

  return (
    <div className="app-container">
      
      {/* CLI OMNIBOX BAR */}
      <div className="top-bar" style={{ gap: '16px' }}>
        <div style={{ color: 'var(--color-accent)', fontWeight: 'bold' }}>BLOOMBERG <span style={{color: 'white'}}>MOCK</span></div>
        
        <form onSubmit={handleCommand} style={{ flex: 1, display: 'flex' }}>
          <span style={{color: 'var(--color-accent)', alignSelf: 'center', marginRight: '8px'}}>{'>'}</span>
          <input 
             ref={omniRef}
             value={cmdInput}
             onChange={e => setCmdInput(e.target.value.toUpperCase())}
             placeholder={`${activeAsset} <Crypto> DES <GO>`}
             className="mono"
             style={{
                 flex: 1,
                 backgroundColor: 'transparent',
                 border: 'none',
                 color: 'var(--color-accent)',
                 fontSize: '16px',
                 fontWeight: 'bold',
                 outline: 'none'
             }}
          />
        </form>

        <div style={{ color: 'var(--text-muted)' }}>SYS.TIME {time}</div>
      </div>

      {/* WATCHLIST */}
      <div className="panel watchlist-panel">
        <div className="panel-header">
          <span>Watchlist (WL)</span>
          <span>LIVE</span>
        </div>
        <div className="panel-content" style={{ padding: 0 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th className="numeric">Last</th>
                <th className="numeric">Chg%</th>
              </tr>
            </thead>
            <tbody>
              {watchlist.map(w => (
                <tr key={w.symbol}>
                  <td className="mono">{w.symbol.replace('crypto.binance.spot.', '').toUpperCase()}</td>
                  <td className="numeric mono">{w.price ? w.price.toFixed(2) : '-'}</td>
                  <td className={`numeric mono ${w.change >= 0 ? 'up' : 'down'}`}>
                    {w.change > 0 ? '+' : ''}{w.change ? (w.change * 100).toFixed(2) : '0.00'}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* STRATEGY MANAGER (NEW) */}
      <div className="panel strategy-panel">
        <div className="panel-header" style={{ backgroundColor: '#4b0082' }}>
          <span>Strategy Control (ALG)</span>
          <span className={activeStrategy !== "None" ? "up" : "down"}>
            {activeStrategy !== "None" ? "RUNNING" : "STOPPED"}
          </span>
        </div>
        <div className="panel-content" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', color: 'var(--text-muted)', marginBottom: '8px' }} className="mono">ACTIVE STRATEGY_ID:</label>
            <select 
              value={activeStrategy}
              onChange={(e) => setActiveStrategy(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                backgroundColor: 'var(--bg-base)',
                color: 'var(--text-main)',
                border: '1px solid var(--color-accent)',
                fontFamily: 'var(--font-mono)',
                fontSize: '14px',
                fontWeight: 'bold',
                outline: 'none'
              }}
            >
              {strategies.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          
          <div style={{ backgroundColor: 'var(--bg-base)', padding: '12px', border: '1px solid var(--border-dim)' }}>
            <div className="mono" style={{ color: 'var(--text-muted)', fontSize: '11px', marginBottom: '8px' }}>MOCK EXECUTION METRICS</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span>Paper PnL:</span>
              <span className="up mono">+$0.00</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span>Mock Trades:</span>
              <span className="mono">{trades.length}</span>
            </div>
          </div>

          <div style={{ backgroundColor: '#111', padding: '12px', border: '1px solid #4b0082' }}>
            <div className="mono" style={{ color: '#4b0082', fontSize: '11px', marginBottom: '8px', fontWeight: 'bold' }}>AI FORECAST (CHRONOS-T5)</div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Sentiment:</span>
              <span className="mono" style={{ color: hfSignal?.forecast === 'BUY' ? 'var(--color-up)' : 'var(--color-down)', fontWeight: 'bold' }}>
                {hfSignal ? `${hfSignal.forecast} (${(hfSignal.confidence * 100).toFixed(0)}%)` : 'LOADING...'}
              </span>
            </div>
          </div>
          
          <button 
            style={{
              padding: '12px',
              backgroundColor: activeStrategy !== "None" ? 'var(--color-warning)' : 'var(--border-dim)',
              color: 'white',
              border: 'none',
              fontWeight: 'bold',
              fontFamily: 'var(--font-mono)',
              cursor: 'pointer'
            }}
            onClick={() => setActiveStrategy("None")}
          >
            {activeStrategy !== "None" ? "HALT ALG" : "SELECT STRATEGY"}
          </button>

          {/* MANUAL TRADE TICKET */}
          <div style={{ marginTop: '8px', borderTop: '2px solid var(--border-bright)', paddingTop: '16px' }}>
            <div className="mono" style={{ color: 'var(--text-main)', fontSize: '12px', marginBottom: '8px', fontWeight: 'bold' }}>MANUAL EXECUTION [OMON]</div>
            
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
              <select value={manualSide} onChange={e => setManualSide(e.target.value)} style={{ flex: 1, padding: '6px', background: 'var(--bg-panel)', color: 'white', border: `1px solid ${manualSide === 'BUY' ? 'var(--color-up)' : 'var(--color-down)'}`}}>
                <option value="BUY">BUY</option>
                <option value="SELL">SELL</option>
              </select>
              <input type="number" placeholder="Qty" value={manualQty} onChange={e => setManualQty(e.target.value)} style={{ width: '60px', padding: '6px', background: 'var(--bg-base)', border: '1px solid var(--border-dim)', color: 'white' }} />
            </div>
            
            <input type="number" placeholder="Limit Price (Leave empty for Market)" value={manualPrice} onChange={e => setManualPrice(e.target.value)} style={{ width: '100%', padding: '6px', marginBottom: '8px', background: 'var(--bg-base)', border: '1px solid var(--border-dim)', color: 'white' }} />
            
            <button 
              onClick={() => {
                if (wsRef && wsRef.readyState === WebSocket.OPEN) {
                  wsRef.send(JSON.stringify({
                    type: "MANUAL_TRADE",
                    instrument_id: activeAsset,
                    side: manualSide,
                    quantity: parseFloat(manualQty),
                    price: manualPrice ? parseFloat(manualPrice) : currentPrice
                  }));
                }
              }}
              style={{
                width: '100%', padding: '12px', background: manualSide === 'BUY' ? 'var(--color-up)' : 'var(--color-down)',
                color: 'black', border: 'none', fontWeight: 'bold', fontFamily: 'var(--font-mono)', cursor: 'pointer'
              }}
            >
              EXECUTE {manualSide}
            </button>
          </div>

        </div>
      </div>

      {/* MAIN CHART AREA */}
      <div className="panel chart-panel">
        <div className="panel-header">
          <span>[HP] Historical Price</span>
          <span>{activeAsset} LIVE</span>
        </div>
        <div className="panel-content" style={{ padding: 0, overflow: 'hidden' }}>
          <Chart data={chartData} />
        </div>
      </div>

      {/* OPERATIONS MANUAL / HELP */}
      <div className="panel help-panel">
        <div className="panel-header" style={{ backgroundColor: '#111', borderBottom: '2px solid var(--border-bright)', color: 'var(--text-muted)' }}>
          <span>[HELP] Operations Manual</span>
          <span>SYSTEM CHAT</span>
        </div>
        <div className="panel-content mono" style={{ fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ color: 'var(--color-accent)', fontWeight: 'bold', marginBottom: '4px' }}>/// SYSTEM INITIALIZED. WELCOME TO TERMINAL V2.</div>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div style={{ border: '1px solid var(--border-dim)', padding: '8px', backgroundColor: 'var(--bg-base)' }}>
              <div style={{ color: 'white', marginBottom: '4px', fontWeight: 'bold' }}>[1] OMNIBOX CAPTURE</div>
              <div style={{ color: 'var(--text-muted)' }}>You do not need to click to type. Simply press any key to focus the global command line at the top.</div>
            </div>
            
            <div style={{ border: '1px solid var(--border-dim)', padding: '8px', backgroundColor: 'var(--bg-base)' }}>
              <div style={{ color: 'white', marginBottom: '4px', fontWeight: 'bold' }}>[2] CONTEXT SWEEPING</div>
              <div style={{ color: 'var(--text-muted)' }}>Type <span style={{ color: 'var(--color-accent)'}}>BTCUSDT</span> or <span style={{ color: 'var(--color-accent)'}}>ETHUSDT</span> and press <span style={{ color: 'var(--color-accent)'}}>ENTER</span> to sweep the entire dashboard to the new asset.</div>
            </div>
            
            <div style={{ border: '1px solid var(--border-dim)', padding: '8px', backgroundColor: 'var(--bg-base)' }}>
              <div style={{ color: 'white', marginBottom: '4px', fontWeight: 'bold' }}>[3] AI FORECASTING</div>
              <div style={{ color: 'var(--text-muted)' }}>The [ALG] module generates synthetic HuggingFace signals continuously predicting asset movements.</div>
            </div>
            
            <div style={{ border: '1px solid var(--border-dim)', padding: '8px', backgroundColor: 'var(--bg-base)' }}>
              <div style={{ color: 'white', marginBottom: '4px', fontWeight: 'bold' }}>[4] MANUAL EXECUTION</div>
              <div style={{ color: 'var(--text-muted)' }}>The [OMON] ticket directly intercepts the C++ Engine. Click EXECUTE to commit to the TimescaleDB ledger.</div>
            </div>
          </div>
          
          <div style={{ marginTop: 'auto', borderTop: '1px dotted var(--border-dim)', paddingTop: '8px', color: 'var(--text-muted)' }}>
            STATUS: <span className="up">ONLINE</span> | LATENCY: <span className="mono">~12ms</span> | ENGINE: <span className="mono">C++20 OMS</span>
          </div>
        </div>
      </div>

      {/* DEPTH OF MARKET (DOM) */}
      <div className="panel dom-panel">
        <div className="panel-header">
          <span>[MDM] Market Depth</span>
          <span>{activeAsset}</span>
        </div>
        <div className="panel-content" style={{ padding: 0 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th className="numeric">Size</th>
                <th className="numeric">Ask</th>
              </tr>
            </thead>
            <tbody>
              {activeDom.asks.map((a: any, i: number) => (
                <tr key={i}>
                  <td className="numeric mono" style={{ color: 'var(--text-muted)' }}>{a.size.toFixed(3)}</td>
                  <td className="numeric mono down">{a.price.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          
          <div style={{ padding: '8px', textAlign: 'right', fontWeight: 'bold', borderBottom: '1px solid var(--border-dim)', borderTop: '1px solid var(--border-dim)' }} className="mono">
            {currentPrice.toFixed(2)} <span className="up" style={{ fontSize: '10px' }}>SPREAD</span>
          </div>

          <table className="data-table">
            <tbody>
              {activeDom.bids.map((b: any, i: number) => (
                <tr key={i}>
                  <td className="numeric mono" style={{ color: 'var(--text-muted)' }}>{b.size.toFixed(3)}</td>
                  <td className="numeric mono up">{b.price.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* PORTFOLIO / EXECUTION LOG */}
      <div className="panel execution-panel">
        <div className="panel-header">
          <span>[TAPE] Execution Tracker</span>
          <span>FILTER: ALL</span>
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
                  <td className="numeric mono">{t.qty.toFixed(2)}</td>
                  <td className="mono" style={{ color: 'var(--color-warning)' }}>FILLED</td>
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
