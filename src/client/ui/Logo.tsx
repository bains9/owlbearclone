export function Logo(props: { size?: number }) {
  const s = props.size ?? 32;
  return (
    <svg width={s} height={s} viewBox="0 0 64 64" aria-hidden="true">
      <polygon points="32,3 57,17.5 57,46.5 32,61 7,46.5 7,17.5" fill="#1f2a36" stroke="#4fd1ff" stroke-width="3" />
      <polygon points="32,14 47,40 17,40" fill="none" stroke="#4fd1ff" stroke-width="3" stroke-linejoin="round" />
      <text x="32" y="36" text-anchor="middle" font-size="11" font-weight="700" fill="#e6e8ee" font-family="system-ui, sans-serif">
        20
      </text>
    </svg>
  );
}
