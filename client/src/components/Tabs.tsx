import { motion } from 'framer-motion';
import { useSearchParams } from 'react-router-dom';
import type { Icon } from '@phosphor-icons/react';

export type TabDef = { id: string; label: string; icon?: Icon; count?: number };

/** Reads the active tab from `?tab=` so tabs are linkable and survive reloads. */
export function useTab(tabs: TabDef[]) {
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const active = tabs.some((t) => t.id === requested) ? requested! : tabs[0].id;

  function select(id: string) {
    const next = new URLSearchParams(params);
    if (id === tabs[0].id) next.delete('tab');
    else next.set('tab', id);
    // Tab-specific filters shouldn't leak into a sibling tab.
    for (const key of ['category', 'month', 'q', 'account']) next.delete(key);
    setParams(next, { replace: true });
  }

  return [active, select] as const;
}

export function Tabs({
  tabs,
  active,
  onSelect,
  label,
}: {
  tabs: TabDef[];
  active: string;
  onSelect: (id: string) => void;
  label: string;
}) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => {
        const isActive = t.id === active;
        const Glyph = t.icon;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={isActive}
            className={`tab${isActive ? ' tab--active' : ''}`}
            onClick={() => onSelect(t.id)}
          >
            {isActive && (
              <motion.span
                layoutId={`tab-bg-${label}`}
                className="tab-bg"
                transition={{ type: 'spring', stiffness: 500, damping: 40 }}
              />
            )}
            {Glyph && <Glyph size={15} weight={isActive ? 'fill' : 'regular'} />}
            <span>{t.label}</span>
            {t.count ? <span className="tab-count">{t.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
