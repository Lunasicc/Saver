import { iconForCategory } from '../lib/categoryIcons';

type Props = {
  name: string | null | undefined;
  color?: string | null;
  size?: number;
};

/** Tinted tile with the category's glyph; neutral "?" tile when uncategorized. */
export function CategoryIcon({ name, color, size = 34 }: Props) {
  const Glyph = iconForCategory(name);
  const tint = name && color ? color : null;
  return (
    <span
      className="cat-icon"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        background: tint ? `${tint}1f` : 'var(--warning-soft)',
        color: tint ?? 'var(--warning)',
      }}
    >
      <Glyph size={Math.round(size * 0.5)} weight="duotone" />
    </span>
  );
}
