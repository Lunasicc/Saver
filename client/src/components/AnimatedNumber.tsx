import { useEffect } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { formatMoney } from '../lib/format';

type Props = {
  value: number;
  currency?: string;
  /** Render the cents in a smaller, muted span — for large headline figures. */
  splitCents?: boolean;
};

// Smoothly counts to the target whenever it changes.
export function AnimatedNumber({ value, currency = 'NZD', splitCents = false }: Props) {
  const motionValue = useMotionValue(value);
  const spring = useSpring(motionValue, { stiffness: 140, damping: 24, mass: 0.6 });
  const full = useTransform(spring, (v) => formatMoney(v, currency));
  const whole = useTransform(full, (s) => s.replace(/\.\d{2}$/, ''));
  const cents = useTransform(full, (s) => s.match(/\.\d{2}$/)?.[0] ?? '');

  useEffect(() => {
    motionValue.set(value);
  }, [value, motionValue]);

  if (!splitCents) return <motion.span className="num">{full}</motion.span>;
  return (
    <span className="num" aria-label={formatMoney(value, currency)}>
      <motion.span aria-hidden="true">{whole}</motion.span>
      <motion.span
        aria-hidden="true"
        style={{ fontSize: '0.45em', color: 'var(--text-3)', letterSpacing: '-0.01em', marginLeft: '0.04em' }}
      >
        {cents}
      </motion.span>
    </span>
  );
}
