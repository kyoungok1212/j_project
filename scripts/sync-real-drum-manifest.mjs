import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const realDrumRoot = path.join(projectRoot, "real_drum");
const manifestPath = path.join(realDrumRoot, "manifest.json");

const TRACK_ORDER = [
  "kick",
  "snare",
  "rimshot",
  "sidestick",
  "high_tom",
  "mid_tom",
  "floor_tom",
  "hi_hat_open",
  "hi_hat_close",
  "foot_hi_hat",
  "ride_cymbal",
  "crash_cymbal"
];

const AUDIO_EXTENSIONS = new Set([".wav", ".mp3", ".ogg", ".m4a", ".flac", ".aac", ".aif", ".aiff"]);

function compareTrackName(a, b) {
  const aIndex = TRACK_ORDER.indexOf(a);
  const bIndex = TRACK_ORDER.indexOf(b);
  const aRank = aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex;
  const bRank = bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex;
  if (aRank !== bRank) {
    return aRank - bRank;
  }
  return a.localeCompare(b);
}

function toLabel(filename) {
  return path.basename(filename, path.extname(filename));
}

function toPublicValue(trackName, fileName) {
  return `/real-drum/${trackName}/${fileName}`;
}

async function readExistingLabelMap() {
  try {
    const raw = await fs.readFile(manifestPath, "utf8");
    const parsed = JSON.parse(raw);
    const tracks = parsed && typeof parsed === "object" && parsed.tracks && typeof parsed.tracks === "object"
      ? parsed.tracks
      : {};
    const labelMap = new Map();
    for (const options of Object.values(tracks)) {
      if (!Array.isArray(options)) {
        continue;
      }
      for (const item of options) {
        if (!item || typeof item !== "object") {
          continue;
        }
        const value = typeof item.value === "string" ? item.value : "";
        const label = typeof item.label === "string" ? item.label : "";
        if (value && label) {
          labelMap.set(value, label);
        }
      }
    }
    return labelMap;
  } catch {
    return new Map();
  }
}

async function buildManifestObject() {
  const existingLabelMap = await readExistingLabelMap();
  const entries = await fs.readdir(realDrumRoot, { withFileTypes: true });
  const trackDirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort(compareTrackName);
  const tracks = {};

  for (const trackName of trackDirs) {
    const trackDir = path.join(realDrumRoot, trackName);
    const children = await fs.readdir(trackDir, { withFileTypes: true });
    const files = children
      .filter((entry) => entry.isFile() && AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));

    tracks[trackName] = files.map((fileName) => {
      const value = toPublicValue(trackName, fileName);
      return {
        value,
        label: existingLabelMap.get(value) ?? toLabel(fileName)
      };
    });
  }

  return {
    version: 1,
    source: "real_drum",
    tracks
  };
}

async function run() {
  const manifest = await buildManifestObject();
  const nextText = `${JSON.stringify(manifest, null, 2)}\n`;
  let currentText = "";
  try {
    currentText = await fs.readFile(manifestPath, "utf8");
  } catch {
    currentText = "";
  }

  if (currentText === nextText) {
    console.log("[real-drum] manifest is up to date.");
    return;
  }

  await fs.writeFile(manifestPath, nextText, "utf8");
  const trackCount = Object.keys(manifest.tracks).length;
  const sampleCount = Object.values(manifest.tracks).reduce(
    (sum, options) => sum + (Array.isArray(options) ? options.length : 0),
    0
  );
  console.log(`[real-drum] manifest updated: ${trackCount} tracks, ${sampleCount} samples.`);
}

run().catch((error) => {
  console.error("[real-drum] failed to sync manifest.");
  console.error(error);
  process.exitCode = 1;
});
