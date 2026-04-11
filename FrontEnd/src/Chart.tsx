import React, { useEffect, useRef } from 'react';
import { createChart, ColorType, LineSeries } from 'lightweight-charts';

interface ChartProps {
  data: any[];
}

class ErrorBoundary extends React.Component<{children: any}, {hasError: boolean, error: any}> {
  constructor(props: any) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error: any) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) {
      return <div style={{ color: 'red', margin: '20px', fontFamily: 'monospace' }}>CHART CRASHED: {this.state.error?.message}</div>;
    }
    return this.props.children; 
  }
}

const ChartCore: React.FC<ChartProps> = ({ data }) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<any>(null);
  const seriesRef = useRef<any>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    try {
        const chart = createChart(chartContainerRef.current, {
          layout: {
            background: { type: ColorType.Solid, color: "transparent" },
            textColor: "#6c7784",
          },
          grid: {
            vertLines: { color: "rgba(255,255,255,0.02)" },
            horzLines: { color: "rgba(255,255,255,0.02)" },
          },
          timeScale: {
            timeVisible: true,
            secondsVisible: true,
          },
          width: chartContainerRef.current.clientWidth,
          height: 340,
        });
        
        chart.timeScale().fitContent();

        const newSeries = chart.addSeries(LineSeries, { 
          color: '#4a90e2',
          lineWidth: 2,
        });
        
        if (data && data.length > 0) {
            newSeries.setData(data);
        }

        chartInstanceRef.current = chart;
        seriesRef.current = newSeries;

        const handleResize = () => {
          if (chartContainerRef.current) {
            chart.applyOptions({ width: chartContainerRef.current.clientWidth });
          }
        };
        window.addEventListener('resize', handleResize);

        return () => {
          window.removeEventListener('resize', handleResize);
          chart.remove();
        };
    } catch (err) {
        console.error("Chart Engine Error:", err);
    }
  }, []); 

  useEffect(() => {
    try {
        if (seriesRef.current && data && data.length > 0) {
          seriesRef.current.update(data[data.length - 1]);
        }
    } catch (err) {
        console.error("Update Error:", err);
    }
  }, [data]);

  return (
    <div
      ref={chartContainerRef}
      style={{ width: '100%', height: '100%', minHeight: '340px' }}
    />
  );
};

export const Chart: React.FC<ChartProps> = (props) => (
  <ErrorBoundary>
    <ChartCore {...props} />
  </ErrorBoundary>
);
