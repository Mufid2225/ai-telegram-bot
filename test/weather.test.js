import test from "node:test";
import assert from "node:assert/strict";
import { geocode, getForecast, weatherCodeText, formatForecast } from "../src/services/weather.js";

const geoUji = {
  name: "Jakarta",
  latitude: -6.2146,
  longitude: 106.8451,
  country: "Indonesia",
  admin1: "Jakarta",
  timezone: "Asia/Jakarta",
};

const forecastUji = {
  timezone: "Asia/Jakarta",
  current: {
    time: "2026-11-19T13:00",
    temperature_2m: 31.2,
    relative_humidity_2m: 74,
    apparent_temperature: 36.5,
    weather_code: 95,
    wind_speed_10m: 9.4,
  },
  daily: {
    time: ["2026-11-19", "2026-11-20"],
    weather_code: [95, 61],
    temperature_2m_max: [32.1, 30.4],
    temperature_2m_min: [25.3, 24.8],
    precipitation_probability_max: [80, 45],
  },
};

test("geocode returns first result, builds correct URL, and caches", async (t) => {
  const urls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    urls.push(String(url));
    return new Response(JSON.stringify({ results: [geoUji] }), { status: 200 });
  });

  const geo = await geocode("Jakarta");
  assert.equal(geo.name, "Jakarta");
  assert.equal(geo.latitude, -6.2146);
  assert.equal(urls[0], "https://geocoding-api.open-meteo.com/v1/search?name=Jakarta&count=1&language=id");

  const second = await geocode("Jakarta");
  assert.deepEqual(second, geo);
  assert.equal(urls.length, 1);
});

test("getForecast builds verified URL shape and formatForecast includes attribution", async (t) => {
  const urls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    urls.push(String(url));
    return new Response(JSON.stringify(forecastUji), { status: 200 });
  });

  const data = await getForecast(-6.2146, 106.8451, "Asia/Jakarta", 3);
  assert.equal(data.current.temperature_2m, 31.2);
  assert.match(urls[0], /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?/);
  assert.match(urls[0], /latitude=-6\.2146&longitude=106\.8451/);
  assert.match(urls[0], /current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m/);
  assert.match(urls[0], /daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max/);
  assert.match(urls[0], /timezone=Asia%2FJakarta/);
  assert.match(urls[0], /forecast_days=3/);

  const text = formatForecast(geoUji, data);
  assert.match(text, /Jakarta, Jakarta, Indonesia/);
  assert.match(text, /badai petir/);
  assert.match(text, /terasa seperti 36\.5°C/);
  assert.match(text, /peluang hujan 80%/);
  assert.match(text, /24\.8–30\.4°C/);
  assert.match(text, /Data: Open-Meteo \(CC-BY 4\.0\)/);
});

test("getForecast clamps days to 1-7", async (t) => {
  const urls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    urls.push(String(url));
    return new Response(JSON.stringify(forecastUji), { status: 200 });
  });

  await getForecast(1.5, 2.5, "auto", 99);
  assert.match(urls[0], /forecast_days=7/);
  await getForecast(3.5, 4.5, "auto", 0);
  assert.match(urls[1], /forecast_days=1/);
});

test("weatherCodeText maps WMO codes to Bahasa Indonesia with safe default", () => {
  assert.equal(weatherCodeText(0), "cerah");
  assert.equal(weatherCodeText(3), "mendung");
  assert.match(weatherCodeText(95), /petir/);
  assert.match(weatherCodeText(96), /petir/);
  assert.match(weatherCodeText(61), /hujan ringan/);
  assert.equal(weatherCodeText(999), "tidak diketahui");
});

test("weather services return null on failure without throwing", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("network down");
  });
  assert.equal(await geocode("kota gagal uji"), null);
  assert.equal(await getForecast(5.5, 6.5), null);

  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({}), { status: 200 }));
  assert.equal(await geocode("kota kosong uji"), null);
  assert.equal(await getForecast(7.5, 8.5), null);
});
