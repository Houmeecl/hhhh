import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import PublicLayout from '../components/PublicLayout.jsx';
import { api } from '../api.js';
import { useIdioma } from '../lib/i18n.js';
import { PUNTOS_CORREDOR, puntoDe, etiquetaInstruccion } from '../lib/corredor.js';
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
  const [token, setToken] = useState(null);
  const [nombre, setNombre] = useState('');
  const [flota, setFlota] = useState(null);

  const cargar = useCallback(async () => {
    if (!token || document.hidden) return;
    try {
      const r = await api.torreFlota(token);
      setFlota(r.flota || []);
    } catch (e) {
      if (/token|sesión|autoriza/i.test(e.message)) { setToken(null); setFlota(null); }
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    cargar();
    const timer = setInterval(cargar, POLL_MS);
    return () => clearInterval(timer);
  }, [token, cargar]);

  // ---------- Mapa ----------
  const divRef = useRef(null);
  const mapaRef = useRef(null);
  const camionesRef = useRef(new Map()); // codigo -> marcador

  useEffect(() => {
    if (!divRef.current || mapaRef.current || !token) return;
    const mapa = L.map(divRef.current, { scrollWheelZoom: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(mapa);
    const coords = PUNTOS_CORREDOR.map((p) => [p.lat, p.lng]);
    L.polyline(coords, { color: '#94a3b8', weight: 2, dashArray: '6 6', opacity: 0.8 }).addTo(mapa);
    for (const p of PUNTOS_CORREDOR) {
      L.circleMarker([p.lat, p.lng], { radius: 5, color: '#0f1f2e', weight: 2, fillColor: '#fff', fillOpacity: 1 })
        .addTo(mapa).bindPopup(`<strong>${p.nombre}</strong><br>${p.pais}`);
    }
    mapa.fitBounds(L.latLngBounds(coords), { padding: [30, 30] });
    mapaRef.current = mapa;
    return () => { mapa.remove(); mapaRef.current = null; camionesRef.current = new Map(); };
  }, [token]);

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
                    return (
                      <div key={c.codigo} className="torre-msg">
                        <span style={{ color: p ? 'var(--green-600)' : 'var(--gray)' }}>
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
