import { Link } from 'react-router-dom';
import { ArrowsDownUpIcon } from '@phosphor-icons/react';
import { formatMoneyWhole, monthShort } from '../../lib/format';
import { CategoryIcon } from '../CategoryIcon';
import { EmptyState } from '../EmptyState';
import { Panel } from '../Panel';
import { txLink, type OverviewData } from './shared';

const ROWS = 6;

/**
 * This month's everyday categories against their usual month (the average of
 * the months before), with a six-month mini chart for each.
 */
export function ComparedWithUsual({ data, month, isCurrent }: { data: OverviewData; month: string; isCurrent: boolean }) {
  const { categories, months, monthsOfHistory } = data.history;
  const rows = categories
    .filter((c) => !c.is_fixed && (c.current > 0 || (c.usual ?? 0) > 0))
    .sort((a, b) => Math.max(b.current, b.usual ?? 0) - Math.max(a.current, a.usual ?? 0))
    .slice(0, ROWS);

  return (
    <Panel
      title="Compared with usual"
      delay={0.2}
      action={<span className="small faint">{months.length > 1 ? `${monthShort(months[0])} – ${monthShort(months[months.length - 1])}` : ''}</span>}
    >
      {monthsOfHistory < 1 || rows.length === 0 ? (
        <EmptyState icon={ArrowsDownUpIcon} title="Not enough history yet">
          Once there's a couple of months of spending, this shows which categories are running above or below normal.
        </EmptyState>
      ) : (
        <>
          <div className="list">
            {rows.map((c) => {
              const peak = Math.max(...c.totals, 1);
              const usual = c.usual ?? 0;
              const diff = c.current - usual;
              const tone = usual === 0 ? 'new' : Math.abs(diff) < Math.max(10, usual * 0.1) ? 'flat' : diff > 0 ? 'up' : 'down';
              return (
                <Link key={c.category_id} to={txLink(month, c.category_id)} className="list-row list-row--link usual-row">
                  <CategoryIcon name={c.name} color={c.color} icon={c.icon} size={30} />
                  <div className="list-main">
                    <div className="list-title">{c.name}</div>
                    <div className="list-meta">
                      {usual > 0 ? `Usually ${formatMoneyWhole(usual)}` : 'New this month'}
                    </div>
                  </div>
                  <div className="spark" aria-hidden="true">
                    {c.totals.map((t, i) => (
                      <span
                        key={months[i]}
                        className="spark-bar"
                        title={`${monthShort(months[i])}: ${formatMoneyWhole(t)}`}
                        style={{
                          height: `${Math.max((t / peak) * 100, t > 0 ? 8 : 3)}%`,
                          background: i === c.totals.length - 1 ? c.color : 'var(--surface-3)',
                        }}
                      />
                    ))}
                  </div>
                  <div className="usual-figures">
                    <span className="amount num">{formatMoneyWhole(c.current)}</span>
                    <span className={`usual-diff usual-diff--${tone} num`}>
                      {tone === 'new'
                        ? 'new'
                        : tone === 'flat'
                          ? 'about usual'
                          : `${diff > 0 ? '+' : '−'}${formatMoneyWhole(Math.abs(diff))}`}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
          <p className="small faint" style={{ margin: '12px 0 0' }}>
            {isCurrent ? 'This month so far, against' : 'Against'} the average of the{' '}
            {monthsOfHistory === 1 ? 'month' : `${monthsOfHistory} months`} before. Bills are left out.
          </p>
        </>
      )}
    </Panel>
  );
}
