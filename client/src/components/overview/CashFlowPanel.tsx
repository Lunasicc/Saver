import { useMemo } from 'react';
import { Bar, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartBarIcon } from '@phosphor-icons/react';
import type { TrendPoint } from '../../lib/types';
import { currentMonth, formatMoney, formatMoneyCompact, formatMoneyWhole, monthLong, monthShort, shiftMonth } from '../../lib/format';
import { ChartTooltip } from '../ChartTooltip';
import { EmptyState } from '../EmptyState';
import { Panel } from '../Panel';

type CashPoint = TrendPoint & { label: string; net: number };

/** Twelve months of money in and out, with the net as a line. Click a month to jump to it. */
export function CashFlowPanel({ trends, month, onSelect }: { trends: TrendPoint[]; month: string; onSelect: (m: string) => void }) {
  const series = useMemo<CashPoint[]>(() => {
    const byMonth = new Map(trends.map((t) => [t.month, t]));
    // Window ends at the current month, or at the selected month if that's older than a year.
    const end = currentMonth() > shiftMonth(month, 11) ? month : currentMonth();
    return Array.from({ length: 12 }, (_, i) => {
      const m = shiftMonth(end, i - 11);
      const t = byMonth.get(m);
      const income = t?.income ?? 0;
      const spend = t?.spend ?? 0;
      return { month: m, label: monthShort(m), income, spend, net: Math.round((income - spend) * 100) / 100 };
    });
  }, [trends, month]);

  const withData = series.filter((p) => p.income > 0 || p.spend > 0);
  const avgSpend = withData.length ? withData.reduce((s, p) => s + p.spend, 0) / withData.length : 0;
  const avgNet = withData.length ? withData.reduce((s, p) => s + p.net, 0) / withData.length : 0;

  return (
    <Panel
      title="Cash flow"
      delay={0.25}
      action={
        <div className="legend">
          <span>
            <span className="legend-dot" style={{ background: 'var(--accent)' }} />
            In
          </span>
          <span>
            <span className="legend-dot" style={{ background: 'var(--chart-spend)' }} />
            Out
          </span>
          <span>
            <span className="legend-dot legend-dot--line" />
            Net
          </span>
        </div>
      }
    >
      {withData.length === 0 ? (
        <EmptyState icon={ChartBarIcon} title="No history yet" />
      ) : (
        <>
          <p className="small muted" style={{ marginTop: -8, marginBottom: 14 }}>
            Averaging <span className="num">{formatMoneyWhole(avgSpend)}</span> out and{' '}
            <span className={`num ${avgNet < 0 ? 'amount--bad' : 'amount--in'}`}>
              {avgNet < 0 ? '−' : '+'}
              {formatMoneyWhole(Math.abs(avgNet))}
            </span>{' '}
            net per month. Click a month to jump to it.
          </p>
          <div style={{ height: 240, marginLeft: -8 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={series} barGap={3} barCategoryGap="24%">
                <CartesianGrid vertical={false} stroke="var(--line)" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: 'var(--text-3)', fontSize: 12 }} />
                <YAxis
                  tickFormatter={(v: number) => formatMoneyCompact(v)}
                  tickLine={false}
                  axisLine={false}
                  width={52}
                  tick={{ fill: 'var(--text-3)', fontSize: 12 }}
                />
                <Tooltip
                  cursor={{ fill: 'var(--surface-2)' }}
                  content={({ active, payload }) => {
                    const p = active && payload?.[0]?.payload ? (payload[0].payload as CashPoint) : null;
                    if (!p) return null;
                    return (
                      <ChartTooltip
                        title={monthLong(p.month)}
                        rows={[
                          { label: 'In', value: formatMoney(p.income), color: 'var(--accent)' },
                          { label: 'Out', value: formatMoney(p.spend), color: 'var(--chart-spend)' },
                          { label: 'Net', value: formatMoney(p.net), color: 'var(--text)' },
                        ]}
                      />
                    );
                  }}
                />
                <Bar dataKey="income" radius={[4, 4, 0, 0]} onClick={(_, i) => onSelect(series[i].month)} cursor="pointer">
                  {series.map((p) => (
                    <Cell key={p.month} fill="var(--accent)" fillOpacity={p.month === month ? 1 : 0.35} />
                  ))}
                </Bar>
                <Bar dataKey="spend" radius={[4, 4, 0, 0]} onClick={(_, i) => onSelect(series[i].month)} cursor="pointer">
                  {series.map((p) => (
                    <Cell key={p.month} fill="var(--chart-spend)" fillOpacity={p.month === month ? 1 : 0.4} />
                  ))}
                </Bar>
                <Line
                  dataKey="net"
                  type="linear"
                  stroke="var(--text)"
                  strokeWidth={1.5}
                  strokeOpacity={0.8}
                  dot={{ r: 2.5, fill: 'var(--surface)', stroke: 'var(--text)', strokeWidth: 1.5 }}
                  activeDot={{ r: 4 }}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </Panel>
  );
}
