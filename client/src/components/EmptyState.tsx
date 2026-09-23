import type { Icon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

export function EmptyState({
  icon: Glyph,
  title,
  children,
  action,
}: {
  icon: Icon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Glyph size={22} weight="duotone" />
      </span>
      <div className="empty-title">{title}</div>
      {children && <p>{children}</p>}
      {action && <div style={{ marginTop: 6 }}>{action}</div>}
    </div>
  );
}
