import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRightIcon, StorefrontIcon } from '@phosphor-icons/react';
import { formatMoney, formatMoneyWhole } from '../../lib/format';
import { CategoryIcon } from '../CategoryIcon';
import { EmptyState } from '../EmptyState';
import { Panel } from '../Panel';
import { plural, shortDate, type OverviewData } from './shared';

const COLLAPSED = 7;

type View = 'places' | 'spends';

/**
 * Where the everyday money went: the places you spend at most, or the biggest
 * single purchases. Bills and regular commitments are left out so a rent
 * payment doesn't drown out the café you visit three times a week.
 */
export function TopSpendingPanel({ data }: { data: OverviewData }) {
  const [view, setView] = useState<View>('places');
  const [showAll, setShowAll] = useState(false);
  const { places, spends, placeCount, everydayTotal, excluded } = data.top;
  const list = view === 'places' ? places : spends;
  const limit = showAll ? list.length : COLLAPSED;
  const maxPlace = Math.max(...places.map((p) => p.total), 1);

  const excludedNames = excluded.categories.map((c) => c.name);
  const namesText =
    excludedNames.length <= 2
      ? excludedNames.join(' and ')
      : `${excludedNames.slice(0, 2).join(', ')} and ${excludedNames.length - 2} more`;

  return (
    <Panel
      title="Top spending"
      delay={0.1}
      action={
        <div className="seg" role="tablist" aria-label="Top spending view">
          {(
            [
              ['places', 'Places'],
              ['spends', 'Biggest spends'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={view === id}
              className={`seg-btn${view === id ? ' seg-btn--on' : ''}`}
              onClick={() => {
                setView(id);
                setShowAll(false);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      }
    >
      {list.length === 0 ? (
        <EmptyState icon={StorefrontIcon} title="No everyday spending yet">
          Spending at shops, cafés and the like shows up here. Bills and regular payments are left out.
        </EmptyState>
      ) : (
        <>
          <p className="small muted" style={{ marginTop: -6, marginBottom: 8 }}>
            {view === 'places' ? (
              <>
                <span className="num">{formatMoneyWhole(everydayTotal)}</span> of everyday spending across{' '}
                {plural(placeCount, 'place')}.
              </>
            ) : (
              <>Your largest one-off purchases this month.</>
            )}
          </p>
          <div className="list">
            {view === 'places'
              ? places.slice(0, limit).map((p, i) => (
                  <div key={p.merchant} className="list-row top-row">
                    <span className="rank">{i + 1}</span>
                    <CategoryIcon name={p.category_name} color={p.category_color} icon={p.category_icon} size={30} />
                    <div className="list-main">
                      <div className="list-title">{p.merchant}</div>
                      <div className="list-meta">
                        {p.count === 1 ? `Once · ${shortDate(p.last_date)}` : `${p.count} visits · avg ${formatMoney(p.average)}`}
                      </div>
                      <div className="top-share">
                        <div
                          className="top-share-fill"
                          style={{ width: `${(p.total / maxPlace) * 100}%`, background: p.category_color ?? 'var(--chart-spend)' }}
                        />
                      </div>
                    </div>
                    <div className="top-amount">
                      <span className="amount num">{formatMoney(p.total)}</span>
                      <span className="faint small num">{Math.round(p.share * 100)}%</span>
                    </div>
                  </div>
                ))
              : spends.slice(0, limit).map((s) => (
                  <div key={s.id} className="list-row">
                    <CategoryIcon name={s.category_name} color={s.category_color} icon={s.category_icon} size={30} />
                    <div className="list-main">
                      <div className="list-title">{s.merchant}</div>
                      <div className="list-meta">
                        {shortDate(s.date)}
                        {s.category_name ? ` · ${s.category_name}` : ''}
                      </div>
                    </div>
                    <span className="amount num">{formatMoney(s.amount)}</span>
                  </div>
                ))}
          </div>
          {list.length > COLLAPSED && (
            <button className="btn btn-ghost btn-sm" style={{ marginTop: 10, width: '100%' }} onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Show fewer' : `Show top ${list.length}`}
            </button>
          )}
        </>
      )}
      {excluded.count > 0 && (
        <div className="top-foot small">
          <span className="muted">
            Leaves out <span className="num">{formatMoneyWhole(excluded.total)}</span> of bills and commitments
            {namesText ? ` (${namesText})` : ''}.
          </span>
          <Link to="/transactions?tab=categories" className="panel-link">
            Choose what counts <ArrowRightIcon size={12} weight="bold" />
          </Link>
        </div>
      )}
    </Panel>
  );
}
