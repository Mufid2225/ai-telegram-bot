import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance({ suppressNotices: ["ripHistorical"] });

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

function sma(data, period) {
  const result = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += data[j];
    result.push(sum / period);
  }
  return result;
}

export async function getChartImage(symbol, data, period = "1m", theme = "dark") {
  if (!data || data.length < 2) return null;

  const isDark = theme === "dark";
  const txt = isDark ? "#d1d5db" : "#374151";
  const grid = isDark ? "#2d3748" : "#e5e7eb";

  const labels = data.map(d => {
    const dt = d.date;
    if (typeof dt === 'object' && dt.toISOString) return dt.toISOString().slice(5, 10);
    return String(dt).slice(5, 10);
  });
  const closes = data.map(d => d.close);

  const first = closes[0];
  const last = closes[closes.length - 1];
  const chg = ((last - first) / first * 100);
  const up = last >= first;
  const pc = up ? "#22c55e" : "#ef4444";

  const sma5 = sma(closes, 5);
  const sma20 = sma(closes, 20);
  const minP = Math.min(...closes) * 0.99;
  const maxP = Math.max(...closes) * 1.01;

  const chartData = {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: `${symbol}`,
          data: closes,
          borderColor: pc,
          backgroundColor: pc + "18",
          borderWidth: 2.5,
          pointRadius: 0,
          fill: true,
          tension: 0.1,
        },
        {
          label: "MA5",
          data: sma5,
          borderColor: "#f59e0b",
          borderWidth: 1.5,
          borderDash: [6, 3],
          pointRadius: 0,
          tension: 0.1,
        },
        {
          label: "MA20",
          data: sma20,
          borderColor: "#3b82f6",
          borderWidth: 1.5,
          borderDash: [4, 4],
          pointRadius: 0,
          tension: 0.1,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          position: "top",
          align: "end",
          labels: { color: txt, boxWidth: 12, padding: 6, font: { size: 10 }, usePointStyle: true, pointStyle: "line" },
        },
        title: {
          display: true,
          text: `${symbol}  ${period}  ${up ? "+" : ""}${chg.toFixed(2)}%  |  ${last.toFixed(0)}`,
          color: txt,
          font: { size: 13, weight: "bold" },
          padding: { top: 6, bottom: 2 },
        },
      },
      scales: {
        x: {
          ticks: { color: txt, maxTicksLimit: 6, font: { size: 9 } },
          grid: { color: grid, drawBorder: false },
        },
        y: {
          position: "right",
          ticks: { color: txt, font: { size: 9 }, maxTicksLimit: 5 },
          grid: { color: grid, drawBorder: false },
          min: minP,
          max: maxP,
        },
      },
    },
  };

  try {
    const resp = await fetch("https://quickchart.io/chart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        width: 800,
        height: 420,
        devicePixelRatio: 2,
        backgroundColor: isDark ? "dark" : "white",
        chart: chartData,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return null;
    const raw = await resp.arrayBuffer();
    return Buffer.from(new Uint8Array(raw));
  } catch {
    return null;
  }
}

export function getPeriodLabel(period) {
  const labels = { "1w": "1 Minggu", "2w": "2 Minggu", "1m": "1 Bulan", "3m": "3 Bulan", "6m": "6 Bulan", "1y": "1 Tahun" };
  return labels[period] || period;
}
