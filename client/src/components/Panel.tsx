import { motion } from 'framer-motion';
import type { CSSProperties, ReactNode } from 'react';

type Props = {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  delay?: number;
  className?: string;
  style?: CSSProperties;
};

/** A surface for a group of related content. Fades in once; never bounces on hover. */
export function Panel({ title, action, children, flush = false, delay = 0, className = '', style }: Props) {
  return (
    <motion.section
      className={`panel${flush ? ' panel--flush' : ''} ${className}`}
      style={style}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {(title || action) && (
        <header className="panel-head" style={flush ? { padding: '20px 22px 0' } : undefined}>
          {typeof title === 'string' ? <h2 className="panel-title">{title}</h2> : title}
          {action}
        </header>
      )}
      {children}
    </motion.section>
  );
}
