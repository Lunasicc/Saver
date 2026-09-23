import type { CSSProperties } from 'react';

export function Skeleton({ width = '100%', height = 14, style }: { width?: number | string; height?: number; style?: CSSProperties }) {
  return <div className="skeleton" aria-hidden="true" style={{ width, height, ...style }} />;
}

/** Placeholder rows shaped like a list, so the layout doesn't jump when data lands. */
export function SkeletonList({ rows = 5 }: { rows?: number }) {
  return (
    <div className="list" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div className="list-row" key={i}>
          <Skeleton width={34} height={34} style={{ borderRadius: 9 }} />
          <div className="list-main" style={{ display: 'grid', gap: 6 }}>
            <Skeleton width={`${55 - i * 5}%`} height={12} />
            <Skeleton width="30%" height={10} />
          </div>
          <Skeleton width={70} height={12} />
        </div>
      ))}
    </div>
  );
}
