// Logotipo sicr3p: minúsculas, punto verde flotando sobre la "i".
export default function Logo({ size = 30, tagline = false, light = false }) {
  const dot = Math.round(size * 0.15);
  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', gap: 2, lineHeight: 1 }}>
      <div className="logo" style={{ fontSize: size, color: light ? '#fff' : 'var(--navy)' }}>
        <span>s</span>
        <span style={{ position: 'relative', display: 'inline-block' }}>
          i
          <span
            aria-hidden
            style={{
              position: 'absolute',
              top: -Math.round(size * 0.24),
              left: '50%',
              transform: 'translateX(-50%)',
              width: dot,
              height: dot,
              borderRadius: '50%',
              background: 'var(--green)',
            }}
          />
        </span>
        <span>cr3p</span>
      </div>
      {tagline && (
        <div style={{ fontSize: Math.max(9, Math.round(size * 0.3)), fontWeight: 700, color: light ? '#cbd5e1' : 'var(--navy)' }}>
          Tu contabilidad, tu trazabilidad
        </div>
      )}
    </div>
  );
}
