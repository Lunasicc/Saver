import type { ReactNode } from 'react';

/** Shared dark tooltip body for Recharts charts. */
export function ChartTooltip({ title, rows }: { title: ReactNode; rows: { label: string; value: string; color?: string }[] }) {
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-title">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="row" style={{ justifyContent: 'space-between', gap: 18 }}>
          <span className="row" style={{ gap: 6 }}>
            {r.color && <span className="legend-dot" style={{ background: r.color }} />}
            <span className="muted">{r.label}</span>
          </span>
          <span className="num">{r.value}</span>
        </div>
      ))}
    </div>
  );
}
