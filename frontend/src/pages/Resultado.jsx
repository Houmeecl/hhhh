import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout.jsx';
import Logo from '../components/Logo.jsx';
import { Icon } from '../components/icons.jsx';
import { Donut } from '../components/Charts.jsx';
import DeclaracionEmbalaje from '../components/DeclaracionEmbalaje.jsx';
import { api, fmt, fmtInt, fmtFecha } from '../api.js';

export default function Resultado() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [sel, setSel] = useState(0);
  // Declaración de embalaje REP (Ley 20.920): misma sección plegable del
  // terminal Aduana Verde, ahora también en el flujo web.
  const [embComponentes, setEmbComponentes] = useState([]);
  const [embalajeGuardado, setEmbalajeGuardado] = useState(null);

  useEffect(() => {
    api.getSesion(id)
      .then((d) => {
        setData(d);
        // Si la sesión ya tiene declaración guardada, se muestra tal cual.
        setEmbalajeGuardado(d.declaracion_embalaje || d.sesion?.declaracion_embalaje || null);
      })
      .catch((e) => setError(e.message));
  }, [id]);

  if (error) return <PublicLayout><div className="container" style={{ padding: 60 }}><h2>{error}</h2><Link to="/cargar">Volver a cargar</Link></div></PublicLayout>;
  if (!data) return <PublicLayout><div className="container" style={{ padding: 60 }}><span className="spinner dark" /> Cargando…</div></PublicLayout>;

  const { sesion, facturas } = data;
  const totalItems = facturas.reduce((a, f) => a + (f.items?.length || 0), 0);
  const categorias = [...new Set(facturas.map((f) => f.categoria).filter(Boolean))];
  const proveedores = new Set(facturas.map((f) => f.rut_emisor).filter(Boolean)).size;
  const factura = facturas[sel] || facturas[0];

  // Agregación de CO2e por categoría para el donut.
  const porCategoria = Object.entries(
    facturas.reduce((acc, f) => {
      const k = f.categoria || 'Sin categoría';
      acc[k] = (acc[k] || 0) + Number(f.total_co2e || 0);
      return acc;
    }, {})
  ).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);

  // Descargar todas las etiquetas (abre cada PDF en una pestaña, de forma escalonada).
  function descargarEtiquetas() {
    facturas.forEach((f, i) => setTimeout(() => window.open(api.etiquetaUrl(f.id), '_blank'), i * 350));
  }

  return (
    <PublicLayout>
      <div className="container resultado-grid" style={{ padding: '32px 24px' }}>
        {/* Columna principal */}
        <div>
          <h1 style={{ fontSize: 28, margin: '0 0 4px' }}>Resultado de tu contabilidad de carbono</h1>
          <p className="muted" style={{ marginTop: 0 }}>{sesion.nombre_cliente} · {sesion.rut_cliente} · {fmtFecha(sesion.fecha)}</p>

          <div className="result-cards">
            <div className="result-card">
              <div className="big">{fmt(sesion.total_co2e, 2)} <small>t CO2e</small></div>
              <div className="lbl">Total incorporado</div>
            </div>
            <div className="result-card">
              <div className="big">{fmtInt(totalItems)}</div>
              <div className="lbl">Ítems procesados</div>
            </div>
            <div className="result-card">
              <div className="big" style={{ fontSize: 20 }}>{categorias[0] || '—'}</div>
              <div className="lbl">{categorias.length > 1 ? `+${categorias.length - 1} categorías más` : 'Categoría'}</div>
            </div>
            <div className="result-card">
              <div className="big">✓</div>
              <div className="lbl">{proveedores} proveedor{proveedores !== 1 ? 'es' : ''} identificado{proveedores !== 1 ? 's' : ''}</div>
            </div>
          </div>

          {/* Declaración de embalaje REP (opcional) — guarda en el backend y
              queda visible en la verificación pública del documento. */}
          <DeclaracionEmbalaje
            sesionId={sesion.id}
            componentes={embComponentes} setComponentes={setEmbComponentes}
            guardada={embalajeGuardado}
            onGuardada={setEmbalajeGuardado}
            onModificar={() => setEmbalajeGuardado(null)}
          />

          {/* Donut de CO2e por categoría */}
          {porCategoria.length > 0 && (
            <div className="card card-pad" style={{ marginTop: 8 }}>
              <h3 style={{ margin: '0 0 12px' }}>Distribución por categoría</h3>
              <Donut data={porCategoria} unit="t CO2e" />
            </div>
          )}

          {/* Selector de factura */}
          <div className="card card-pad" style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
              {facturas.map((f, i) => (
                <button
                  key={f.id}
                  className={`btn btn-sm ${i === sel ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => setSel(i)}
                >
                  {f.numero_venta || `Factura ${i + 1}`}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <h3 style={{ margin: '0 0 10px' }}>Detalle por ítem</h3>
              <span className="badge badge-green">{factura.categoria}</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="data">
                <thead>
                  <tr><th>Descripción</th><th className="num">Cantidad</th><th className="num">t CO2e</th><th className="num">% del total</th></tr>
                </thead>
                <tbody>
                  {factura.items.map((it, i) => (
                    <tr key={i}>
                      <td>{it.descripcion}</td>
                      <td className="num">{fmt(it.cantidad, 2)}</td>
                      <td className="num">{fmt(it.co2e, 4)}</td>
                      <td className="num">{fmt(it.porcentaje_total, 1)}%</td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={2}><b>Total factura</b></td>
                    <td className="num"><b>{fmt(factura.total_co2e, 4)}</b></td>
                    <td className="num"><b>100,0%</b></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <p className="muted" style={{ fontSize: 13, marginTop: 14, display: 'flex', alignItems: 'flex-start', gap: 6 }}>
            <span style={{ flexShrink: 0, marginTop: 1 }}><Icon.Info size={15} /></span> El análisis utiliza un motor externo para recopilar y estructurar la información. Este resultado no constituye una verificación de tercera parte acreditada.
          </p>
        </div>

        {/* Sidebar: resultados generados */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card card-pad">
            <div style={{ fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--green-600)' }}><Icon.Sparkles size={18} /> <span style={{ color: 'var(--navy)' }}>Resultados generados</span></div>
            <div style={{ borderTop: '1px solid var(--border)', margin: '12px 0', paddingTop: 12 }}>
              <b>PDF de informe</b>
              <p className="muted" style={{ fontSize: 13, margin: '4px 0 10px' }}>Informe consolidado con libro mayor de carbono y metodología.</p>
              <a className="btn btn-primary" style={{ width: '100%' }} href={api.informeUrl(sesion.id)} target="_blank" rel="noreferrer"><Icon.Download size={17} /> Generar PDF</a>
            </div>
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <b>Etiqueta / adhesivo</b>
              <p className="muted" style={{ fontSize: 13, margin: '4px 0 10px' }}>Etiqueta con QR verificable de la factura seleccionada.</p>
              <a className="btn btn-outline" style={{ width: '100%', marginBottom: 8 }} href={api.etiquetaUrl(factura.id)} target="_blank" rel="noreferrer"><Icon.Tag size={16} /> Etiqueta de {factura.numero_venta}</a>
              {facturas.length > 1 && (
                <button className="btn btn-outline" style={{ width: '100%' }} onClick={descargarEtiquetas}><Icon.Download size={16} /> Descargar las {facturas.length} etiquetas</button>
              )}
            </div>
          </div>

          {/* Vista previa de etiqueta */}
          <div className="card card-pad">
            <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Vista previa de etiqueta</div>
            <div className="etq">
              <Logo size={22} />
              <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>Contabilidad Trazabilidad. Controla. Traza. Decide.</div>
              <div style={{ margin: '12px 0', fontSize: 13, lineHeight: 1.9 }}>
                <div><span className="muted">N° de venta:</span> <b>{factura.numero_venta}</b></div>
                <div><span className="muted">Cliente:</span> <b>{sesion.nombre_cliente}</b></div>
                <div><span className="muted">Fecha:</span> <b>{fmtFecha(sesion.fecha)}</b></div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '6px 0' }}>
                <img src={api.qrUrl(factura.id)} alt="QR de verificación" width={110} height={110} style={{ borderRadius: 8 }} />
                <span className="muted" style={{ fontSize: 11, marginTop: 4 }}>Verifica la trazabilidad</span>
              </div>
              <div className="green-block">
                <div className="lbl">RESULTADO INCORPORADO</div>
                <div className="val">{fmt(factura.total_co2e, 3)} t CO2e</div>
                <div className="muted" style={{ fontSize: 12 }}>· {factura.categoria} · {factura.items.length} ítems</div>
              </div>
            </div>
            <Link to={`/verificar/${factura.id}`} className="btn btn-ghost btn-sm" style={{ width: '100%', marginTop: 10 }}>
              Ver página de verificación →
            </Link>
          </div>
        </div>
      </div>
    </PublicLayout>
  );
}
