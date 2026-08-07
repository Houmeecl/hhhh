import { fmtInt, fmtFecha } from '../api.js';

// Vista del análisis de compras/ventas del SII de una empresa: resumen,
// estimación referencial de emisiones, concentración por contraparte y
// detalle de documentos. Compartida por el panel del proveedor
// (panel-proveedor/AnalisisSii.jsx) y la sección admin "SII" (admin/Sii.jsx).
const CLP = (n) => `$${Math.round(Number(n) || 0).toLocaleString('es-CL')}`;

export default function AnalisisSiiVista({ a }) {
  const c = a.resumen.compra, v = a.resumen.venta;
  const em = a.emisiones;
  return (
    <div>
      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <div className="stat"><div className="n">{fmtInt(c.n)}</div><div className="l">Documentos de compra</div></div>
        <div className="stat"><div className="n">{CLP(c.total)}</div><div className="l">Total comprado</div></div>
        <div className="stat"><div className="n">{fmtInt(v.n)}</div><div className="l">Documentos de venta</div></div>
        <div className="stat"><div className="n green">{CLP(v.total)}</div><div className="l">Total vendido</div></div>
      </div>

      {em && (
        <div className="card" style={{ marginBottom: 16, borderLeft: '3px solid #14b8a6' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{em.total_co2e_tref} tCO₂e</div>
              <div className="muted" style={{ fontSize: 13 }}>
                Emisiones de tus compras — calculadas sobre {fmtInt(em.documentos_calculados)} de {fmtInt(em.documentos_totales)} documentos del SII
                {em.metodo_fisico > 0 && ` · ${fmtInt(em.metodo_fisico)} por unidades físicas, ${fmtInt(em.metodo_gasto)} por gasto`}
              </div>
            </div>
            <span className="badge badge-green">Contabilidad de carbono</span>
          </div>
          <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 8 }}>
            Calculada a partir del detalle de cada documento tributario con nuestro motor de cálculo, aplicando
            unidades físicas cuando el documento las incluye y factores por gasto en el resto. Alineada con el GHG Protocol.
          </p>
        </div>
      )}

      <PorTipoTabla titulo="Compras por tipo de documento" filas={a.por_tipo?.compra} />
      <PorTipoTabla titulo="Ventas por tipo de documento" filas={a.por_tipo?.venta} />

      <ContraparteTabla titulo="Principales proveedores (compras)" filas={a.concentracion.compra} />
      <ContraparteTabla titulo="Principales clientes (ventas)" filas={a.concentracion.venta} />

      <details style={{ marginTop: 8 }}>
        <summary style={{ cursor: 'pointer', fontSize: 14 }}>Ver el detalle de los {fmtInt(a.documentos.length)} documentos</summary>
        <div className="card" style={{ marginTop: 10 }}>
          <div className="table-scroll">
            <table className="data">
              <thead><tr><th>Tipo</th><th>Folio</th><th>Fecha</th><th>Contraparte</th><th style={{ textAlign: 'right' }}>Neto</th><th style={{ textAlign: 'right' }}>Total</th><th style={{ textAlign: 'right' }}>tCO₂e</th></tr></thead>
              <tbody>
                {a.documentos.map((d, i) => (
                  <tr key={i}>
                    <td>{d.tipo === 'compra' ? 'Compra' : 'Venta'}</td>
                    <td style={{ fontFamily: 'monospace' }}>{d.folio}</td>
                    <td>{d.fecha ? fmtFecha(d.fecha) : '—'}</td>
                    <td>
                      {d.razon_social || d.rut_contraparte || '—'}
                      {d.conciliado && d.monto_coincide && (
                        <span title="Confirmado: también aparece en el RCV que esta empresa descargó de su propio SII" style={{ marginLeft: 6, color: '#16a34a' }}>✓</span>
                      )}
                      {d.conciliado && !d.monto_coincide && (
                        <span title="El folio coincide con el RCV de esta empresa, pero el monto declarado difiere — revisar" style={{ marginLeft: 6, color: '#d97706' }}>⚠</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>{CLP(d.neto)}</td>
                    <td style={{ textAlign: 'right' }}>{CLP(d.total)}</td>
                    <td style={{ textAlign: 'right' }}>{d.co2e != null ? d.co2e : '—'}</td>
                  </tr>
                ))}
                {a.documentos.length === 0 && (
                  <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 24 }}>Sin documentos en este período.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </details>
    </div>
  );
}

// Desglose por tipo de documento: separa facturas, notas de crédito/débito,
// guías de despacho y boletas (resumen agregado del período) para no leer
// todo como facturación.
function PorTipoTabla({ titulo, filas }) {
  if (!filas || filas.length === 0) return null;
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h3 style={{ marginTop: 0, fontSize: 15 }}>{titulo}</h3>
      <div className="table-scroll">
        <table className="data">
          <thead><tr><th>Tipo</th><th style={{ textAlign: 'right' }}>Docs</th><th style={{ textAlign: 'right' }}>Neto</th><th style={{ textAlign: 'right' }}>IVA</th><th style={{ textAlign: 'right' }}>Total</th></tr></thead>
          <tbody>
            {filas.map((f, i) => (
              <tr key={i}>
                <td>{f.nombre} <span className="muted" style={{ fontFamily: 'monospace', fontSize: 12 }}>({f.tipo_dte})</span></td>
                <td style={{ textAlign: 'right' }}>{f.resumen ? <span className="muted">resumen</span> : fmtInt(f.n)}</td>
                <td style={{ textAlign: 'right' }}>{CLP(f.neto)}</td>
                <td style={{ textAlign: 'right' }}>{CLP(f.iva)}</td>
                <td style={{ textAlign: 'right' }}>{CLP(f.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
        Las notas de crédito y guías de despacho se muestran por separado; las boletas electrónicas
        llegan del SII como resumen agregado del período, sin detalle por documento.
      </p>
    </div>
  );
}

// Tabla de concentración por contraparte, marcando las que ya están en
// sicr3p (cruce por RUT) y, cuando la contraparte también conectó su
// propio SII, cuántos de los documentos quedaron confirmados: coinciden
// en el RCV que ELLA misma descargó (dos fuentes SII independientes de
// acuerdo). Nunca expone datos de esos terceros más allá de eso.
function ContraparteTabla({ titulo, filas }) {
  if (!filas || filas.length === 0) return null;
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h3 style={{ marginTop: 0, fontSize: 15 }}>{titulo}</h3>
      <div className="table-scroll">
        <table className="data">
          <thead><tr><th>Contraparte</th><th>RUT</th><th style={{ textAlign: 'right' }}>Docs</th><th style={{ textAlign: 'right' }}>Total</th><th style={{ textAlign: 'right' }}>%</th><th></th></tr></thead>
          <tbody>
            {filas.map((f, i) => (
              <tr key={i}>
                <td>{f.razon_social || '—'}</td>
                <td style={{ fontFamily: 'monospace' }}>{f.rut || '—'}</td>
                <td style={{ textAlign: 'right' }}>{fmtInt(f.n)}</td>
                <td style={{ textAlign: 'right' }}>{CLP(f.total)}</td>
                <td style={{ textAlign: 'right' }}>{f.participacion}%</td>
                <td>
                  {f.conciliados > 0 ? (
                    <span className="badge badge-green" title="Estos documentos también aparecen en el RCV que esta empresa descargó de su propio SII">
                      Confirmado ({fmtInt(f.conciliados)}/{fmtInt(f.n)})
                    </span>
                  ) : f.en_sicr3p ? (
                    <span className="badge badge-amber" title="El RUT coincide con una empresa de sicr3p, pero aún no se confirma contra su propio RCV">en sicr3p</span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
