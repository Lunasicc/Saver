import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import { ArrowRightIcon, CaretDownIcon, ChartDonutIcon } from '@phosphor-icons/react';
import { formatMoney, formatMoneyWhole, monthLong } from '../../lib/format';
import { CategoryIcon } from '../CategoryIcon';
import { EmptyState } from '../EmptyState';
import { Panel } from '../Panel';
import { plural, txLink, type OverviewData } from './shared';

const COLLAPSED = 7;
const UNCATEGORIZED = 'var(--warning)';

type Slice = { key: string; name: string; value: number; color: string };

export function WhereItWent({ data, month }: { data: OverviewData; month: string }) {
  const { categories, uncategorized, spend } = data.snapshot;
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [active, setActive] = useState<string | null>(null);

  const budgetByCategory = useMemo(() => new Map(data.budgets.map((b) => [b.category_id, b.amount])), [data.budgets]);
  const slices = useMemo<Slice[]>(() => {
    const list = categories.map((c) => ({ key: String(c.category_id), name: c.name, value: c.total, color: c.color }));
    if (uncategorized.total > 0) list.push({ key: 'u', name: 'Uncategorized', value: uncategorized.total, color: UNCATEGORIZED });
    return list.sort((a, b) => b.value - a.value);
  }, [categories, uncategorized.total]);

  const focused = slices.find((s) => s.key === active);
  const shown = showAll ? categories : categories.slice(0, COLLAPSED);
  const hidden = categories.length - shown.length;
  const max = Math.max(...categories.map((c) => c.total), uncategorized.total, 1);

  const toggle = (id: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Panel
      title="Where it went"
      delay={0.05}
      action={
        <Link to={`/transactions?month=${month}`} className="panel-link">
          All transactions <ArrowRightIcon size={13} weight="bold" />
        </Link>
      }
    >
      {slices.length === 0 ? (
        <EmptyState icon={ChartDonutIcon} title="No spending this month">
          Nothing has gone out in {monthLong(month)} yet.
        </EmptyState>
      ) : (
        <div className="where">
          <div className="donut" onMouseLeave={() => setActive(null)}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={slices}
                  dataKey="value"
                  nameKey="name"
                  innerRadius="72%"
                  outerRadius="100%"
                  paddingAngle={slices.length > 1 ? 1.5 : 0}
                  cornerRadius={3}
                  stroke="none"
                  startAngle={90}
                  endAngle={-270}
                  isAnimationActive={false}
                  onMouseEnter={(_, i) => setActive(slices[i]?.key ?? null)}
                >
                  {slices.map((s) => (
                    <Cell key={s.key} fill={s.color} fillOpacity={active && active !== s.key ? 0.25 : 1} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="donut-centre" aria-live="polite">
              <span className="donut-label">{focused ? focused.name : 'Total spent'}</span>
              <span className="donut-value num">{formatMoneyWhole(focused ? focused.value : spend)}</span>
              {focused && spend > 0 && <span className="donut-label">{Math.round((focused.value / spend) * 100)}%</span>}
            </div>
          </div>

          <div className="list where-list">
            {shown.map((c) => {
              const budget = budgetByCategory.get(c.category_id);
              const over = budget !== undefined && Math.round(c.total * 100) > Math.round(budget * 100);
              const pct = budget ? c.total / budget : c.total / max;
              const expanded = open.has(c.category_id);
              const dim = active !== null && active !== String(c.category_id);
              return (
                <div
                  key={c.category_id}
                  className={`where-item${dim ? ' where-item--dim' : ''}`}
                  onMouseEnter={() => setActive(String(c.category_id))}
                  onMouseLeave={() => setActive(null)}
                >
                  <div className="where-row">
                    <Link to={txLink(month, c.category_id)} className="where-link">
                      <CategoryIcon name={c.name} color={c.color} icon={c.icon} size={30} />
                      <div className="list-main">
                        <div className="where-line">
                          <span className="list-title">{c.name}</span>
                          <span className="amount num">{formatMoney(c.total)}</span>
                        </div>
                        <div className="bar" style={{ margin: '6px 0 5px', height: 4 }}>
                          <div
                            className="bar-fill"
                            style={{
                              width: `${Math.min(pct, 1) * 100}%`,
                              background: over ? 'var(--danger)' : c.color,
                            }}
                          />
                        </div>
                        <div className="list-meta">
                          {Math.round(c.pct * 100)}% · {plural(c.count, 'transaction')}
                          {c.is_fixed ? ' · bill' : ''}
                          {budget !== undefined && (
                            <span className={over ? 'amount--bad' : undefined}>
                              {' '}
                              · {over ? `${formatMoneyWhole(c.total - budget)} over` : `of ${formatMoneyWhole(budget)}`} budget
                            </span>
                          )}
                        </div>
                      </div>
                    </Link>
                    {c.children.length > 0 ? (
                      <button
                        className={`btn btn-icon where-caret${expanded ? ' where-caret--open' : ''}`}
                        aria-expanded={expanded}
                        aria-label={`${expanded ? 'Hide' : 'Show'} ${c.name} sub-categories`}
                        onClick={() => toggle(c.category_id)}
                      >
                        <CaretDownIcon size={16} weight="bold" />
                      </button>
                    ) : (
                      <span className="where-caret-spacer" />
                    )}
                  </div>
                  {expanded && (
                    <div className="where-children">
                      {c.children.map((child) => (
                        <Link key={child.category_id} to={txLink(month, child.category_id)} className="where-child">
                          <span className="legend-dot" style={{ background: child.color }} />
                          <span className="where-child-name">{child.name}</span>
                          <span className="faint small num">{c.total > 0 ? Math.round((child.total / c.total) * 100) : 0}%</span>
                          <span className="num">{formatMoney(child.total)}</span>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {uncategorized.count > 0 && (
              <div className={`where-item${active !== null && active !== 'u' ? ' where-item--dim' : ''}`}>
                <div className="where-row">
                  <Link
                    to={txLink(month, 'uncategorized')}
                    className="where-link"
                    onMouseEnter={() => setActive('u')}
                    onMouseLeave={() => setActive(null)}
                  >
                    <CategoryIcon name={null} size={30} />
                    <div className="list-main">
                      <div className="where-line">
                        <span className="list-title">Uncategorized</span>
                        <span className="amount num">{formatMoney(uncategorized.total)}</span>
                      </div>
                      <div className="bar" style={{ margin: '6px 0 5px', height: 4 }}>
                        <div className="bar-fill" style={{ width: `${(uncategorized.total / max) * 100}%`, background: UNCATEGORIZED }} />
                      </div>
                      <div className="list-meta">
                        {spend > 0 ? Math.round((uncategorized.total / spend) * 100) : 0}% · {uncategorized.count} to sort
                      </div>
                    </div>
                  </Link>
                  <span className="where-caret-spacer" />
                </div>
              </div>
            )}
            {(hidden > 0 || showAll) && categories.length > COLLAPSED && (
              <button className="btn btn-ghost btn-sm" style={{ marginTop: 10, width: '100%' }} onClick={() => setShowAll((v) => !v)}>
                {showAll ? 'Show fewer' : `Show ${hidden} more`}
              </button>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}
