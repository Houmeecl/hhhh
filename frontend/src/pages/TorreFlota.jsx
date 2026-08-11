import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import PublicLayout from '../components/PublicLayout.jsx';
import { api } from '../api.js';
import { useIdioma } from '../lib/i18n.js';
import { PUNTOS_CORREDOR, puntoDe, etiquetaInstruccion, horasSinAvance, estadoAvance, textoDuracion, resumenFlota } from '../lib/corredor.js';
import { useCatalogoCorredor } from '../lib/useCatalogoCorredor.js';
import { Icon, TRUCK_MARKER_SVG } from '../components/icons.jsx';

// ============================================================
// Torre de Control — FLOTA (/torre, sin código)
// Todos los camiones activos del corredor en un solo mapa: cada lote
// abierto con tarjeta de viaje es un camión. Un camión SIN pasos con
// punto reconocible aún no se dibuja — aparece en el mapa cuando el
// chofer ACTIVA su tarjeta con el primer paso.
// La vista exige credencial de operador (rol pos): es el tablero de la
// operación completa, no una página pública (el pasaporte de cada lote
// sigue siendo público por su propio código, como siempre).
// ============================================================

const POLL_MS = 5000;

export default function TorreFlota() {
  const { t } = useIdioma();
  const versionCatalogo = useCatalogoCorredor();
  const [token, setToken] = useState(null);
  const [nombre, setNombre] = useState('');
  const [flota, setFlota] = useState(null);
  const [kpis, setKpis] = useState(null); // agregados lentos (tramos/retrocesos), poll propio 60 s

  const cargar = useCallback(async () => {
    if (!token) return;
    try {
      const r = await api.torreFlota(token);
      if (r !== null) setFlota(r.flota || []); // null = 304 sin cambios, retener estado
    } catch (e) {
      if (/token|sesión|autoriza/i.test(e.message)) { setToken(null); setFlota(null); }
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    cargar();
    // Intervalo adaptativo: 5s visible, 30s oculto + refresh inmediato al volver
    let timer;
    const actualizarIntervalo = () => {
      clearInterval(timer);
      const intervalo = document.hidden ? 30000 : POLL_MS;
      timer = setInterval(cargar, intervalo);
    };
    actualizarIntervalo();
    const handleVisibility = () => {
      actualizarIntervalo();
      if (!document.hidden) cargar(); // refresh inmediato al volver
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [token, cargar]);

  // KPIs lentos (tramos/retrocesos): poll propio de 60 s — el backend
  // igual los cachea 60 s. Si falla, simplemente no se muestran.
  // Intervalo adaptativo: 60s visible, 180s oculto (KPIs cambian lentamente).
  useEffect(() => {
    if (!token) return;
    let vivo = true;
    const cargarKpis = async () => {
      try {
        const k = await api.torreKpis(token);
        if (vivo && k !== null) setKpis(k); // null = 304 sin cambios
      } catch { /* fallo silencioso */ }
    };
    cargarKpis();
    let timer;
    const actualizarIntervalo = () => {
      clearInterval(timer);
      const intervalo = document.hidden ? 180000 : 60000;
      timer = setInterval(cargarKpis, intervalo);
    };
    actualizarIntervalo();
    const handleVisibility = () => {
      actualizarIntervalo();
      if (!document.hidden) cargarKpis(); // refresh inmediato al volver
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      vivo = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [token]);

  // ---------- Mapa ----------
  const divRef = useRef(null);
  const mapaRef = useRef(null);
  const camionesRef = useRef(new Map()); // codigo -> marcador

  const baseRef = useRef(null);        // capa del trazado base + puntos
  const encuadradoRef = useRef(false); // encuadre inicial una sola vez

  useEffect(() => {
    if (!divRef.current || mapaRef.current || !token) return;
    const mapa = L.map(divRef.current, { scrollWheelZoom: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(mapa);
    mapaRef.current = mapa;
    encuadradoRef.current = false;
    return () => { mapa.remove(); mapaRef.current = null; baseRef.current = null; camionesRef.current = new Map(); };
  }, [token]);

  // Trazado base + puntos de control: effect propio con el catálogo como
  // dependencia — si el admin agrega/edita un punto (tabla puntos_corredor),
  // se redibuja sin recrear el mapa ni mover el encuadre del operador.
  useEffect(() => {
    const mapa = mapaRef.current;
    if (!mapa) return;
    if (baseRef.current) baseRef.current.remove();
    const capa = L.layerGroup().addTo(mapa);
    const coords = PUNTOS_CORREDOR.map((p) => [p.lat, p.lng]);
    L.polyline(coords, { color: '#94a3b8', weight: 2, dashArray: '6 6', opacity: 0.8 }).addTo(capa);
    for (const p of PUNTOS_CORREDOR) {
      L.circleMarker([p.lat, p.lng], { radius: 5, color: '#0f1f2e', weight: 2, fillColor: '#fff', fillOpacity: 1 })
        .addTo(capa).bindPopup(`<strong>${p.nombre}</strong><br>${p.pais}`);
    }
    baseRef.current = capa;
    if (!encuadradoRef.current) {
      mapa.fitBounds(L.latLngBounds(coords), { padding: [30, 30] });
      encuadradoRef.current = true;
    }
  }, [token, versionCatalogo]);

  // Colocar/actualizar un marcador por camión con posición conocida.
  useEffect(() => {
    const mapa = mapaRef.current;
    if (!mapa || !flota) return;
    const vivos = new Set();
    for (const c of flota) {
      const p = c.ultimo_paso ? puntoDe({ datos: c.ultimo_paso }) : null;
      if (!p) continue; // sin posición: aparece cuando active su primer paso
      vivos.add(c.codigo);
      const html = `<span class="torre-camion-emoji">${TRUCK_MARKER_SVG}</span><span class="torre-camion-tag">${c.codigo.slice(-6)}</span>`;
      let m = camionesRef.current.get(c.codigo);
      if (!m) {
        m = L.marker([p.lat, p.lng], {
          icon: L.divIcon({ className: 'torre-camion torre-camion-flota', html, iconSize: [86, 38], iconAnchor: [19, 19] }),
          zIndexOffset: 1000,
          keyboard: false,
        }).addTo(mapa);
        m.bindPopup(`<strong>${c.codigo}</strong>`);
        camionesRef.current.set(c.codigo, m);
      } else {
        m.setLatLng([p.lat, p.lng]);
      }
    }
    for (const [codigo, m] of camionesRef.current) {
      if (!vivos.has(codigo)) { m.remove(); camionesRef.current.delete(codigo); }
    }
  }, [flota]);

  async function entrar(serial, clave) {
    const r = await api.posAuth({ serial, clave });
    setNombre(r.terminal?.nombre || serial);
    setToken(r.token);
  }

  const enMapa = (flota || []).filter((c) => c.ultimo_paso && puntoDe({ datos: c.ultimo_paso }));
  const sinPos = (flota || []).filter((c) => !c.ultimo_paso || !puntoDe({ datos: c.ultimo_paso }));

  return (
    <PublicLayout>
      <div className="container torre-page">
        <div className="torre-head">
          <div>
            <div className="pas-kicker">sicr3p · {t('torre.titulo')}</div>
            <h1 className="torre-titulo">{t('torre.flota')}</h1>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>{t('torre.flota_sub')}</p>
          </div>
        </div>

        {!token ? (
          <LoginTorre t={t} onEntrar={entrar} />
        ) : (
          <>
            <p className="muted" style={{ fontSize: 12, margin: '0 0 10px' }}>
              ✓ {t('torre.conectado')}: {nombre} · {flota ? `${flota.length} ${t('torre.camiones')}` : '…'}
            </p>

            {/* KPIs de la operación: el conteo sale del MISMO array que
                colorea los marcadores (resumenFlota) — cards y mapa nunca
                se contradicen. Colapsable en móvil vía <details>. */}
            {flota && (
              <details open style={{ marginBottom: 12 }}>
                <summary className="muted" style={{ fontSize: 12, cursor: 'pointer', marginBottom: 6 }}>
                  {t('torre.kpi.titulo')}
                </summary>
                {(() => {
                  const r = resumenFlota(flota);
                  const card = (valor, etiqueta, color) => (
                    <div className="card" style={{ padding: '10px 14px', minWidth: 110, flex: '1 1 110px' }}>
                      <div style={{ fontSize: 22, fontWeight: 800, color }}>{valor}</div>
                      <div className="muted" style={{ fontSize: 11 }}>{etiqueta}</div>
                    </div>
                  );
                  return (
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      {card(r.en_ruta, t('torre.kpi.en_ruta'), 'var(--green-600)')}
                      {card(r.ambar, t('torre.kpi.ambar'), '#d97706')}
                      {card(r.rojo, t('torre.kpi.rojo'), '#dc2626')}
                      {card(r.sin_posicion, t('torre.kpi.sin_pos'), 'var(--gray)')}
                      {kpis && card(kpis.retrocesos_30d.n, t('torre.kpi.retrocesos'), kpis.retrocesos_30d.n > 0 ? '#d97706' : 'var(--gray)')}
                    </div>
                  );
                })()}
                {kpis && (
                  <div className="card" style={{ padding: '10px 14px', marginTop: 10 }}>
                    <div className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', marginBottom: 6 }}>
                      {t('torre.kpi.tramos')}
                    </div>
                    {kpis.tramos.length === 0 ? (
                      <p className="muted" style={{ fontSize: 12, margin: 0 }}>{t('torre.kpi.sin_datos')}</p>
                    ) : (
                      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                        {kpis.tramos.map((tr) => {
                          const nDesde = puntoDe({ datos: { punto_id: tr.desde } })?.nombre || tr.desde;
                          const nHasta = puntoDe({ datos: { punto_id: tr.hasta } })?.nombre || tr.hasta;
                          return (
                            <div key={`${tr.desde}-${tr.hasta}`} style={{ fontSize: 12 }}>
                              <b>{nDesde} → {nHasta}</b>
                              <span className="muted"> · {tr.horas_promedio} {t('torre.kpi.horas')} · {tr.n} {t('torre.kpi.pasos_n')}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </details>
            )}
            <div className="torre-layout">
              <div>
                <div ref={divRef} className="torre-mapa" />
                <p className="muted" style={{ fontSize: 11, margin: '6px 0 0' }}>{t('torre.mapa_nota')}</p>
              </div>
              <div className="torre-panel">
                <div className="card card-pad">
                  <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>{t('torre.camiones')} ({(flota || []).length})</h3>
                  {flota && !flota.length && <p className="muted" style={{ fontSize: 13 }}>{t('torre.flota_vacia')}</p>}
                  {[...enMapa, ...sinPos].map((c) => {
                    const p = c.ultimo_paso ? puntoDe({ datos: c.ultimo_paso }) : null;
                    // Ordenado por el backend (más tiempo sin avance primero);
                    // acá solo se colorea, no se reordena.
                    const horas = horasSinAvance(c.ultimo_paso?.creado);
                    const estado = estadoAvance(horas);
                    const colorIcono = estado === 'rojo' ? '#dc2626' : estado === 'ambar' ? '#d97706' : p ? 'var(--green-600)' : 'var(--gray)';
                    return (
                      <div key={c.codigo} className="torre-msg">
                        <span style={{ color: colorIcono }} title={estado === 'rojo' || estado === 'ambar' ? `${t('torre.sin_avance')} ${textoDuracion(horas)}` : undefined}>
                          {p ? <Icon.Truck size={20} /> : <Icon.Pause size={20} />}
                        </span>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>
                            <span className="mono">{c.codigo}</span>
                            {c.tarjetas?.[0]?.portador ? ` · ${c.tarjetas[0].portador}` : ''}
                          </div>
                          <div className="muted" style={{ fontSize: 11 }}>
                            {p ? `${p.nombre}` : (c.ultimo_paso?.punto_control || t('torre.sin_posicion'))}
                            {c.instruccion ? ` · 📢 ${etiquetaInstruccion(c.instruccion, t)}` : ''}
                            {(estado === 'ambar' || estado === 'rojo') && (
                              <span style={{ color: colorIcono, fontWeight: 700 }}> · {t('torre.sin_avance')} {textoDuracion(horas)}</span>
                            )}
                          </div>
                        </div>
                        <Link className="btn btn-sm btn-outline" to={`/torre/${c.codigo}`}>{t('torre.abrir')}</Link>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <p className="muted" style={{ fontSize: 11, margin: '14px 0 30px' }}>{t('torre.disclaimer')}</p>
          </>
        )}
      </div>
    </PublicLayout>
  );
}

function LoginTorre({ t, onEntrar }) {
  const [serial, setSerial] = useState('');
  const [clave, setClave] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [err, setErr] = useState('');

  async function entrar() {
    if (!serial.trim() || !clave.trim()) return;
    setOcupado(true);
    setErr('');
    try { await onEntrar(serial.trim(), clave.trim()); }
    catch (e) { setErr(e.message); }
    finally { setOcupado(false); }
  }

  return (
    <div className="card card-pad" style={{ maxWidth: 420, margin: '20px auto' }}>
      <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>🗼 {t('torre.operador')}</h3>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>{t('torre.flota_hint')}</p>
      <div className="field">
        <label>{t('torre.serial')}</label>
        <input value={serial} placeholder="AV-XXXX" onChange={(e) => setSerial(e.target.value.toUpperCase())} autoComplete="off" />
      </div>
      <div className="field">
        <label>{t('torre.clave')}</label>
        <input type="password" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="off"
          onKeyDown={(e) => e.key === 'Enter' && entrar()} />
      </div>
      {err && <div className="badge badge-red" style={{ marginBottom: 8 }}>{err}</div>}
      <button className="btn btn-primary" style={{ width: '100%' }} onClick={entrar} disabled={ocupado}>
        {ocupado ? <span className="spinner" /> : t('torre.entrar')}
      </button>
      <p className="muted" style={{ fontSize: 11, textAlign: 'center', marginTop: 10 }}>
        {t('torre.perdiste_clave')}{' '}
        <a href="mailto:contacto@sicrep.cl?subject=Recuperar%20clave%20de%20terminal%20torre">{t('torre.perdiste_clave_link')}</a>
      </p>
    </div>
  );
}
