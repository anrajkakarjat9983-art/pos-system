import { money } from "./format";

export function LineChart({ labels, series, height = 220 }: { labels: string[]; series: { name: string; color: string; values: number[] }[]; height?: number }) {
  const w = 760;
  const pad = { l: 56, r: 12, t: 12, b: 24 };
  const all = series.flatMap((s) => s.values);
  const max = Math.max(1, ...all);
  const innerW = w - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const n = Math.max(1, labels.length - 1);

  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full">
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <g key={f}>
          <line x1={pad.l} x2={w - pad.r} y1={pad.t + innerH * (1 - f)} y2={pad.t + innerH * (1 - f)} stroke="#e2e8f0" />
          <text x={4} y={pad.t + innerH * (1 - f) + 4} fontSize="10" fill="#94a3b8">
            {max >= 1000 ? `${Math.round((max * f) / 1000)}k` : Math.round(max * f)}
          </text>
        </g>
      ))}
      {series.map((s) => (
        <polyline
          key={s.name}
          fill="none"
          stroke={s.color}
          strokeWidth="2"
          points={s.values.map((v, i) => `${pad.l + (innerW * i) / n},${pad.t + innerH * (1 - v / max)}`).join(" ")}
        />
      ))}
      {labels.map((l, i) =>
        i % Math.ceil(labels.length / 8 || 1) === 0 ? (
          <text key={i} x={pad.l + (innerW * i) / n} y={height - 6} fontSize="10" fill="#94a3b8" textAnchor="middle">
            {l.slice(5)}
          </text>
        ) : null
      )}
    </svg>
  );
}

export function HBars({ rows }: { rows: { label: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <div className="py-8 text-center text-sm text-slate-400">No data</div>;
  return (
    <div className="space-y-2.5">
      {rows.map((r, i) => (
        <div key={i}>
          <div className="mb-1 flex justify-between text-xs">
            <span className="truncate pr-2 text-slate-600">{r.label}</span>
            <span className="whitespace-nowrap font-medium text-slate-800">{money(r.value)}</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100">
            <div className="h-2 rounded-full bg-blue-500" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
