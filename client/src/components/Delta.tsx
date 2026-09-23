import { ArrowDownRightIcon, ArrowUpRightIcon } from '@phosphor-icons/react';
import { formatMoneyWhole } from '../lib/format';

/**
 * Month-over-month change. `higherIsGood` flips the colouring: more income is
 * good, more spending is bad.
 */
export function Delta({
  value,
  higherIsGood,
  suffix = 'vs last month',
}: {
  value: number;
  higherIsGood: boolean;
  suffix?: string;
}) {
  if (Math.abs(value) < 0.5) return <span className="delta delta--flat">No change {suffix}</span>;
  const up = value > 0;
  const good = up === higherIsGood;
  const Arrow = up ? ArrowUpRightIcon : ArrowDownRightIcon;
  return (
    <span className={`delta ${good ? 'delta--good' : 'delta--bad'}`}>
      <Arrow size={14} weight="bold" />
      <span className="num">{formatMoneyWhole(Math.abs(value))}</span>
      <span className="faint" style={{ fontWeight: 400 }}>
        {up ? 'more' : 'less'} {suffix}
      </span>
    </span>
  );
}
