// Gráficos SVG propios, sin librerías externas. Paleta coherente con la marca.
export const PALETTE = ['#28a745', '#0ea5e9', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6', '#64748b'];

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
        <text x={cx} y={cx - 4} textAnchor="middle" fontSize="24" fontWeight="800" fill="#0f1f2e">
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

// Línea/área con puntos + etiquetas, para series mensuales cortas (5-12
// puntos). data = [{ label, value }]. Sin librerías: solo SVG.
export function Serie({ data = [], height = 140, color = '#28a745', unit = '' }) {
  const w = Math.max(280, data.length * 64);
  const padX = 28, padY = 18;
  const max = Math.max(...data.map((d) => Number(d.value) || 0), 1);
  const stepX = data.length > 1 ? (w - padX * 2) / (data.length - 1) : 0;
  const y = (v) => padY + (height - padY * 2) * (1 - (Number(v) || 0) / max);
  const puntos = data.map((d, i) => [padX + i * stepX, y(d.value)]);
  const linea = puntos.map(([x, py], i) => `${i === 0 ? 'M' : 'L'} ${x} ${py}`).join(' ');
  const area = `${linea} L ${puntos[puntos.length - 1]?.[0] || padX} ${height - padY} L ${padX} ${height - padY} Z`;

  return (
    <div style={{ overflowX: data.length > 6 ? 'auto' : 'visible' }}>
      <svg width={w} height={height + 22} viewBox={`0 0 ${w} ${height + 22}`}>
        <line x1={padX} y1={height - padY} x2={w - padX} y2={height - padY} stroke="#eef2f7" strokeWidth={1} />
        {data.length > 0 && <path d={area} fill={color} opacity={0.12} />}
        {data.length > 1 && <path d={linea} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />}
        {puntos.map(([x, py], i) => (
          <g key={i}>
            <circle cx={x} cy={py} r={3.5} fill="#fff" stroke={color} strokeWidth={2} />
            <text x={x} y={height + 16} textAnchor="middle" fontSize="10.5" fill="#64748b">{data[i].label}</text>
          </g>
        ))}
        {data.length === 0 && <text x={w / 2} y={height / 2} textAnchor="middle" fontSize="12" fill="#94a3b8">Sin datos.</text>}
      </svg>
      {unit && <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>{unit}</div>}
    </div>
  );
}

// Sparkline / mini barras. values = [numbers]
export function Sparkbars({ values = [], height = 48, color = '#28a745' }) {
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
