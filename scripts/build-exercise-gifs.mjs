import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import sharp from "sharp";
import { openGymCatalogue } from "../packages/shared/dist/index.js";

const dataDir = new URL("../packages/server/data/", import.meta.url);
const mediaDir = new URL("exercise-media/", dataDir);
const FRAME_DELAY_MS = 750;

const legacyName = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const fileNameFromPath = (pathValue) => pathValue.split("/").at(-1).split("?")[0];

const [catalogueRaw, wgRaw, commonsRaw, ekRaw] = await Promise.all([
  readFile(new URL("opengym-catalogue.json", dataDir), "utf8"),
  readFile(new URL("workout-guide-poses.json", dataDir), "utf8"),
  readFile(new URL("commons-poses.json", dataDir), "utf8"),
  readFile(new URL("everkinetic-poses.json", dataDir), "utf8"),
]);

const serverCatalogue = openGymCatalogue(JSON.parse(catalogueRaw));
const wgPoses = JSON.parse(wgRaw).poses;
const commonsPoses = JSON.parse(commonsRaw).poses;
const ekData = JSON.parse(ekRaw);

const entries = new Map();
for (const pose of [...wgPoses, ...commonsPoses]) {
  entries.set(pose.exerciseId, {
    exerciseId: pose.exerciseId,
    licenseUrl: pose.licenseUrl,
    frames: pose.frames.map((frame) => fileNameFromPath(frame.path)),
  });
}

for (const exercise of serverCatalogue) {
  if (entries.has(exercise.id)) continue;
  const matched = ekData.illustrations.find(
    (item) =>
      item.exerciseId === exercise.id ||
      item.englishNames.some((name) => legacyName(name) === legacyName(exercise.englishName)),
  );
  if (!matched) continue;
  entries.set(exercise.id, {
    exerciseId: exercise.id,
    licenseUrl: ekData.licenseUrl,
    frames: matched.frames.map((frame) => fileNameFromPath(frame.path)),
  });
}

await mkdir(mediaDir, { recursive: true });
const frameCache = new Map();
async function loadFrame(file) {
  if (!frameCache.has(file)) {
    frameCache.set(file, await readFile(new URL(file, mediaDir)));
  }
  return frameCache.get(file);
}

const gifs = {};
const activeFilenames = new Set();
let totalBytes = 0;

for (const entry of [...entries.values()].sort((a, b) => a.exerciseId.localeCompare(b.exerciseId))) {
  if (!/^[A-Za-z0-9_-]+$/.test(entry.exerciseId) || entry.frames.length < 2) continue;
  const buffers = await Promise.all(entry.frames.map((file) => loadFrame(file)));
  const gifBuffer = await sharp(buffers, { join: { across: 1, animated: true } })
    .gif({
      delay: Array(buffers.length).fill(FRAME_DELAY_MS),
      loop: 0,
      colours: 64,
    })
    .toBuffer();
  const sha256 = createHash("sha256").update(gifBuffer).digest("hex");
  const filename = `anim-${entry.exerciseId}.gif`;
  await writeFile(new URL(filename, mediaDir), gifBuffer);
  activeFilenames.add(filename);
  totalBytes += gifBuffer.length;
  gifs[entry.exerciseId] = {
    path: `/media/exercises/${filename}?v=${sha256.slice(0, 12)}`,
    sha256,
    licenseUrl: entry.licenseUrl,
  };
}

for (const file of await readdir(mediaDir)) {
  if (/^anim-[A-Za-z0-9_-]+\.gif$/.test(file) && !activeFilenames.has(file)) {
    await unlink(new URL(basename(file), mediaDir));
  }
}

await writeFile(
  new URL("exercise-gifs.json", dataDir),
  JSON.stringify({ delayMs: FRAME_DELAY_MS, gifs }, null, 2) + "\n",
);
console.log(
  `已生成 ${activeFilenames.size} 张动作示范 GIF，总体积 ${(totalBytes / 1024 / 1024).toFixed(2)} MB`,
);
