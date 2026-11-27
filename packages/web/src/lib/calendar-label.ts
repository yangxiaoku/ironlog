const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter("zh", { granularity: "grapheme" }) : null;
const characters = (text: string) => segmenter
  ? Array.from(segmenter.segment(text), ({ segment }) => segment)
  : Array.from(text);

export function fullWorkoutTag(title: string): string {
  const clean = title.replace(/\s*等\s*\d+\s*项$/, "").trim()
    .replace(/\s*·\s*/g, "·").replace(/传统力量训练/, "力量训练").replace(/高强度间歇/, "HIIT");
  const limit = /\p{Script=Han}/u.test(clean) ? 5 : 10;
  const parts = characters(clean);
  if (parts.length <= limit) return clean;
  const [head, tail] = clean.split("·");
  const detail = characters(tail?.replace(/[和与及]/g, "") ?? "").slice(0, 2);
  if (!head || !detail.length) return parts.slice(0, limit).join("");
  return `${characters(head).slice(0, limit - detail.length - 1).join("")}·${detail.join("")}`;
}

export function compactWorkoutTag(title: string): string {
  const clean = title.replace(/\s*等\s*\d+\s*项$/, "").trim();
  const [head, tail] = clean.split(/\s*[·\-/]\s*/);
  if (head && tail && characters(head).length <= 2) return head;
  if (clean.includes("力量训练")) return "力";
  if (clean.includes("有氧")) return "氧";
  if (clean.includes("高强度间歇")) return "HIIT";
  if (clean.includes("功能性力量")) return "功能";
  return characters(clean).slice(0, 2).join("");
}
