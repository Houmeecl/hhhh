import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout.jsx';
import { Icon } from '../components/icons.jsx';

// ============================================================
// Cadena de integridad pública de sicr3p.
//
// Cada documento procesado queda encadenado por hash SHA-256 al anterior:
// alterar un registro pasado rompe todos los hashes siguientes y la cadena
// deja de estar "intacta". Esta página muestra el estado global y los
// últimos eslabones, ANONIMIZADOS (sin RUT ni empresas).
//
// Los datos vienen de GET /api/publico/cadena con fetch directo (sin api.js,
// que está siendo modificado en paralelo): endpoint público sin token.
// ============================================================

// Formateo local es-CL (a propósito no se importa nada de api.js).
const fmtInt = (n) => Number(n || 0).toLocaleString('es-CL');
const fmtCo2e = (n) =>
  Number(n || 0).toLocaleString('es-CL', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

function fmtFecha(f) {
  const d = new Date(f);
  if (isNaN(d)) return String(f ?? '');
  return d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' });
}

// "verificada hace Xs" / "hace X min" a partir de segundos.
function fmtHace(s) {
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  if (n < 60) return `hace ${Math.round(n)} s`;
  const min = Math.round(n / 60);
  return `hace ${min} min`;
}

export default function Cadena() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(() => {
    setCargando(true);
    setError('');
    fetch('/api/publico/cadena')
      .then(async (res) => {
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error || 'No se pudo consultar la cadena.');
        setData(d);
      })
      .catch((e) => setError(e.message || 'No se pudo consultar la cadena.'))
      .finally(() => setCargando(false));
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const estado = data?.estado;
  const eslabones = data?.eslabones || [];
  const hace = estado ? fmtHace(estado.verificado_hace_s) : null;

  return (
    <PublicLayout>
      <div className="container" style={{ padding: '48px 24px', maxWidth: 760 }}>
        {/* Hero compacto */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ color: 'var(--green-600)', display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
            <Icon.Shield size={36} />
          </div>
          <h1 style={{ fontSize: 32, margin: '0 0 8px', letterSpacing: '-0.02em' }}>
            Cadena de integridad sicr3p
          </h1>
          <p className="muted" style={{ margin: '0 auto', maxWidth: 560, fontSize: 15, lineHeight: 1.6 }}>
            Cada documento procesado queda encadenado por hash SHA-256 al anterior:
            alterar el pasado rompe la cadena y se nota de inmediato.
          </p>
        </div>

        {/* Estado de carga: skeleton */}
        {cargando && (
          <div aria-busy="true" aria-label="Cargando estado de la cadena">
            <div className="card card-pad" style={{ marginBottom: 20 }}>
              <div className="skeleton" style={{ height: 44, width: 120, marginBottom: 12 }} />
              <div className="skeleton" style={{ height: 18, width: '60%', marginBottom: 8 }} />
              <div className="skeleton" style={{ height: 14, width: '40%' }} />
            </div>
            {[0, 1, 2].map((i) => (
              <div className="card" key={i} style={{ padding: '14px 18px', marginBottom: 10 }}>
                <div className="skeleton" style={{ height: 15, width: '75%', marginBottom: 6 }} />
                <div className="skeleton" style={{ height: 13, width: '45%' }} />
              </div>
            ))}
          </div>
        )}

        {/* Error con reintento */}
        {!cargando && error && (
          <div className="card card-pad" style={{ textAlign: 'center' }}>
            <div style={{ color: '#b45309', display: 'flex', justifyContent: 'center' }}><Icon.Alert size={40} /></div>
            <h2 style={{ margin: '10px 0 6px' }}>No pudimos consultar la cadena</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              {error} Puede ser un problema momentáneo de conexión.
            </p>
            <button className="btn btn-primary" onClick={cargar}>Reintentar</button>
          </div>
        )}

        {!cargando && !error && data && (
          <>
            {/* Estado global de la cadena */}
            <div className="card card-pad" style={{ marginBottom: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 42, fontWeight: 800, color: 'var(--navy)', lineHeight: 1 }}>
                    {fmtInt(estado?.n_eslabones)}
                  </div>
                  <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                    eslabon{Number(estado?.n_eslabones) === 1 ? '' : 'es'} encadenado{Number(estado?.n_eslabones) === 1 ? '' : 's'}
                  </div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span
                    className={`badge ${estado?.intacta ? 'badge-green' : 'badge-red'}`}
                    style={{ fontSize: 14, padding: '6px 14px' }}
                  >
                    {estado?.intacta ? '✓ Cadena intacta' : '⚠ Cadena alterada'}
                  </span>
                  {hace && (
                    <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                      Verificada {hace}
                    </div>
                  )}
                </div>
              </div>
              {estado?.ultimo_hash_corto && (
                <div style={{ marginTop: 14, padding: '10px 14px', background: 'var(--bg)', borderRadius: 10, minWidth: 0 }}>
                  <span className="muted" style={{ fontSize: 12 }}>Último hash de la cadena</span>
                  <div style={{ fontFamily: 'monospace', fontSize: 14, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {estado.ultimo_hash_corto}
                  </div>
                </div>
              )}
            </div>

            {/* Últimos eslabones, unidos por una línea vertical */}
            <h2 style={{ fontSize: 20, margin: '0 0 4px' }}>Últimos eslabones</h2>
            <p className="muted" style={{ fontSize: 13, marginTop: 0, marginBottom: 16 }}>
              Datos anonimizados: la lista no muestra RUT ni empresas. Cada eslabón abre su verificación pública.
            </p>

            {eslabones.length === 0 && (
              <div className="card card-pad" style={{ textAlign: 'center' }}>
                <p className="muted" style={{ margin: 0 }}>
                  Todavía no hay documentos en la cadena. El primer documento procesado creará el eslabón #1.
                </p>
              </div>
            )}

            <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {eslabones.map((e, i) => (
                <li key={`${e.eslabon}-${e.factura_id}`} style={{ display: 'flex', gap: 12, minWidth: 0 }}>
                  {/* Conector vertical: nodo + línea que sugiere el encadenamiento */}
                  <div aria-hidden="true" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 16, flexShrink: 0 }}>
                    <span style={{
                      width: 12, height: 12, borderRadius: '50%', marginTop: 22, flexShrink: 0,
                      background: '#fff', border: '3px solid var(--green)',
                    }} />
                    {i < eslabones.length - 1 && (
                      <span style={{ width: 2, flex: 1, background: 'var(--border)', minHeight: 18 }} />
                    )}
                  </div>

                  <a
                    href={`/verificar/${e.factura_id}`}
                    className="card"
                    aria-label={`Eslabón ${e.eslabon}: ver verificación pública del documento`}
                    style={{
                      flex: 1, minWidth: 0, display: 'block', padding: '12px 16px',
                      marginBottom: 12, color: 'inherit', textDecoration: 'none',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', minWidth: 0 }}>
                      <b style={{ fontSize: 15, whiteSpace: 'nowrap' }}>Eslabón #{fmtInt(e.eslabon)}</b>
                      <span className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{fmtFecha(e.fecha)}</span>
                      <span style={{ marginLeft: 'auto', fontWeight: 700, fontSize: 13, color: 'var(--green-600)', whiteSpace: 'nowrap' }}>
                        {fmtCo2e(e.t_co2e)} t CO2e
                      </span>
                    </div>
                    <div style={{
                      fontFamily: 'monospace', fontSize: 12, color: 'var(--gray)', marginTop: 4,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {e.hash_corto}
                    </div>
                  </a>
                </li>
              ))}
            </ol>

            {/* Honestidad: qué garantiza y qué NO es */}
            <div style={{ marginTop: 20, padding: '14px 18px', background: 'var(--bg)', borderRadius: 12 }}>
              <p className="muted" style={{ fontSize: 13, lineHeight: 1.6, margin: 0 }}>
                <b style={{ color: 'var(--navy)' }}>Qué garantiza:</b> integridad interna del registro de sicr3p.
                Cada eslabón incorpora el hash del anterior, por lo que nadie —incluidos nosotros— puede alterar
                un registro pasado sin que la cadena deje de calzar y se note.{' '}
                <b style={{ color: 'var(--navy)' }}>Qué no es:</b> no es una red blockchain pública ni constituye
                verificación de tercera parte acreditada. Los datos de esta página están anonimizados: no se
                muestran RUT ni nombres de empresas.
              </p>
            </div>

            <p style={{ textAlign: 'center', marginTop: 24 }}>
              <Link to="/cargar" className="btn btn-outline btn-sm">Procesa tus documentos y súmate a la cadena</Link>
            </p>
          </>
        )}
      </div>
    </PublicLayout>
  );
}
