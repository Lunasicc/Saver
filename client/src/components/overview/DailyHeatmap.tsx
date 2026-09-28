import { useMemo, useState } from 'react';
import { CalendarBlankIcon } from '@phosphor-icons/react';
import type { DaySpend } from '../../lib/types';
import { formatMoney, formatMoneyWhole, ordinal } from '../../lib/format';
import { EmptyState } from '../EmptyState';
import { Panel } from '../Panel';
import { shortDate, type OverviewData } from './shared';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** 0 for no spend, then 1–4 by how the day compares with the month's busiest. */
function level(value: number, max: number) {
  if (value <= 0 || max <= 0) return 0;
  const r = value / max;
  if (r > 0.66) return 4;
  if (r > 0.33) return 3;
  if (r > 0.12) return 2;
  return 1;
}

/** Calendar heatmap of everyday spending, with weekday averages beneath. */
export function DailyHeatmap({ data, lastDay }: { data: OverviewData; lastDay: number }) {
  const { days } = data.daily;
  const [hover, setHover] = useState<DaySpend | null>(null);

  const stats = useMemo(() => {
    const elapsed = days.slice(0, lastDay);
    const max = Math.max(...elapsed.map((d) => d.everyday), 0);
    const busiest = elapsed.reduce<DaySpend | null>((best, d) => (d.everyday > (best?.everyday ?? 0) ? d : best), null);
    const noSpend = elapsed.filter((d) => d.everyday === 0).length;
    const total = elapsed.reduce((s, d) => s + d.everyday, 0);
    const byWeekday = WEEKDAYS.map(() => ({ total: 0, n: 0 }));
    for (const d of elapsed) {
      const w = weekday(d.date);
      byWeekday[w].total += d.everyday;
      byWeekday[w].n += 1;
    }
    const weekdayAvg = byWeekday.map((w) => (w.n ? w.total / w.n : 0));
    return { max, busiest, noSpend, avg: elapsed.length ? total / elapsed.length : 0, weekdayAvg, total };
  }, [days, lastDay]);

  const offset = days.length ? weekday(days[0].date) : 0;
  const maxWeekday = Math.max(...stats.weekdayAvg, 1);

  return (
    <Panel title="Daily spending" delay={0.15} action={<HeatLegend />}>
      {stats.total === 0 ? (
        <EmptyState icon={CalendarBlankIcon} title="No everyday spending yet">
          Each day of the month fills in as you spend.
        </EmptyState>
      ) : (
        <>
          <div className="heat" onMouseLeave={() => setHover(null)}>
            {WEEKDAYS.map((w) => (
              <span key={w} className="heat-head">
                {w.slice(0, 1)}
              </span>
            ))}
            {Array.from({ length: offset }, (_, i) => (
              <span key={`pad-${i}`} className="heat-pad" />
            ))}
            {days.map((d, i) => {
              const future = i >= lastDay;
              const lv = future ? -1 : level(d.everyday, stats.max);
              return (
                <button
                  key={d.date}
                  type="button"
                  className={`heat-cell heat-${future ? 'future' : lv}${hover?.date === d.date ? ' heat-cell--on' : ''}`}
                  disabled={future}
                  aria-label={`${shortDate(d.date)}: ${formatMoney(d.everyday)} everyday spending${d.fixed > 0 ? `, ${formatMoney(d.fixed)} in bills` : ''}`}
                  onMouseEnter={() => setHover(d)}
                  onFocus={() => setHover(d)}
                  onBlur={() => setHover(null)}
                >
                  <span className="heat-day">{i + 1}</span>
                  {d.fixed > 0 && !future && <span className="heat-bill" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
          <div className="heat-weekdays" aria-label="Average everyday spending by weekday">
            {stats.weekdayAvg.map((v, i) => (
              <div key={WEEKDAYS[i]} className="heat-weekday" title={`${WEEKDAYS[i]}: ${formatMoney(v)} on average`}>
                <div className="heat-weekday-bar" style={{ height: `${Math.max((v / maxWeekday) * 100, v > 0 ? 6 : 0)}%` }} />
              </div>
            ))}
          </div>
          <div className="heat-detail small" aria-live="polite">
            {hover ? (
              <>
                <strong>{shortDate(hover.date)}</strong>
                <span className="num">{formatMoney(hover.everyday)} everyday</span>
                {hover.top && (
                  <span className="muted">
                    most at {hover.top.merchant} ({formatMoneyWhole(hover.top.amount)})
                  </span>
                )}
                {hover.fixed > 0 && <span className="faint">+ {formatMoneyWhole(hover.fixed)} bills</span>}
              </>
            ) : (
              <>
                <span className="muted">
                  Avg <span className="num">{formatMoneyWhole(stats.avg)}</span>/day
                </span>
                {stats.busiest && (
                  <span className="muted">
                    Busiest: the {ordinal(Number(stats.busiest.date.slice(8, 10)))}{' '}
                    <span className="num">({formatMoneyWhole(stats.busiest.everyday)})</span>
                  </span>
                )}
                <span className="muted">
                  {stats.noSpend} no-spend day{stats.noSpend === 1 ? '' : 's'}
                </span>
              </>
            )}
          </div>
        </>
      )}
    </Panel>
  );
}

function HeatLegend() {
  return (
    <span className="heat-legend small faint" aria-hidden="true">
      Less
      {[0, 1, 2, 3, 4].map((l) => (
        <span key={l} className={`heat-swatch heat-${l}`} />
      ))}
      More
    </span>
  );
}

/** Monday = 0 … Sunday = 6. */
function weekday(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return (new Date(y, m - 1, d).getDay() + 6) % 7;
}
