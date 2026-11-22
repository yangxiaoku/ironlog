import { glyphPatterns } from "@ironlog/shared/matrix";

interface DotPoint {
  cx: string;
  cy: string;
}

export function MatrixText({ value }: { value: string | number }) {
  const label = String(value);
  const dots: DotPoint[] = [];
  let advance = 0;

  for (const character of label.toUpperCase()) {
    const glyph = glyphPatterns[character];
    if (!glyph) return <>{label}</>;
    const narrow = ".:,".includes(character);
    glyph.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        if (row[x] === "1") {
          dots.push({
            cx: String(advance + x + (narrow ? -0.5 : 0.5)),
            cy: String(y + 0.5),
          });
        }
      }
    });
    advance += narrow ? 3.1 : 6;
  }

  if (!dots.length) return <>{label}</>;
  const width = advance - 0.7;

  return (
    <span className="matrix">
      <span className="visually-hidden">{label}</span>
      <svg
        width={`${width / 7}em`}
        height="1em"
        viewBox={`0 0 ${width} 7`}
        aria-hidden="true"
        focusable="false"
      >
        {dots.map((dot, idx) => (
          <circle key={idx} cx={dot.cx} cy={dot.cy} r="0.41" />
        ))}
      </svg>
    </span>
  );
}
