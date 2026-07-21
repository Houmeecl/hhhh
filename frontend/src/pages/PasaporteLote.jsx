import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout.jsx';
import { Icon } from '../components/icons.jsx';
import { api, fmt, fmtInt, fmtFecha } from '../api.js';
import { useIdioma } from '../lib/i18n.js';

// Pasaporte de Origen: la cadena de custodia pública de un lote mineral
// (estilo Minespider, con las piezas propias de sicr3p: cadena de hash
// por lote, eslabones anclados a DTE reales y divulgación selectiva).
// El QR/NFC del lote apunta a esta URL: cada punto de control que lo
// escanea ve la ruta (secuencia de eslabones con país y fecha) sin GPS.
export default function PasaporteLote() {
  const { codigo } = useParams();
  const { t } = useIdioma();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    api.lotePublico(codigo).then(setData).catch((e) => setError(e.message));
  }, [codigo]);

  async function copiarEnlace() {
    try {
      await navigator.clipboard.writeText(data.pasaporte.url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch { /* sin clipboard: la URL es la de la barra */ }
  }

  const nombreMaterial = (m) => t(`lote.m.${m}`);
  const nombreRol = (r) => t(`lote.rol.${r}`);
  const copperMark = data?.lote?.estandar_externo?.copper_mark;

  return (
    <PublicLayout>
      <div className="container" style={{ padding: '48px 24px', maxWidth: 800 }}>
        {error && (
          <div className="card card-pad" style={{ textAlign: 'center' }}>
            <div style={{ color: '#b45309', display: 'flex', justifyContent: 'center' }}><Icon.Alert size={40} /></div>
            <h2>{t('lote.error_titulo')}</h2>
            <p className="muted">{t('lote.error_texto')}</p>
          </div>
        )}

        {data && (
          <div className="card card-pad pasaporte-doc">
            {/* Encabezado */}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <div className="muted" style={{ fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase' }}>sicr3p</div>
                <h1 style={{ fontSize: 26, margin: '4px 0 2px' }}>{t('lote.titulo')} · {data.pasaporte.codigo}</h1>
                <p className="muted" style={{ margin: '0 0 10px' }}>{t('lote.subtitulo')}</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span className={`badge ${data.cadena.integra ? 'badge-green' : 'badge-red'}`} style={{ fontSize: 13, padding: '5px 12px' }}>
                    {data.cadena.integra ? `✓ ${t('lote.cadena_integra')}` : `⚠ ${t('lote.cadena_alterada')}`}
                  </span>
                  <span className="badge badge-gray" style={{ fontSize: 13, padding: '5px 12px' }}>{nombreMaterial(data.lote.material)}</span>
                  <span className="badge badge-gray" style={{ fontSize: 12 }}>
                    {data.lote.estado === 'cerrado' ? t('lote.estado_cerrado') : t('lote.estado_abierto')}
                  </span>
                  {copperMark?.estado && (
                    <span className="badge badge-green" style={{ fontSize: 12 }}>Copper Mark: {copperMark.estado}</span>
                  )}
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <img src={data.pasaporte.qr_png} alt={t('lote.qr_alt')} width={104} height={104}
                  style={{ borderRadius: 8, border: '1px solid var(--border)' }} />
                <div className="muted" style={{ fontSize: 11, maxWidth: 120, marginTop: 4 }}>{t('lote.escanea')}</div>
              </div>
            </div>

            {/* Identificación del lote */}
            <div className="pasaporte-sec" style={{ marginTop: 18 }}>
              <h3>{t('lote.sec_lote')}</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 14 }}>
                <div><span className="muted">{t('lote.material')}</span><br /><b>{nombreMaterial(data.lote.material)}</b></div>
                <div><span className="muted">{t('lote.cantidad')}</span><br /><b>{fmt(data.lote.cantidad, 3)} {data.lote.unidad}</b></div>
                <div><span className="muted">{t('lote.pais_origen')}</span><br /><b>{data.lote.pais_origen}</b></div>
                <div><span className="muted">{t('lote.faena')}</span><br /><b>{data.lote.faena_origen || '—'}</b></div>
                {data.lote.codigo_nc && (
                  <div><span className="muted">{t('lote.codigo_nc')}</span><br /><b>{data.lote.codigo_nc}</b></div>
                )}
                {data.lote.composicion && Object.keys(data.lote.composicion).length > 0 && (
                  <div><span className="muted">{t('lote.composicion')}</span><br />
                    <b>{Object.entries(data.lote.composicion).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join(' · ')}</b>
                  </div>
                )}
              </div>
            </div>

            {/* Cadena de custodia */}
            <div className="pasaporte-sec">
              <h3>{t('lote.sec_cadena')} · {fmtInt(data.cadena.n_eslabones)} {t('lote.eslabones')}</h3>
              {data.balance?.alerta && (
                <div className="badge badge-amber" style={{ marginBottom: 10 }}>
                  ⚠ {t('lote.merma_alerta')} ({fmt(data.balance.merma_pct, 1)}%)
                </div>
              )}
              <div style={{ borderLeft: '2px solid var(--border)', paddingLeft: 14, display: 'grid', gap: 12 }}>
                {data.cadena.eslabones.map((e) => (
                  <div key={e.eslabon} style={{ fontSize: 13 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <b>#{e.eslabon} · {nombreRol(e.rol)}</b>
                      <span className="muted">{e.pais} · {fmtFecha(e.fecha)}</span>
                      {e.divulgado && e.dte_vinculado && (
                        <span className="badge badge-green" style={{ fontSize: 11 }} title={t('lote.dte_nota')}>
                          {t('lote.dte_vinculado')}
                        </span>
                      )}
                      {!e.divulgado && <span className="badge badge-gray" style={{ fontSize: 11 }}>🔒 {t('lote.no_divulgado')}</span>}
                    </div>
                    {e.divulgado ? (
                      <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                        {(e.nombre_empresa || e.rut_empresa) && (
                          <span>{[e.nombre_empresa, e.rut_empresa].filter(Boolean).join(' · ')} · </span>
                        )}
                        {e.cantidad != null && <span>{fmt(e.cantidad, 3)} {data.lote.unidad} · </span>}
                        {Number(e.co2e_aportado) > 0 && <span>{fmt(e.co2e_aportado, 4)} t CO2e {t('lote.aportadas')} · </span>}
                        {e.datos?.punto_control && <span>{e.datos.punto_control} · </span>}
                        <span style={{ fontFamily: 'monospace' }}>{String(e.hash_cadena).slice(0, 16)}…</span>
                      </div>
                    ) : (
                      <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                        {t('lote.no_divulgado_nota')}<br />
                        <span style={{ fontFamily: 'monospace' }}>{String(e.hash_cadena).slice(0, 16)}…</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Emisiones incorporadas */}
            <div className="pasaporte-sec">
              <h3>{t('lote.sec_emisiones')}</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 14 }}>
                <div>
                  <span className="muted">{t('lote.declaradas')}</span><br />
                  {data.emisiones.declarado_t != null ? (
                    <b>{fmt(data.emisiones.declarado_t, 4)} {t('lote.por_tonelada')}
                      <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>
                        {' '}({fmt(data.emisiones.directas_t ?? 0, 4)} {t('lote.directas')} + {fmt(data.emisiones.indirectas_t ?? 0, 4)} {t('lote.indirectas')})
                      </span>
                    </b>
                  ) : <b>—</b>}
                </div>
                <div>
                  <span className="muted">{t('lote.trazadas')}</span><br />
                  <b>{data.emisiones.trazado_t != null ? `${fmt(data.emisiones.trazado_t, 4)} ${t('lote.por_tonelada')}` : '—'}</b>
                </div>
              </div>
              {data.emisiones.advertencia && (
                <div className="badge badge-amber" style={{ marginTop: 8 }}>
                  ⚠ {t('lote.divergencia')} {fmt(data.emisiones.divergencia_pct, 1)}%
                </div>
              )}
              {(data.emisiones.metodo || data.emisiones.fuente) && (
                <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
                  {data.emisiones.metodo && <>{t(`lote.metodo_${data.emisiones.metodo}`)}{data.emisiones.fuente && ' · '}</>}
                  {data.emisiones.fuente && `${data.emisiones.fuente.organismo} — ${data.emisiones.fuente.documento} (${data.emisiones.fuente.version_anio})`}
                </p>
              )}
            </div>

            {/* Alineación normativa */}
            <div className="pasaporte-sec">
              <h3>{t('lote.sec_normativo')}</h3>
              <div style={{ display: 'grid', gap: 10, fontSize: 13 }}>
                <div>
                  <b>{t('lote.norm_alineado')} {t('lote.norm_oecd')}</b>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {data.normativo.oecd.pasos_cubiertos}/{data.normativo.oecd.pasos_total} {t('lote.norm_oecd_pasos')} · {data.normativo.oecd.anexo2_cubiertas}/{data.normativo.oecd.anexo2_total} {t('lote.norm_oecd_anexo2')}
                  </div>
                </div>
                <div>
                  <b>{t('lote.norm_alineado')} {t('lote.norm_cbam')}</b>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {data.normativo.cbam.listo
                      ? `✓ ${t('lote.norm_cbam_listo')}`
                      : `${t('lote.norm_cbam_faltan')}: ${data.normativo.cbam.faltantes.join(', ')}`}
                    {!data.normativo.cbam.aplicable && <><br />{t('lote.norm_cbam_no_aplica')}</>}
                  </div>
                </div>
                <div>
                  <b>{t('lote.norm_alineado')} {t('lote.norm_dpp')}</b>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {data.normativo.dpp.listo
                      ? `✓ ${t('lote.norm_dpp_listo')}`
                      : `${t('lote.norm_cbam_faltan')}: ${data.normativo.dpp.faltantes.join(', ')}`}
                  </div>
                </div>
              </div>
            </div>

            <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>{t('lote.disclaimer')}</p>

            <div className="no-print" style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <button className="btn btn-primary" onClick={() => window.print()}>{t('pas.imprimir')}</button>
              <a className="btn btn-outline" href={api.expedienteLoteUrl(data.pasaporte.codigo)} target="_blank" rel="noreferrer">
                {t('lote.expediente')}
              </a>
              <button className="btn btn-outline" onClick={copiarEnlace}>
                {copiado ? t('pos.copiado') : t('pas.copiar_enlace')}
              </button>
            </div>
          </div>
        )}
      </div>
    </PublicLayout>
  );
}
