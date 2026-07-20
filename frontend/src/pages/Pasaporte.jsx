import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout.jsx';
import { Icon } from '../components/icons.jsx';
import { api, fmt, fmtInt, fmtFecha } from '../api.js';
import { useIdioma } from '../lib/i18n.js';

const NIVEL_BADGE = { Alto: 'badge-green', Medio: 'badge-amber', Bajo: 'badge-red' };

// Pasaporte Digital de Producto: la "cédula de identidad" pública de una
// operación registrada en sicr3p (espejo del concepto del módulo Pasaporte
// Digital REP de SICREP, adaptado al modelo de datos de sicr3p). Consolida
// en una sola página escaneable por QR lo que ya es verificable por partes:
// emisiones, declaración REP, compensación y cadena de hash. Sin login,
// i18n es/en/pt, imprimible (guardar como PDF desde el navegador).
export default function Pasaporte() {
  const { id } = useParams();
  const { t } = useIdioma();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    api.pasaporte(id).then(setData).catch((e) => setError(e.message));
  }, [id]);

  async function copiarEnlace() {
    try {
      await navigator.clipboard.writeText(data.pasaporte.url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch { /* navegador sin clipboard: el enlace es la propia URL */ }
  }

  // Hitos de trazabilidad: SOLO los que existen de verdad en el registro
  // (sin fechas inventadas — si un hito no tiene fecha, no la muestra).
  const hitos = data ? [
    { label: t('pas.t_emitido'), fecha: data.producto.fecha, detalle: data.producto.documento },
    {
      label: t('pas.t_procesado'),
      detalle: String(data.producto.motor || '').startsWith('propio') ? t('pas.motor_propio') : t('pas.motor_externo'),
    },
    data.circular && {
      label: t('pas.t_rep'),
      detalle: `${fmt(data.circular.porcentaje, 1)}% · ${data.circular.nivel}`,
    },
    data.compensacion && data.compensacion.estado !== 'omitido' && {
      label: t('pas.t_comp'),
      fecha: data.compensacion.fecha,
      detalle: `$${fmtInt(data.compensacion.monto_clp)} CLP`,
    },
    data.integridad && {
      label: t('pas.t_encadenado'),
      detalle: `${t('ver.eslabon')} #${data.integridad.eslabon}`,
    },
  ].filter(Boolean) : [];

  return (
    <PublicLayout>
      <div className="container" style={{ padding: '48px 24px', maxWidth: 800 }}>
        {error && (
          <div className="card card-pad" style={{ textAlign: 'center' }}>
            <div style={{ color: '#b45309', display: 'flex', justifyContent: 'center' }}><Icon.Alert size={40} /></div>
            <h2>{t('pas.error_titulo')}</h2>
            <p className="muted">{t('pas.error_texto')}</p>
          </div>
        )}

        {data && (
          <div className="card card-pad pasaporte-doc">
            {/* Encabezado tipo documento: título + badges + QR */}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <div className="muted" style={{ fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase' }}>sicr3p</div>
                <h1 style={{ fontSize: 26, margin: '4px 0 2px' }}>{t('pas.titulo')}</h1>
                <p className="muted" style={{ margin: '0 0 10px' }}>{t('pas.subtitulo')}</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span className="badge badge-green" style={{ fontSize: 13, padding: '5px 12px' }}>✓ {t('pas.vigente')}</span>
                  {data.integridad && (
                    <span className={`badge ${data.integridad.intacto ? 'badge-green' : 'badge-red'}`} style={{ fontSize: 13, padding: '5px 12px' }}>
                      {data.integridad.intacto ? `✓ ${t('ver.cadena_intacta')}` : `⚠ ${t('ver.cadena_alterada')}`}
                    </span>
                  )}
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <img src={data.pasaporte.qr_png} alt={t('pas.qr_alt')} width={104} height={104}
                  style={{ borderRadius: 8, border: '1px solid var(--border)' }} />
                <div className="muted" style={{ fontSize: 11, maxWidth: 120, marginTop: 4 }}>{t('pas.escanea')}</div>
              </div>
            </div>

            {/* Identificación */}
            <div className="pasaporte-sec" style={{ marginTop: 18 }}>
              <h3>{t('pas.sec_producto')}</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 14 }}>
                <div><span className="muted">{t('pas.documento')}</span><br /><b>{data.producto.documento}</b></div>
                <div><span className="muted">{t('pas.fecha_doc')}</span><br /><b>{data.producto.fecha ? fmtFecha(data.producto.fecha) : '—'}</b></div>
                <div><span className="muted">{t('pas.titular')}</span><br /><b>{data.titular.nombre || '—'}</b></div>
                <div><span className="muted">{t('pas.rut')}</span><br /><b>{data.titular.rut || '—'}</b></div>
                <div><span className="muted">{t('pas.categoria')}</span><br /><b>{data.producto.categoria}</b></div>
                <div><span className="muted">{t('ver.estado')}</span><br /><span className="badge badge-green">{data.producto.status}</span></div>
                {data.producto.clasificacion_ghg && (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <span className="muted">{t('pas.clasificacion')}</span><br /><b>{data.producto.clasificacion_ghg}</b>
                  </div>
                )}
              </div>
            </div>

            {/* Clima */}
            <div className="pasaporte-sec">
              <h3>{t('pas.sec_clima')}</h3>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 30, fontWeight: 800 }}>{fmt(data.clima.total_co2e, 3)}</span>
                <span className="muted">t CO2e · {t('pas.total_incorporado')}</span>
              </div>
              <div className="muted" style={{ fontSize: 12, margin: '4px 0 10px' }}>
                {t('pas.metodo')}: {String(data.producto.motor || '').startsWith('propio') ? t('pas.motor_propio') : t('pas.motor_externo')}
              </div>
              {data.clima.items.length > 0 && (
                <div className="table-scroll">
                  <table className="data">
                    <thead><tr><th>{t('ver.col_descripcion')}</th><th className="num">t CO2e</th><th className="num">{t('ver.col_pct')}</th></tr></thead>
                    <tbody>
                      {data.clima.items.map((it, i) => (
                        <tr key={i}>
                          <td>{it.descripcion}</td>
                          <td className="num">{fmt(it.co2e, 4)}</td>
                          <td className="num">{fmt(it.porcentaje_total, 1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Economía circular (REP) */}
            <div className="pasaporte-sec">
              <h3>{t('pas.sec_circular')}</h3>
              {data.circular ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 14 }}>
                  <span className={`badge ${NIVEL_BADGE[data.circular.nivel] || 'badge-gray'}`}>
                    {t('pas.reciclabilidad')}: {fmt(data.circular.porcentaje, 1)}%
                  </span>
                  <span className="muted" style={{ fontSize: 13 }}>
                    {t('pas.nivel')}: <b>{data.circular.nivel}</b> · {fmtInt(data.circular.n_componentes)} {t('pas.componentes')} · {fmtInt(data.circular.peso_total_gr)} g
                  </span>
                </div>
              ) : (
                <p className="muted" style={{ margin: 0, fontSize: 13 }}>{t('pas.sin_embalaje')}</p>
              )}
            </div>

            {/* Compensación */}
            <div className="pasaporte-sec">
              <h3>{t('pas.sec_comp')}</h3>
              {data.compensacion ? (
                <div style={{ fontSize: 14 }}>
                  <div>{data.compensacion.estado === 'omitido' ? t('pas.comp_omitida') : t('pas.comp_registrada')}</div>
                  {data.compensacion.estado !== 'omitido' && (
                    <div style={{ marginTop: 4 }}>
                      <b>{t('pas.monto')}: ${fmtInt(data.compensacion.monto_clp)} CLP</b>
                      {data.compensacion.monto_usd != null && (
                        <span className="muted"> · ≈ US$ {fmt(data.compensacion.monto_usd, 2)}</span>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <p className="muted" style={{ margin: 0, fontSize: 13 }}>{t('pas.sin_comp')}</p>
              )}
            </div>

            {/* Trazabilidad (hitos reales del registro) */}
            <div className="pasaporte-sec">
              <h3>{t('pas.sec_trazabilidad')}</h3>
              <div style={{ borderLeft: '2px solid var(--border)', paddingLeft: 14, display: 'grid', gap: 10 }}>
                {hitos.map((h, i) => (
                  <div key={i} style={{ fontSize: 13 }}>
                    <b>{h.label}</b>
                    {h.fecha && <span className="muted"> · {fmtFecha(h.fecha)}</span>}
                    {h.detalle && <div className="muted" style={{ fontSize: 12 }}>{h.detalle}</div>}
                  </div>
                ))}
              </div>
            </div>

            {/* Integridad */}
            {data.integridad && (
              <div className="pasaporte-sec">
                <h3>{t('pas.sec_integridad')}</h3>
                <div style={{ fontSize: 12 }}>
                  <span className="muted">{t('ver.eslabon')} #{data.integridad.eslabon} · {t('pas.hash_doc')}</span>
                  <div style={{ fontFamily: 'monospace', wordBreak: 'break-all', margin: '2px 0 8px' }}>{data.integridad.hash_documento}</div>
                  <span className="muted">{t('ver.hash_cadena')}</span>
                  <div style={{ fontFamily: 'monospace', wordBreak: 'break-all', marginTop: 2 }}>{data.integridad.hash_cadena}</div>
                </div>
                <div style={{ display: 'flex', gap: 14, marginTop: 10, flexWrap: 'wrap', fontSize: 13 }}>
                  <Link to="/cadena">{t('pas.ver_cadena')}</Link>
                  <Link to={`/verificar/${data.pasaporte.id}`}>{t('pas.verificacion_rapida')}</Link>
                </div>
              </div>
            )}

            <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>{t('pas.disclaimer')}</p>

            {/* Acciones (no salen en la impresión) */}
            <div className="no-print" style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <button className="btn btn-primary" onClick={() => window.print()}>{t('pas.imprimir')}</button>
              <button className="btn btn-outline" onClick={copiarEnlace}>
                {copiado ? t('pos.copiado') : t('pas.copiar_enlace')}
              </button>
              <img src={data.pasaporte.sello_svg} alt={t('pos.sello_alt')} height={46} style={{ marginLeft: 'auto' }} />
            </div>
          </div>
        )}
      </div>
    </PublicLayout>
  );
}
