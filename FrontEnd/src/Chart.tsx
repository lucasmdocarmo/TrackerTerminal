import React, { useEffect, useRef } from 'react';
import { createChart, ColorType, CandlestickSeries } from 'lightweight-charts';

export interface CandleData {
  time:  number;
  open:  number;
  high:  number;
  low:   number;
  close: number;
}

interface ChartProps {
  data:        CandleData[];
  liveCandle?: CandleData;
}

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: unknown }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: unknown) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ color: 'red', margin: '20px', fontFamily: 'monospace' }}>
          CHART ERROR: {String(this.state.error)}
        </div>
      );
    }
    return this.props.children;
  }
}

const ChartCore: React.FC<ChartProps> = ({ data, liveCandle }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<ReturnType<typeof createChart> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seriesRef    = useRef<any>(null);

  // Mount once — create chart and candlestick series
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor:  '#888888',
      },
      grid: {
        vertLines: { color: 'rgba(255,153,0,0.05)' },
        horzLines: { color: 'rgba(255,153,0,0.05)' },
      },
      timeScale: {
        timeVisible:    true,
        secondsVisible: true,
        borderColor:    '#2a2a2a',
      },
      rightPriceScale: { borderColor: '#2a2a2a' },
      crosshair: {
        vertLine: { color: '#ffb732', labelBackgroundColor: '#000080' },
        horzLine: { color: '#ffb732', labelBackgroundColor: '#000080' },
      },
      width:  containerRef.current.clientWidth,
      height: containerRef.current.clientHeight || 340,
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor:         '#ffb732', // amber
      downColor:       '#ff3333', // red
      borderUpColor:   '#ffb732',
      borderDownColor: '#ff3333',
      wickUpColor:     '#ffb732',
      wickDownColor:   '#ff3333',
    });

    chartRef.current  = chart;
    seriesRef.current = series;

    const onResize = () => {
      if (containerRef.current) {
        chart.applyOptions({
          width:  containerRef.current.clientWidth,
          height: containerRef.current.clientHeight || 340,
        });
      }
    };
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      chart.remove();
      chartRef.current  = null;
      seriesRef.current = null;
    };
  }, []);

  // When a completed candle is pushed, reload the full dataset
  useEffect(() => {
    if (!seriesRef.current || data.length === 0) return;
    try {
      seriesRef.current.setData(data);
      chartRef.current?.timeScale().scrollToRealTime();
    } catch (_) { /* ignore stale updates */ }
  }, [data]);

  // Update the live (in-progress) candle on every tick at 10 Hz
  useEffect(() => {
    if (!seriesRef.current || !liveCandle || liveCandle.open === 0) return;
    try {
      seriesRef.current.update(liveCandle);
    } catch (_) { /* ignore stale updates */ }
  }, [liveCandle]);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', minHeight: '280px' }}
    />
  );
};

export const Chart: React.FC<ChartProps> = (props) => (
  <ErrorBoundary>
    <ChartCore {...props} />
  </ErrorBoundary>
);
