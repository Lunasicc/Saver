import { CalendarCheckIcon, TargetIcon, TelevisionIcon } from '@phosphor-icons/react';
import { Tabs, useTab, type TabDef } from '../components/Tabs';
import { FocusNote } from '../components/AccountSwitcher';
import { Budgets } from './Budgets';
import { RecurringBills } from './RecurringBills';
import { Subscriptions } from './Subscriptions';

const TABS: TabDef[] = [
  { id: 'budgets', label: 'Budgets', icon: TargetIcon },
  { id: 'bills', label: 'Bills', icon: CalendarCheckIcon },
  { id: 'subscriptions', label: 'Subscriptions', icon: TelevisionIcon },
];

export function Planning() {
  const [tab, setTab] = useTab(TABS);
  return (
    <div>
      <header className="page-head">
        <div>
          <h1 className="page-title">Planning</h1>
          <p className="page-sub">Budgets for the month, and the bills and subscriptions you’ve already signed up for.</p>
          <FocusNote detail={tab === 'budgets' ? 'Budgets are shared by all accounts.' : undefined} />
        </div>
        <Tabs tabs={TABS} active={tab} onSelect={setTab} label="Planning sections" />
      </header>
      {tab === 'budgets' && <Budgets />}
      {tab === 'bills' && <RecurringBills />}
      {tab === 'subscriptions' && <Subscriptions />}
    </div>
  );
}
