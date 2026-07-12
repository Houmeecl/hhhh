// Gráficos SVG propios, sin librerías externas. Paleta coherente con la marca.
export const PALETTE = ['#22c55e', '#0ea5e9', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6', '#64748b'];

// Donut con leyenda. data = [{ label, value }]
export function Donut({ data = [], size = 168, thickness = 26, unit = 't CO2e' }) {
  const total = data.reduce((a, d) => a + (Number(d.value) || 0), 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const cx = size / 2;

  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="#eef2f7" strokeWidth={thickness} />
        {total > 0 && data.map((d, i) => {
          const frac = (Number(d.value) || 0) / total;
          const len = frac * c;
          const seg = (
            <circle key={i} cx={cx} cy={cx} r={r} fill="none"
              stroke={PALETTE[i % PALETTE.length]} strokeWidth={thickness}
              strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset}
              transform={`rotate(-90 ${cx} ${cx})`} strokeLinecap="butt" />
          );
          offset += len;
          return seg;
        })}
        <text x={cx} y={cx - 4} textAnchor="middle" fontSize="24" fontWeight="800" fill="#1e2a3a">
          {total.toLocaleString('es-CL', { maximumFractionDigits: 1 })}
        </text>
        <text x={cx} y={cx + 16} textAnchor="middle" fontSize="11" fill="#64748b">{unit}</text>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 160 }}>
        {data.map((d, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <span style={{ width: 11, height: 11, borderRadius: 3, background: PALETTE[i % PALETTE.length], flexShrink: 0 }} />
            <span style={{ flex: 1 }}>{d.label}</span>
            <b>{total > 0 ? Math.round((d.value / total) * 100) : 0}%</b>
          </div>
        ))}
        {total === 0 && <span className="muted" style={{ fontSize: 13 }}>Sin datos.</span>}
      </div>
    </div>
  );
}

// Sparkline / mini barras. values = [numbers]
export function Sparkbars({ values = [], height = 48, color = '#22c55e' }) {
  const max = Math.max(...values, 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height }}>
      {values.map((v, i) => (
        <div key={i} title={String(v)} style={{
          flex: 1, minWidth: 6,
          height: `${Math.max(4, (v / max) * height)}px`,
          background: color, opacity: 0.35 + 0.65 * (v / max), borderRadius: '3px 3px 0 0',
        }} />
      ))}
      {values.length === 0 && <span className="muted" style={{ fontSize: 12 }}>Sin datos</span>}
    </div>
  );
}
