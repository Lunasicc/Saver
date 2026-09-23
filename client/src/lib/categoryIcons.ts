import type { Icon } from '@phosphor-icons/react';
import {
  AirplaneTiltIcon,
  ArrowsLeftRightIcon,
  BankIcon,
  CarIcon,
  ChartLineUpIcon,
  CoinsIcon,
  DotsThreeCircleIcon,
  FilmSlateIcon,
  ForkKnifeIcon,
  HeartbeatIcon,
  HouseIcon,
  LightningIcon,
  QuestionIcon,
  RepeatIcon,
  ShieldCheckIcon,
  ShoppingBagIcon,
  ShoppingCartIcon,
  TagIcon,
} from '@phosphor-icons/react';

const BY_NAME: Record<string, Icon> = {
  groceries: ShoppingCartIcon,
  'dining out': ForkKnifeIcon,
  transport: CarIcon,
  housing: HouseIcon,
  utilities: LightningIcon,
  entertainment: FilmSlateIcon,
  health: HeartbeatIcon,
  shopping: ShoppingBagIcon,
  subscriptions: RepeatIcon,
  travel: AirplaneTiltIcon,
  insurance: ShieldCheckIcon,
  'loan repayment': BankIcon,
  'investments & finances': ChartLineUpIcon,
  'transfers & fees': ArrowsLeftRightIcon,
  income: CoinsIcon,
  other: DotsThreeCircleIcon,
};

/** Maps a category to a consistent icon glyph; unknown/custom categories get a tag. */
export function iconForCategory(name: string | null | undefined): Icon {
  if (!name) return QuestionIcon;
  return BY_NAME[name.trim().toLowerCase()] ?? TagIcon;
}
