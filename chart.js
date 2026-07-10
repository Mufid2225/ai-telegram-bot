import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance({ suppressNotices: ["ripHistorical"] });
const QC_BASE = "https://quickchart.io/chart";

const DAYS_MAP = {
  "1w": 7, "2w": 14, "1m": 30, "3m": 90, "6m": 180, "1y": 365,
};

export async function getHistory(symbol, period = "1m") {
  const days = DAYS_MAP[period] || 30;
  const now = new Date();
  const past = new Date(now);
  past.setDate(past.getDate() - days);

  try {
    const d = await yf.chart(symbol, {
      period1: Math.floor(past.getTime() / 1000),
      period2: Math.floor(now.getTime() / 1000),
      interval: "1d",
    });
    return (d.quotes || []).filter(q => q.close != null);
  } catch {
    return [];
  }
}

function buildCandlestickChart(symbol, data, period, theme) {
  const isDark = theme === "dark";
  const textColor = isDark ? "#d1d5db" : "#374151";
  const gridColor = isDark ? "#374151" : "#e5e7eb";
  const bgColor = isDark ? "#1f2937" : "#ffffff";

  const ohlc = data.map(d => ({
    x: d.date.toISOString().slice(0, 10),
    o: d.open,
    h: d.high,
    l: d.low,
    c: d.close,
  }));

  const dates = ohlc.map(d => d.x);
  const closes = ohlc.map(d => d.c);
  const minPrice = Math.min(...ohlc.map(d => d.l)) * 0.995;
  const maxPrice = Math.max(...ohlc.map(d => d.h)) * 1.005;
  const vol = data.map(d => d.volume || 0);
  const maxVol = Math.max(...vol) || 1;

  const config = {
    type: "candlestick",
    data: {
      datasets: [{
        label: symbol,
        data: ohlc,
        color: {
          up: "#22c55e",
          down: "#ef4444",
          unchanged: "#9ca3af",
        },
        borderColor: {
          up: "#22c55e",
          down: "#ef4444",
          unchanged: "#9ca3af",
        },
      }],
    },
    options: {
      responsive: true,
      backgroundColor: bgColor,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: isDark ? "#374151" : "#fff",
          titleColor: textColor,
          bodyColor: textColor,
          borderColor: gridColor,
          borderWidth: 1,
          callbacks: {
            label: ctx => {
              const d = ctx.raw;
              return `O: ${d.o}  H: ${d.h}  L: ${d.l}  C: ${d.c}`;
            },
          },
        },
      },
      scales: {
        x: {
          type: "time",
          time: { unit: "day", displayFormats: { day: "dd MMM" } },
          ticks: { color: textColor, maxTicksLimit: 8 },
          grid: { color: gridColor },
        },
        y: {
          position: "right",
          ticks: { color: textColor },
          grid: { color: gridColor },
          min: minPrice,
          max: maxPrice,
        },
      },
    },
  };

  const url = `${QC_BASE}?width=700&height=400&backgroundColor=${isDark ? "dark" : "white"}&c=${encodeURIComponent(JSON.stringify(config))}`;
  return url;
}

function buildLineChart(symbol, data, period, theme) {
  const isDark = theme === "dark";
  const textColor = isDark ? "#d1d5db" : "#374151";
  const gridColor = isDark ? "#374151" : "#e5e7eb";
  const bgColor = isDark ? "#1f2937" : "#ffffff";

  const dates = data.map(d => d.date.toISOString().slice(0, 10));
  const closes = data.map(d => d.close);

  const first = closes[0];
  const last = closes[closes.length - 1];
  const isUp = last >= first;
  const lineColor = isUp ? "#22c55e" : "#ef4444";

  const config = {
    type: "line",
    data: {
      labels: dates,
      datasets: [
        {
          label: symbol,
          data: closes,
          borderColor: lineColor,
          backgroundColor: lineColor + "20",
          borderWidth: 2,
          pointRadius: 2,
          pointHoverRadius: 5,
          fill: true,
          tension: 0.1,
        },
      ],
    },
    options: {
      responsive: true,
      backgroundColor: bgColor,
      plugins: {
        legend: { display: false },
      },
      scales: {
        x: {
          ticks: { color: textColor, maxTicksLimit: 8 },
          grid: { color: gridColor },
        },
        y: {
          position: "right",
          ticks: { color: textColor },
          grid: { color: gridColor },
        },
      },
    },
  };

  const url = `${QC_BASE}?width=700&height=350&backgroundColor=${isDark ? "dark" : "white"}&c=${encodeURIComponent(JSON.stringify(config))}`;
  return url;
}

export async function getChartUrl(symbol, data, period = "1m", type = "line", theme = "dark") {
  if (!data || data.length < 2) return null;
  if (type === "candle") {
    return buildCandlestickChart(symbol, data, period, theme);
  }
  return buildLineChart(symbol, data, period, theme);
}

export function getPeriodLabel(period) {
  const labels = { "1w": "1 Minggu", "2w": "2 Minggu", "1m": "1 Bulan", "3m": "3 Bulan", "6m": "6 Bulan", "1y": "1 Tahun" };
  return labels[period] || period;
}
