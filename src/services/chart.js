import YahooFinance from "yahoo-finance2";
import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import "chart.js/auto";

const yf = new YahooFinance({ suppressNotices: ["ripHistorical"] });

const DAYS_MAP = {
  "1w": 7, "2w": 14, "1m": 30, "3m": 90, "6m": 180, "1y": 365,
};

const canvas = new ChartJSNodeCanvas({
  width: 900,
  height: 520,
  backgroundColour: "#131722",
  chartJsOptions: { devicePixelRatio: 2 },
});

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
    result.push(+(sum / period).toFixed(2));
  }
  return result;
}

function formatVol(v) {
  if (v >= 1e9) return (v / 1e9).toFixed(1) + "B";
  if (v >= 1e6) return (v / 1e6).toFixed(1) + "M";
  if (v >= 1e3) return (v / 1e3).toFixed(1) + "K";
  return v.toFixed(0);
}

export async function getChartImage(symbol, data, period = "1m", theme = "dark") {
  if (!data || data.length < 2) return null;

  const labels = data.map(d => {
    const dt = d.date;
    return typeof dt === "object" && dt.toISOString ? dt.toISOString().slice(5, 10) : String(dt).slice(5, 10);
  });

  const closes = data.map(d => d.close);
  const volumes = data.map(d => d.volume || 0);
  const maxVol = Math.max(...volumes) || 1;

  const first = closes[0];
  const last = closes[closes.length - 1];
  const chg = ((last - first) / first * 100);
  const up = last >= first;
  const pc = up ? "#26a69a" : "#ef5350";

  const len = closes.length;
  const m1 = len >= 45 ? 10 : len >= 20 ? 5 : len >= 12 ? 3 : null;
  const m2 = len >= 45 ? 20 : len >= 25 ? 10 : null;

  const h1 = m1 ? sma(closes, m1) : [];
  const h2 = m2 ? sma(closes, m2) : [];
  const s1 = m1 && h1.filter(v => v !== null).length >= 3;
  const s2 = m2 && h2.filter(v => v !== null).length >= 3;

  const minP = Math.min(...closes);
  const maxP = Math.max(...closes);
  const pad = (maxP - minP) * 0.05 || minP * 0.02;
  const paddedMin = minP - pad;
  const paddedMax = maxP + pad;

  const volMax = maxVol * 5;

  const volColors = volumes.map((v, i) => {
    if (i === 0) return "#1e2030";
    return v > volumes[i - 1] ? "#26a69a50" : "#ef535050";
  });

  const datasets = [
    {
      type: "bar",
      label: "Volume",
      data: volumes,
      backgroundColor: volColors,
      borderColor: "transparent",
      borderWidth: 0,
      barPercentage: 0.6,
      categoryPercentage: 0.9,
      yAxisID: "yVol",
      order: 4,
    },
    {
      type: "line",
      label: symbol,
      data: closes,
      borderColor: pc,
      backgroundColor: up ? "#26a69a12" : "#ef535012",
      borderWidth: 2.5,
      pointRadius: 0,
      tension: 0.15,
      fill: true,
      yAxisID: "yPrice",
      order: 1,
    },
  ];

  if (s1) {
    datasets.push({
      type: "line",
      label: `MA${m1}`,
      data: h1,
      borderColor: "#fdd835",
      borderWidth: 1.5,
      borderDash: [6, 3],
      pointRadius: 0,
      tension: 0.15,
      fill: false,
      yAxisID: "yPrice",
      order: 2,
    });
  }

  if (s2) {
    datasets.push({
      type: "line",
      label: `MA${m2}`,
      data: h2,
      borderColor: "#42a5f5",
      borderWidth: 1.5,
      borderDash: [3, 3],
      pointRadius: 0,
      tension: 0.15,
      fill: false,
      yAxisID: "yPrice",
      order: 3,
    });
  }

  const config = {
    type: "bar",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          position: "top",
          align: "end",
          labels: {
            color: "#d1d4dc",
            boxWidth: 14,
            boxHeight: 0,
            padding: 10,
            font: { size: 11, family: "'Inter', 'Segoe UI', system-ui, sans-serif" },
            usePointStyle: true,
            pointStyle: "line",
          },
        },
        title: {
          display: true,
          text: [
            `${symbol}  ${period}`,
            `${last.toFixed(2)}  ${up ? "+" : ""}${chg.toFixed(2)}%`,
          ],
          color: "#d1d4dc",
          font: { size: 11, family: "'Inter', 'Segoe UI', system-ui, sans-serif" },
          padding: { top: 6, bottom: 0 },
          align: "start",
        },
      },
      scales: {
        x: {
          ticks: {
            color: "#5a5d6e",
            maxTicksLimit: 6,
            font: { size: 10, family: "'Inter', 'Segoe UI', system-ui, sans-serif" },
            maxRotation: 0,
          },
          grid: {
            color: "#1e2030",
            drawBorder: false,
            drawTicks: false,
          },
        },
        yPrice: {
          position: "right",
          ticks: {
            color: "#5a5d6e",
            font: { size: 10, family: "'Inter', 'Segoe UI', system-ui, sans-serif" },
            maxTicksLimit: 6,
            callback: v => v.toFixed(0),
          },
          grid: {
            color: "#1e2030",
            drawBorder: false,
            drawTicks: false,
          },
          min: paddedMin,
          max: paddedMax,
        },
        yVol: {
          position: "right",
          display: true,
          ticks: {
            color: "#5a5d6e",
            font: { size: 9, family: "'Inter', 'Segoe UI', system-ui, sans-serif" },
            maxTicksLimit: 3,
            callback: v => formatVol(v),
          },
          grid: {
            color: "#1e2030",
            drawBorder: false,
            drawTicks: false,
          },
          min: 0,
          max: volMax,
        },
      },
    },
  };

  try {
    const raw = await canvas.renderToBuffer(config, "image/png");
    const { createCanvas, loadImage } = await import("canvas");
    const final = createCanvas(900, 540);
    const ctx = final.getContext("2d");

    ctx.fillStyle = "#131722";
    ctx.fillRect(0, 0, 900, 540);

    const img = await loadImage(raw);
    ctx.drawImage(img, 0, 0, 900, 520);

    ctx.strokeStyle = "#1e2030";
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, 900, 520);

    const now = new Date();
    const ds = now.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
    ctx.fillStyle = "#5a5d6e";
    ctx.font = "10px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`Diperbarui ${ds}`, 450, 534);

    return final.toBuffer("image/png");
  } catch (e) {
    console.error("[CHART] render error:", e.message);
    return null;
  }
}

export function getPeriodLabel(period) {
  const labels = { "1w": "1 Minggu", "2w": "2 Minggu", "1m": "1 Bulan", "3m": "3 Bulan", "6m": "6 Bulan", "1y": "1 Tahun" };
  return labels[period] || period;
}
