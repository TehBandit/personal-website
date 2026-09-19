import { useEffect, useMemo, useState } from "react";
import Header from "../components/Header.jsx";
import Footer from "../components/Footer.jsx";
import TimeSeriesChart from "../components/TimeSeriesChart.jsx";

function parseFredCsv(csv) {
  return csv
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((row) => {
      const [time, rawValue] = row.split(",");
      const value = rawValue?.trim() === "" ? Number.NaN : Number(rawValue);
      return { time, value };
    })
    .filter((point) => point.time && Number.isFinite(point.value));
}

function calculateDailyChanges(data) {
  return data.slice(1).map((point, index) => {
    const previousValue = data[index].value;
    const change = ((point.value - previousValue) / previousValue) * 100;

    return {
      time: point.time,
      value: change,
      color: change >= 0 ? "#16a34a" : "#dc2626",
    };
  });
}

function RecessionIndicator() {
  const [sp500Data, setSp500Data] = useState([]);
  const [status, setStatus] = useState("loading");
  const [spotifyAgeData, setSpotifyAgeData] = useState([]);
  const [spotifyStatus, setSpotifyStatus] = useState("loading");

  useEffect(() => {
    const controller = new AbortController();

    async function loadSp500() {
      try {
        const response = await fetch("/api/market-series?series=sp500", {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error("Unable to load the S&P 500 data.");
        }

        const points = parseFredCsv(await response.text());

        if (points.length === 0) {
          throw new Error("The S&P 500 data feed returned no observations.");
        }

        setSp500Data(points);
        setStatus("ready");
      } catch (error) {
        if (error.name !== "AbortError") {
          console.error(error);
          setStatus("error");
        }
      }
    }

    loadSp500();

    return () => {
      controller.abort();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    async function loadSpotifyAge() {
      try {
        const response = await fetch("/data/spotify-us-top-50-age.json", {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error("Unable to load the Spotify chart-age data.");
        }

        const payload = await response.json();

        if (!Array.isArray(payload.data) || payload.data.length === 0) {
          throw new Error("The Spotify chart-age dataset is empty.");
        }

        setSpotifyAgeData(payload.data);
        setSpotifyStatus("ready");
      } catch (error) {
        if (error.name !== "AbortError") {
          console.error(error);
          setSpotifyStatus("error");
        }
      }
    }

    loadSpotifyAge();

    return () => {
      controller.abort();
    };
  }, []);

  const chartSeries = useMemo(
    () => [
      {
        id: "sp500",
        name: "S&P 500",
        color: "#2563eb",
        data: sp500Data,
      },
    ],
    [sp500Data]
  );

  const dailyChangeSeries = useMemo(
    () => [
      {
        id: "sp500-daily-change",
        name: "S&P 500 daily change",
        type: "histogram",
        color: "#16a34a",
        base: 0,
        showZeroLine: true,
        formatter: (value) => `${value.toFixed(2)}%`,
        data: calculateDailyChanges(sp500Data),
      },
    ],
    [sp500Data]
  );

  const spotifyAgeSeries = useMemo(
    () => [
      {
        id: "spotify-us-top-50-age",
        name: "Spotify U.S. Top 50 — average song age",
        color: "#1db954",
        formatter: (value) => `${Math.round(value).toLocaleString()} days`,
        minMove: 1,
        data: spotifyAgeData,
      },
    ],
    [spotifyAgeData]
  );

  const spotifyAgeChangeSeries = useMemo(
    () => [
      {
        id: "spotify-us-top-50-age-change",
        name: "Daily change in average song age",
        type: "histogram",
        color: "#16a34a",
        base: 0,
        showZeroLine: true,
        formatter: (value) => `${value.toFixed(2)}%`,
        data: calculateDailyChanges(spotifyAgeData),
      },
    ],
    [spotifyAgeData]
  );

  return (
    <div className="min-h-[100dvh] flex flex-col">
      <Header />
      <main className="beyond-red-line flex-1 pb-6" aria-label="S&P 500 daily chart">
        <div
          className="relative w-full overflow-hidden rounded-2xl bg-white shadow-xl"
          style={{ height: "max(520px, calc(100dvh - 11rem))" }}
        >
          {status === "loading" && (
            <div className="flex h-full items-center justify-center text-sm text-gray-500">
              loading daily S&amp;P 500 data...
            </div>
          )}

          {status === "error" && (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-red-600">
              the market data could not be loaded. please try again shortly.
            </div>
          )}

          {status === "ready" && <TimeSeriesChart series={chartSeries} />}

          {status === "ready" && (
            <a
              href="https://www.tradingview.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="absolute bottom-1 left-3 z-10 text-[10px] text-gray-400 hover:text-blue-600"
            >
              TradingView Lightweight Charts™ © 2025 TradingView, Inc.
            </a>
          )}
        </div>

        {status === "ready" && (
          <div
            className="relative mt-6 h-[420px] w-full overflow-hidden rounded-2xl bg-white shadow-xl"
            aria-label="S&P 500 daily percentage change chart"
          >
            <TimeSeriesChart series={dailyChangeSeries} />
          </div>
        )}

        <div
          className="relative mt-6 h-[420px] w-full overflow-hidden rounded-2xl bg-white shadow-xl"
          aria-label="Average age in days of songs in Spotify's U.S. Top 50"
        >
          {spotifyStatus === "loading" && (
            <div className="flex h-full items-center justify-center text-sm text-gray-500">
              loading daily Spotify U.S. Top 50 song-age data...
            </div>
          )}

          {spotifyStatus === "error" && (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-red-600">
              the Spotify chart-age data could not be loaded.
            </div>
          )}

          {spotifyStatus === "ready" && <TimeSeriesChart series={spotifyAgeSeries} />}

          {spotifyStatus === "ready" && (
            <>
              <a
                href="https://www.kaggle.com/datasets/asaniczka/top-spotify-songs-in-73-countries-daily-updated"
                target="_blank"
                rel="noopener noreferrer"
                className="absolute bottom-1 left-3 z-10 text-[10px] text-gray-400 hover:text-green-600"
              >
                Spotify chart archive via Kaggle
              </a>
              <span className="absolute bottom-1 right-3 z-10 text-[10px] text-gray-400">
                daily: Oct 18, 2023–Jun 11, 2025
              </span>
            </>
          )}
        </div>

        {spotifyStatus === "ready" && (
          <div
            className="relative mt-6 h-[420px] w-full overflow-hidden rounded-2xl bg-white shadow-xl"
            aria-label="Daily percentage change in the average age of songs in Spotify's U.S. Top 50"
          >
            <TimeSeriesChart series={spotifyAgeChangeSeries} />
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}

export default RecessionIndicator;
