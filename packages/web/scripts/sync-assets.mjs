import { copyFile, mkdir, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const repoRoot = new URL("../../../", import.meta.url);
const outDir = new URL("../public/", import.meta.url);

await mkdir(outDir, { recursive: true });

for (const artwork of ["athlete", "plate", "nutrition", "equipment"]) {
  for (const suffix of ["", "-light"]) {
    const name = `${artwork}-halftone${suffix}.jpg`;
    await copyFile(new URL(`web/assets/visuals/${name}`, repoRoot), new URL(name, outDir));
  }
}

for (const shareBg of ["share-bg-paper.jpg", "share-bg-ring.jpg", "share-bg-mono.jpg", "share-bg-poster.jpg"]) {
  await copyFile(new URL(`web/assets/visuals/${shareBg}`, repoRoot), new URL(shareBg, outDir));
}

const groups = ["neutral", "chest", "back", "legs", "shoulders", "arms", "core"];
for (const name of groups) {
  await copyFile(new URL(`web/assets/muscles/atlas-${name}.png`, repoRoot), new URL(`atlas-${name}.png`, outDir));
}

await sharp(fileURLToPath(new URL("atlas-neutral.png", outDir)))
  .composite(groups.slice(1).map((name) => ({ input: fileURLToPath(new URL(`atlas-${name}.png`, outDir)) })))
  .png()
  .toFile(fileURLToPath(new URL("atlas-all.png", outDir)));

const badgeDir = new URL("web/assets/badges/", repoRoot);
const badgeFiles = (await readdir(badgeDir, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".png"));
await Promise.all(
  badgeFiles.map(({ name }) => copyFile(new URL(name, badgeDir), new URL(name, outDir))),
);

for (const size of [192, 512]) {
  const squares = [
    [15, 33], [15, 44], [15, 55], [25, 33], [25, 44], [25, 55], [35, 44], [45, 44],
    [55, 33], [55, 44], [55, 55], [65, 33], [65, 44], [65, 55], [79, 61],
  ]
    .map(([x, y], index) => `<rect x="${x}" y="${y}" width="7" height="7" rx="2" fill="${index === 14 ? "#fc4941" : "#f4f3f0"}"/>`)
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100"><rect width="100" height="100" rx="23" fill="#101113"/>${squares}</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(fileURLToPath(new URL(`icon-${size}.png`, outDir)));
}
