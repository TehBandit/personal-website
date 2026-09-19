import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DuckDBInstance } from "@duckdb/node-api";

const PARQUET_FILES = [
  "https://huggingface.co/datasets/Jay-Jingfeng-Chen/fcds/resolve/refs%2Fconvert%2Fparquet/default/train/0000.parquet",
  "https://huggingface.co/datasets/Jay-Jingfeng-Chen/fcds/resolve/refs%2Fconvert%2Fparquet/default/train/0001.parquet",
];

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.resolve(
  scriptDirectory,
  "../public/data/spotify-us-top-50-age.json"
);

const instance = await DuckDBInstance.create();
const connection = await instance.connect();
const parquetList = PARQUET_FILES.map((url) => `'${url}'`).join(", ");
const reader = await connection.runAndReadAll(`
  WITH chart_rows AS (
    SELECT
      TRY_CAST(snapshot_date AS DATE) AS snapshot_date,
      CASE
        WHEN LENGTH(album_release_date) = 10
          THEN TRY_STRPTIME(album_release_date, '%Y-%m-%d')::DATE
        WHEN LENGTH(album_release_date) = 7
          THEN (TRY_STRPTIME(album_release_date, '%Y-%m') + INTERVAL 14 DAYS)::DATE
        WHEN LENGTH(album_release_date) = 4
          THEN (TRY_STRPTIME(album_release_date, '%Y') + INTERVAL 182 DAYS)::DATE
        ELSE NULL
      END AS release_date
    FROM read_parquet([${parquetList}])
    WHERE country_alpha3 = 'USA' AND daily_rank <= 50
  ), valid_rows AS (
    SELECT snapshot_date, release_date
    FROM chart_rows
    WHERE
      snapshot_date IS NOT NULL
      AND release_date IS NOT NULL
      AND release_date <= snapshot_date
  )
  SELECT
    STRFTIME(snapshot_date, '%Y-%m-%d') AS time,
    ROUND(AVG(DATE_DIFF('day', release_date, snapshot_date)), 2) AS value,
    COUNT(*)::INTEGER AS songCount
  FROM valid_rows
  GROUP BY snapshot_date
  ORDER BY snapshot_date
`);
const data = reader.getRowObjectsJson();
connection.closeSync();

if (data.length === 0) {
  throw new Error("No usable U.S. Spotify chart observations were found.");
}

const payload = {
  meta: {
    title: "Average age of songs in Spotify's U.S. Top 50",
    frequency: "daily",
    unit: "days",
    firstDate: data[0].time,
    lastDate: data[data.length - 1].time,
    source:
      "https://www.kaggle.com/datasets/asaniczka/top-spotify-songs-in-73-countries-daily-updated",
    mirror: "https://huggingface.co/datasets/Jay-Jingfeng-Chen/fcds",
    methodology:
      "Unweighted mean age of chart positions 1-50. Partial release dates use the midpoint of the known year or month. Missing and future release dates are excluded.",
  },
  data,
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

console.log(
  `Wrote ${data.length} daily observations (${data[0].time} through ${data[data.length - 1].time}) to ${outputPath}`
);
