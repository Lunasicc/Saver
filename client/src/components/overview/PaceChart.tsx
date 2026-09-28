import { useMemo } from 'react';
import { Area, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DailySpending } from '../../lib/types';
import { formatMoney, formatMoneyWhole, monthShort, ordinal } from '../../lib/format';
import { ChartTooltip } from '../ChartTooltip';

type Point = { day: number; current: number | null; previous: number | null };

/**
 * Running total of everyday spending through the month, against the same point
 * last month. Bills are left out so the line reflects day-to-day choices.
 */
export function PaceChart({ daily, lastDay }: { daily: DailySpending; lastDay: number }) {
  const series = useMemo<Point[]>(() => {
    const length = Math.max(daily.days.length, daily.previous.length);
    let now = 0;
    let before = 0;
    return Array.from({ length }, (_, i) => {
      now += daily.days[i]?.everyday ?? 0;
      before += daily.previous[i]?.everyday ?? 0;
      return {
        day: i + 1,
        current: i < lastDay && i < daily.days.length ? Math.round(now * 100) / 100 : null,
        previous: i < daily.previous.length ? Math.round(before * 100) / 100 : null,
      };
    });
  }, [daily, lastDay]);

  const at = series[Math.min(lastDay, series.length) - 1];
  const previousAt = series[Math.min(lastDay, daily.previous.length) - 1]?.previous ?? 0;
  const currentAt = at?.current ?? 0;
  const diff = currentAt - previousAt;
  const hasHistory = daily.previous.some((d) => d.everyday > 0);
  const thisLabel = monthShort(daily.month);
  const lastLabel = monthShort(daily.previousMonth);

  return (
    <div className="pace">
      <div className="pace-head">
        <span className="stat-label" style={{ margin: 0 }}>
          Everyday spending pace
        </span>
        <span className="legend">
          <span>
            <span className="legend-dot" style={{ background: 'var(--accent)' }} />
            {thisLabel}
          </span>
          {hasHistory && (
            <span>
              <span className="legend-dot legend-dot--dashed" />
              {lastLabel}
            </span>
          )}
        </span>
      </div>
      <div className="pace-chart">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={series} margin={{ top: 6, right: 4, bottom: 0, left: 4 }}>
            <defs>
              <linearGradient id="pace-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.28} />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="day"
              ticks={[1, 8, 15, 22, 29]}
              tickLine={false}
              axisLine={false}
              tick={{ fill: 'var(--text-3)', fontSize: 11 }}
            />
            <YAxis hide domain={[0, 'dataMax']} />
            <Tooltip
              cursor={{ stroke: 'var(--line-strong)' }}
              content={({ active, payload }) => {
                const p = active && payload?.[0]?.payload ? (payload[0].payload as Point) : null;
                if (!p) return null;
                const rows = [];
                if (p.current !== null) rows.push({ label: thisLabel, value: formatMoney(p.current), color: 'var(--accent)' });
                if (hasHistory && p.previous !== null) rows.push({ label: lastLabel, value: formatMoney(p.previous), color: 'var(--text-3)' });
                return <ChartTooltip title={`By the ${ordinal(p.day)}`} rows={rows} />;
              }}
            />
            {hasHistory && (
              <Line
                dataKey="previous"
                type="monotone"
                stroke="var(--text-3)"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                dot={false}
                activeDot={false}
                isAnimationActive={false}
              />
            )}
            <Area
              dataKey="current"
              type="monotone"
              stroke="var(--accent)"
              strokeWidth={2}
              fill="url(#pace-fill)"
              dot={false}
              activeDot={{ r: 3.5, fill: 'var(--accent)', stroke: 'var(--surface)' }}
              connectNulls={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="small muted" style={{ margin: '8px 0 0' }}>
        {!hasHistory ? (
          <>
            <span className="num">{formatMoneyWhole(currentAt)}</span> on everyday spending so far.
          </>
        ) : Math.abs(diff) < 1 ? (
          <>Right on last month's pace.</>
        ) : (
          <>
            <span className={`num ${diff > 0 ? 'amount--bad' : 'amount--in'}`}>{formatMoneyWhole(Math.abs(diff))}</span>{' '}
            {diff > 0 ? 'more' : 'less'} than by the {ordinal(Math.min(lastDay, daily.previous.length))} last month.
          </>
        )}
      </p>
    </div>
  );
}
