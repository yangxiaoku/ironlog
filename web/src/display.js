import { glyphPatterns } from "./matrix-data.js";
import { esc } from "./ui.js";

export function matrix(value) {
  const label = String(value);
  const dots = [];
  let advance = 0;
  for (const character of label.toUpperCase()) {
    const glyph = glyphPatterns[character];
    if (!glyph) return esc(label);
    const narrow = ".:,".includes(character);
    glyph.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        if (row[x] === "1") dots.push(`<circle cx="${advance + x + (narrow ? -0.5 : 0.5)}" cy="${y + 0.5}" r=".41"/>`);
      }
    });
    advance += narrow ? 3.1 : 6;
  }
  if (!dots.length) return esc(label);
  const width = advance - .7;
  return `<span class="matrix"><span class="visually-hidden">${esc(label)}</span><svg width="${width / 7}em" height="1em" viewBox="0 0 ${width} 7" aria-hidden="true" focusable="false">${dots.join("")}</svg></span>`;
}
