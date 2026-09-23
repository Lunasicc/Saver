import { useCallback, useEffect, useState } from 'react';
import { TelevisionIcon } from '@phosphor-icons/react';
import { api } from '../lib/api';
import type { SubscriptionsReport } from '../lib/types';
import { formatDate, formatMoney } from '../lib/format';
import { AnimatedNumber } from '../components/AnimatedNumber';
import { CategoryIcon } from '../components/CategoryIcon';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { Panel } from '../components/Panel';
import { Skeleton, SkeletonList } from '../components/Skeleton';

export function Subscriptions() {
  const [months, setMonths] = useState(6);
  const [report, setReport] = useState<SubscriptionsReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    // Clear stale data so a slow reload can't show the previous period's numbers.
    setReport(null);
    api
      .get<SubscriptionsReport>(`/reports/subscriptions?months=${months}`)
      .then(setReport)
      .catch((err: Error) => setError(err.message));
  }, [months]);

  useEffect(load, [load]);

  const yearly = (report?.totalMonthlyCost ?? 0) * 12;

  return (
    <div className="stack">
      <div className="section-head" style={{ marginBottom: 0, alignItems: 'center' }}>
        <div>
          <h2 className="section-title">Subscriptions</h2>
          <p className="section-sub">Everything charged to your Subscriptions category. Spot the ones you forgot about.</p>
        </div>
        <select value={months} aria-label="Reporting period" onChange={(e) => setMonths(Number(e.target.value))}>
          <option value={3}>Last 3 months</option>
          <option value={6}>Last 6 months</option>
          <option value={12}>Last 12 months</option>
        </select>
      </div>

      {error && <ErrorBanner message={error} onRetry={load} />}

      <Panel>
        <div className="budget-summary">
          <div>
            <div className="stat-label">Per month</div>
            <div className="stat-value">
              {report ? <AnimatedNumber value={report.totalMonthlyCost} /> : <Skeleton width={120} height={24} />}
            </div>
          </div>
          <div>
            <div className="stat-label">Per year</div>
            <div className="stat-value">{report ? formatMoney(yearly) : <Skeleton width={120} height={24} />}</div>
          </div>
          <div>
            <div className="stat-label">Services</div>
            <div className="stat-value">{report ? report.subscriptions.length : <Skeleton width={40} height={24} />}</div>
          </div>
        </div>
      </Panel>

      <Panel flush>
        {!report ? (
          !error && (
            <div style={{ padding: 22 }}>
              <SkeletonList rows={5} />
            </div>
          )
        ) : report.subscriptions.length === 0 ? (
          <EmptyState icon={TelevisionIcon} title="No subscriptions found">
            Nothing was charged to Subscriptions in the last {report.months} months.
          </EmptyState>
        ) : (
          <div style={{ padding: '6px 0' }}>
            {report.subscriptions.map((s) => (
              <div key={s.merchant} className="tx-row sub-row">
                <CategoryIcon name={s.category_name} color={s.category_color} />
                <div className="list-main">
                  <div className="list-title">{s.merchant}</div>
                  <div className="list-meta">
                    {s.charge_count} charge{s.charge_count === 1 ? '' : 's'} · {formatMoney(s.total_spent)} total · last{' '}
                    {formatDate(s.last_charged)}
                  </div>
                </div>
                <span className="tx-amount amount">
                  {formatMoney(s.estimated_monthly_cost)}
                  <span className="faint small">/mo</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
