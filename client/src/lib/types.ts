export type Account = {
  id: number;
  name: string;
  type: string;
  institution: string | null;
  currency: string;
  starting_balance: number;
  current_balance: number;
  is_liability: number;
  akahu_account_id: string | null;
  akahu_status?: 'ACTIVE' | 'INACTIVE' | null;
  akahu_logo?: string | null;
  account_mask?: string | null;
  created_at: string;
};

export type Category = {
  id: number;
  name: string;
  icon: string;
  color: string;
  is_income: number;
};

export type Transaction = {
  id: number;
  account_id: number;
  date: string;
  description: string;
  amount: number;
  category_id: number | null;
  merchant: string | null;
  note: string | null;
  source: 'manual' | 'csv' | 'akahu';
};

export type Budget = {
  id: number;
  category_id: number;
  month: string;
  amount: number;
  category_name: string;
  category_icon: string;
  category_color: string;
  spent: number;
};

export type RecurringBill = {
  id: number;
  name: string;
  amount: number;
  category_id: number | null;
  account_id: number | null;
  due_day: number;
  frequency: string;
  active: number;
  category_name: string | null;
  category_icon: string | null;
  category_color: string | null;
  account_name: string | null;
};

export type Summary = {
  assets: number;
  liabilities: number;
  netWorth: number;
  month: string;
  income: number;
  spend: number;
};

export type TrendPoint = {
  month: string;
  income: number;
  spend: number;
};

export type CategorySpend = {
  category_id: number;
  name: string;
  color: string;
  icon: string;
  total: number;
};

export type NetWorthSnapshot = {
  id: number;
  date: string;
  total_assets: number;
  total_liabilities: number;
  net_worth: number;
};

export type MonthlyCategoryBreakdown = CategorySpend & { count: number; pct: number };

export type MonthlyMerchantBreakdown = {
  merchant: string;
  total: number;
  count: number;
};

export type MonthlySnapshot = {
  month: string;
  previousMonth: string;
  income: number;
  spend: number;
  net: number;
  previous: { income: number; spend: number; net: number };
  delta: { income: number; spend: number; net: number };
  categories: MonthlyCategoryBreakdown[];
  uncategorized: { total: number; count: number };
  merchants: MonthlyMerchantBreakdown[];
};

export type MerchantRule = {
  id: number;
  pattern: string;
  match_type: 'exact' | 'contains';
  merchant_name: string;
  category_id: number;
  category_name: string;
  category_icon: string;
  category_color: string;
  created_at: string;
};

export type SubscriptionEntry = {
  merchant: string;
  category_id: number;
  category_name: string;
  category_icon: string;
  category_color: string;
  charge_count: number;
  total_spent: number;
  avg_amount: number;
  last_charged: string;
  first_charged: string;
  estimated_monthly_cost: number;
};

export type SubscriptionsReport = {
  months: number;
  totalMonthlyCost: number;
  subscriptions: SubscriptionEntry[];
};

export type BudgetSuggestion = {
  category_id: number;
  category_name: string;
  category_icon: string;
  category_color: string;
  suggested_amount: number;
  median_monthly: number;
  average_monthly: number;
  min_monthly: number;
  max_monthly: number;
  months_with_spend: number;
  months_considered: number;
  existing_amount: number | null;
  recommended: boolean;
};

export type BudgetSuggestionsReport = {
  month: string;
  lookback: number;
  monthsConsidered: string[];
  totalSuggested: number;
  suggestions: BudgetSuggestion[];
};

export type RecurringCandidate = {
  name: string;
  amount: number;
  frequency: 'weekly' | 'fortnightly' | 'monthly' | 'yearly';
  median_gap_days: number;
  occurrences: number;
  total_spent: number;
  first_charged: string;
  last_charged: string;
  next_expected: string;
  due_day: number;
  account_id: number | null;
  category_id: number | null;
  category_name: string | null;
  category_icon: string | null;
  category_color: string | null;
  amount_varies: boolean;
  confidence: number;
  already_tracked: boolean;
};

export type RecurringDetectionReport = {
  months: number;
  minOccurrences: number;
  detected: number;
  candidates: RecurringCandidate[];
};
