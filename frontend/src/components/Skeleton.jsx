// Bloques de carga reutilizables (shimmer). Reemplazan el texto "Cargando…".
export function Skeleton({ h = 16, w = '100%', style = {} }) {
  return <div className="skeleton" style={{ height: h, width: w, ...style }} />;
}

// Grid de tarjetas-esqueleto para dashboards/listas.
export function SkeletonCards({ n = 4 }) {
  return (
    <div className="stat-grid">
      {Array.from({ length: n }).map((_, i) => (
        <div className="stat" key={i}>
          <Skeleton h={30} w="60%" />
          <Skeleton h={12} w="80%" style={{ marginTop: 10 }} />
        </div>
      ))}
    </div>
  );
}

// Filas-esqueleto para tablas.
export function SkeletonRows({ n = 5 }) {
  return (
    <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {Array.from({ length: n }).map((_, i) => <Skeleton key={i} h={18} />)}
    </div>
  );
}
