import { useEffect, useRef } from "react";
import {
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
} from "lightweight-charts";

function TimeSeriesChart({ series, initialBars = 252 }) {
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;

    if (!container || series.length === 0) return;

    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: "#475569",
        fontFamily: "Open Sans, sans-serif",
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: "#eef2f7" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#cbd5e1" },
      timeScale: {
        borderColor: "#cbd5e1",
        rightOffset: 4,
        barSpacing: 6,
        minBarSpacing: 0.5,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
    });

    series.forEach((item) => {
      const seriesType = item.type === "histogram" ? HistogramSeries : LineSeries;
      const seriesOptions = {
        title: item.name,
        color: item.color,
        lineWidth: item.lineWidth || 2,
        priceScaleId: item.priceScaleId || "right",
        priceFormat: item.formatter
          ? {
              type: "custom",
              formatter: item.formatter,
              minMove: item.minMove ?? 0.01,
            }
          : {
              type: "price",
              precision: item.precision ?? 2,
              minMove: item.minMove ?? 0.01,
            },
      };

      if (item.type === "histogram") {
        seriesOptions.base = item.base ?? 0;
      }

      const plottedSeries = chart.addSeries(seriesType, seriesOptions);

      plottedSeries.setData(item.data);

      if (item.showZeroLine) {
        plottedSeries.createPriceLine({
          price: 0,
          color: "#64748b",
          lineWidth: 1,
          lineStyle: LineStyle.Solid,
          axisLabelVisible: true,
          title: "0%",
        });
      }
    });

    const primaryData = series[0].data;

    if (initialBars > 0 && primaryData.length > initialBars) {
      chart.timeScale().setVisibleRange({
        from: primaryData[primaryData.length - initialBars].time,
        to: primaryData[primaryData.length - 1].time,
      });
    } else {
      chart.timeScale().fitContent();
    }

    const resizeObserver = new ResizeObserver(([entry]) => {
      chart.applyOptions({
        width: Math.floor(entry.contentRect.width),
        height: Math.floor(entry.contentRect.height),
      });
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [initialBars, series]);

  return <div ref={containerRef} className="h-full w-full" />;
}

export default TimeSeriesChart;
