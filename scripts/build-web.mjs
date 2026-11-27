import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build, transform } from "esbuild";
import sharp from "sharp";

const root = new URL("../", import.meta.url);
const src = new URL("web/src/", root);
const out = new URL("web/dist/", root);

async function bundleCss(entryUrl) {
  const raw = await readFile(entryUrl, "utf8");
  const importRe = /^@import\s+["'](\.[^"']+)["'];?\s*$/gm;
  let result = "";
  let lastIndex = 0;
  for (const match of raw.matchAll(importRe)) {
    result += raw.slice(lastIndex, match.index);
    const childUrl = new URL(match[1], entryUrl);
    result += await bundleCss(childUrl);
    lastIndex = match.index + match[0].length;
    if (raw[lastIndex] === "\r") lastIndex++;
    if (raw[lastIndex] === "\n") lastIndex++;
  }
  result += raw.slice(lastIndex);
  return result;
}

await mkdir(out, { recursive: true });
await Promise.all((await readdir(src, { withFileTypes: true })).filter((file) => file.isFile()).map(async ({ name }) => {
  const inUrl = new URL(name, src);
  const outUrl = new URL(name, out);
  if (name === "offline-queue.js" || name === "project-shared.js") {
    await build({
      entryPoints: [fileURLToPath(inUrl)], outfile: fileURLToPath(outUrl),
      bundle: true, format: "esm", target: "es2020", minify: true,
    });
  } else if ((name.endsWith(".js") && name !== "sw.js") || name.endsWith(".css")) {
    const source = name.endsWith(".css") ? await bundleCss(inUrl) : await readFile(inUrl, "utf8");
    const result = await transform(source, { loader: name.endsWith(".css") ? "css" : "js", minify: true, target: "es2020" });
    await writeFile(outUrl, result.code, "utf8");
  } else {
    await copyFile(inUrl, outUrl);
  }
}));
await build({
  entryPoints: [fileURLToPath(new URL("packages/shared/src/matrix.ts", root))],
  outfile: fileURLToPath(new URL("matrix-data.js", out)), format: "esm", target: "es2020", minify: true,
});
for (const artwork of ["athlete", "plate", "nutrition", "equipment"]) {
  for (const suffix of ["", "-light"]) {
    const name = artwork + "-halftone" + suffix + ".jpg";
    await copyFile(new URL("web/assets/visuals/" + name, root), new URL(name, out));
  }
}
for (const shareBg of ["share-bg-paper.jpg", "share-bg-ring.jpg", "share-bg-mono.jpg", "share-bg-poster.jpg"]) {
  await copyFile(new URL("web/assets/visuals/" + shareBg, root), new URL(shareBg, out));
}
const groups = ["neutral", "chest", "back", "legs", "shoulders", "arms", "core"];
for (const name of groups)
  await copyFile(new URL(`web/assets/muscles/atlas-${name}.png`, root), new URL(`atlas-${name}.png`, out));
const badgeAssets = new URL("web/assets/badges/", root);
await Promise.all((await readdir(badgeAssets, { withFileTypes: true })).filter((file) => file.isFile() && file.name.endsWith(".png"))
  .map(({ name }) => copyFile(new URL(name, badgeAssets), new URL(name, out))));
await sharp(fileURLToPath(new URL("atlas-neutral.png", out))).composite(groups.slice(1)
  .map((name) => ({ input: fileURLToPath(new URL(`atlas-${name}.png`, out)) })))
  .png().toFile(fileURLToPath(new URL("atlas-all.png", out)));
for (const size of [192, 512]) {
  const squares = [
    [15, 33], [15, 44], [15, 55], [25, 33], [25, 44], [25, 55], [35, 44], [45, 44],
    [55, 33], [55, 44], [55, 55], [65, 33], [65, 44], [65, 55], [79, 61],
  ].map(([x, y], index) => `<rect x="${x}" y="${y}" width="7" height="7" rx="2" fill="${index === 14 ? "#fc4941" : "#f4f3f0"}"/>`).join("");
  const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100"><rect width="100" height="100" rx="23" fill="#101113"/>${squares}</svg>`;
  await sharp(Buffer.from(icon)).png().toFile(fileURLToPath(new URL(`icon-${size}.png`, out)));
}
