// Logotipo sicr3p: minúsculas, punto verde flotando sobre la "i".
export default function Logo({ size = 30, tagline = false, light = false }) {
  const dot = size * 0.16;
  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', gap: 2 }}>
      <div
        className="logo"
        style={{ fontSize: size, color: light ? '#fff' : 'var(--navy)' }}
      >
        <span style={{ position: 'relative', display: 'inline-block' }}>
          {/* la "s" */}s
          {/* punto verde sobre la i */}
        </span>
        <span style={{ position: 'relative', display: 'inline-block' }}>
          i
          <span
            style={{
              position: 'absolute',
              top: -size * 0.28,
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
        <div style={{ fontSize: size * 0.32, fontWeight: 700, color: light ? '#cbd5e1' : 'var(--navy)' }}>
          Tu contabilidad, tu trazabilidad
        </div>
      )}
    </div>
  );
}
