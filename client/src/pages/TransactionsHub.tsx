import { ListBulletsIcon, RobotIcon, UploadSimpleIcon } from '@phosphor-icons/react';
import { Tabs, useTab, type TabDef } from '../components/Tabs';
import { FocusNote } from '../components/AccountSwitcher';
import { TransactionsFeed } from './Transactions';
import { ImportCsv } from './ImportCsv';
import { MerchantRules } from './MerchantRules';

const TABS: TabDef[] = [
  { id: 'all', label: 'All', icon: ListBulletsIcon },
  { id: 'import', label: 'Import', icon: UploadSimpleIcon },
  { id: 'rules', label: 'Rules', icon: RobotIcon },
];

export function TransactionsHub() {
  const [tab, setTab] = useTab(TABS);
  return (
    <div>
      <header className="page-head">
        <div>
          <h1 className="page-title">Transactions</h1>
          <p className="page-sub">Every dollar in and out, sorted by business and category.</p>
          {tab !== 'rules' && <FocusNote />}
        </div>
        <Tabs tabs={TABS} active={tab} onSelect={setTab} label="Transactions sections" />
      </header>
      {tab === 'all' && <TransactionsFeed />}
      {tab === 'import' && <ImportCsv />}
      {tab === 'rules' && <MerchantRules />}
    </div>
  );
}
