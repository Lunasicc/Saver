import { createElement } from 'react';
import {
  BankIcon,
  CreditCardIcon,
  PiggyBankIcon,
  ScalesIcon,
  StackIcon,
  TrendUpIcon,
  WalletIcon,
  type Icon,
  type IconProps,
} from '@phosphor-icons/react';

const ICONS: Record<string, Icon> = {
  checking: BankIcon,
  savings: PiggyBankIcon,
  credit: CreditCardIcon,
  loan: ScalesIcon,
  investment: TrendUpIcon,
  all: StackIcon,
};

/** Icon for an account type; "all" is the stack used for "All accounts". */
export function AccountTypeIcon({ type, ...props }: { type: string } & IconProps) {
  return createElement(ICONS[type] ?? WalletIcon, props);
}
