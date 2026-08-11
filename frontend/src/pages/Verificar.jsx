import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout.jsx';
import { Icon } from '../components/icons.jsx';
import { api, fmt, fmtInt, fmtFecha } from '../api.js';
import { useIdioma } from '../lib/i18n.js';

// Color del badge según nivel de reciclabilidad de la declaración REP.
const NIVEL_BADGE = { Alto: 'badge-green', Medio: 'badge-amber', Bajo: 'badge-red' };

// Página que escanean mandantes (también internacionales): las etiquetas se
// traducen con i18n (?lang=en / ?lang=pt en el QR compartido); los DATOS del
// documento (categoría, estado, descripciones) llegan tal cual del servidor.
export default function Verificar() {
  const { id } = useParams();
  const { t } = useIdioma();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.verificar(id).then(setData).catch((e) => setError(e.message));
  }, [id]);

  return (
    <PublicLayout>
      <div className="container" style={{ padding: '48px 24px', maxWidth: 720 }}>
        {error && (
          <div className="card card-pad" style={{ textAlign: 'center' }}>
            <div style={{ color: '#b45309', display: 'flex', justifyContent: 'center' }}><Icon.Alert size={40} /></div>
            <h2>{t('ver.error_titulo')}</h2>
            <p className="muted">{t('ver.error_texto')}</p>
          </div>
        )}

        {data && (
          <div className="card card-pad pasaporte-doc">
            <div className="pas-head">
              <div style={{ minWidth: 0 }}>
                <div className="pas-kicker">sicr3p</div>
                <h1 style={{ fontSize: 24, margin: '10px 0 6px' }}>{t('ver.documento')}</h1>
                <div className="pas-code">{data.factura.numero_venta}</div>
                <p className="muted" style={{ margin: '10px 0 12px', fontSize: 14 }}>{t('ver.subtitulo')}</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span className="badge badge-green" style={{ fontSize: 13, padding: '5px 12px' }}>✓ {t('ver.trazabilidad_ok')}</span>
                  {data.cadena && (
                    <span className={`badge ${data.cadena.intacto ? 'badge-green' : 'badge-red'}`} style={{ fontSize: 13, padding: '5px 12px' }}>
                      {data.cadena.intacto ? `✓ ${t('ver.cadena_intacta')}` : `⚠ ${t('ver.cadena_alterada')}`}
                    </span>
                  )}
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div className="pas-qr">
                  <img src={api.qrUrl(data.factura.id)} alt={t('ver.qr_alt')} width={104} height={104} />
                </div>
                <div className="muted" style={{ fontSize: 11, maxWidth: 128, margin: '6px auto 0' }}>{t('ver.escanea')}</div>
              </div>
            </div>

            <div className="pasaporte-sec">
              <h3>{t('ver.resultado_incorporado')}</h3>
              <div className="result-cards cols-3">
                <div className="result-card">
                  <div className="big">{fmt(data.factura.total_co2e, 3)} <small>t CO2e</small></div>
                  <div className="lbl">{t('ver.resultado_incorporado')}</div>
                </div>
                <div className="result-card">
                  {/* La marca de confianza va aparte y traducida: el backend
                      manda el nombre y el estado sin texto, porque esta
                      pantalla se lee en es/en/pt y "· sin confirmar" pegado
                      al nombre salía en español para todos. */}
                  <div className="big" style={{ fontSize: 18 }}>
                    {data.factura.categoria_nombre || t('cat.sin_clasificar')}
                  </div>
                  {data.factura.categoria_estado === 'sin_confirmar' && (
                    <div className="badge" style={{ marginTop: 4 }}>{t('cat.sin_confirmar')}</div>
                  )}
                  {data.factura.categoria_estado === 'sin_procedencia' && (
                    <div className="badge" style={{ marginTop: 4 }}>{t('cat.sin_procedencia')}</div>
                  )}
                  <div className="lbl">{t('ver.categoria')}</div>
                </div>
                <div className="result-card">
                  <div className="big">{data.items.length}</div>
                  <div className="lbl">{t('ver.items')}</div>
                </div>
              {/* El sello de abajo cubre el cálculo ORIGINAL. Mostrar la
                  categoría del operador junto a «cadena íntegra», sin decir
                  que cambió, deja un rótulo que no corresponde al hash que
                  esta misma página exhibe. */}
              {data.reclasificacion && (
                <div className="aviso" style={{ marginTop: 12 }}>
                  <strong>{t('cat.reclasificado')}</strong>
                  <p style={{ margin: '4px 0 0', fontSize: 13 }}>
                    {t('cat.reclasificado_det')
                      .replace('{orig}', data.reclasificacion.categoria_original || '—')
                      .replace('{co2e}', fmt(data.reclasificacion.total_co2e_original, 3))}
                  </p>
                </div>
              )}
              </div>
            </div>

            <div className="pasaporte-sec">
              <div className="pas-grid">
                <div><span className="pas-lbl">{t('ver.cliente')}</span><b>{data.cliente.nombre}</b></div>
                <div><span className="pas-lbl">{t('ver.rut')}</span><b>{data.cliente.rut}</b></div>
                <div><span className="pas-lbl">{t('ver.fecha')}</span><b>{fmtFecha(data.factura.fecha)}</b></div>
                <div><span className="pas-lbl">{t('ver.estado')}</span><span className="badge badge-green">{data.factura.status}</span></div>
              </div>
            </div>

            {data.cadena && (
              <div style={{ margin: '0 0 18px', padding: '12px 16px', background: 'var(--bg)', borderRadius: 12, fontSize: 12 }}>
                <span className="muted">{t('ver.eslabon')} #{data.cadena.eslabon} · {t('ver.hash_cadena')}</span>
                <div style={{ fontFamily: 'monospace', wordBreak: 'break-all', marginTop: 4 }}>{data.cadena.hash_cadena}</div>
              </div>
            )}

            {data.embalaje && (
              <div style={{ margin: '0 0 18px', padding: '12px 16px', background: 'var(--bg)', borderRadius: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <b style={{ fontSize: 14 }}>{t('ver.embalaje_titulo')}</b>
                  <span className={`badge ${NIVEL_BADGE[data.embalaje.nivel] || 'badge-gray'}`}>
                    {t('ver.reciclabilidad')}: {data.embalaje.nivel}
                  </span>
                </div>
                <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
                  {fmt(data.embalaje.porcentaje, 1)}% {t('ver.de_reciclabilidad')} ·{' '}
                  {fmtInt(data.embalaje.n_componentes)} {Number(data.embalaje.n_componentes) === 1 ? t('ver.componente') : t('ver.componentes')} ·{' '}
                  {fmtInt(data.embalaje.peso_total_gr)} {t('ver.gr_totales')}
                </div>
              </div>
            )}

            <h3 style={{ margin: '0 0 8px' }}>{t('ver.detalle_item')}</h3>
            <div className="table-scroll">
              <table className="data">
                <thead><tr><th>{t('ver.col_descripcion')}</th><th className="num">t CO2e</th><th className="num">{t('ver.col_pct')}</th></tr></thead>
                <tbody>
                  {data.items.map((it, i) => (
                    <tr key={i}>
                      <td>{it.descripcion}</td>
                      <td className="num">{fmt(it.co2e, 4)}</td>
                      <td className="num">{fmt(it.porcentaje_total, 1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Link className="btn btn-primary" to={`/pasaporte/${id}`}>{t('pas.ver_pasaporte')}</Link>
              {data.factura.sesion_id && (
                <a
                  className="btn btn-outline"
                  href={api.carpetaUrl(data.factura.sesion_id)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Icon.Download size={17} /> {t('ver.descargar_carpeta')}
                </a>
              )}
            </div>

            <p className="muted" style={{ fontSize: 12, marginTop: 16 }}>
              {t('ver.nota_legal')}
            </p>

            <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="badge badge-gray" style={{ fontSize: 11 }}>{t('comun.proximamente')}</span>
              <span className="muted" style={{ fontSize: 12 }}>{t('comun.socio_ambiental')}</span>
            </div>
          </div>
        )}
      </div>
    </PublicLayout>
  );
}
