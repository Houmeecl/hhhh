import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import PublicLayout from '../components/PublicLayout.jsx';
import { Icon, TRUCK_MARKER_SVG } from '../components/icons.jsx';
import { api } from '../api.js';
import { useIdioma } from '../lib/i18n.js';
import {
  PUNTOS_CORREDOR, PUNTOS_FRONTERA, puntoDe, puntoDestinoDe, etiquetaInstruccion,
  horasSinAvance, estadoAvance, textoDuracion, pasosRetrocedidos,
} from '../lib/corredor.js';
import { useCatalogoCorredor } from '../lib/useCatalogoCorredor.js';

// ============================================================
// Torre de Control — /torre/:codigo
// Mapa real (OpenStreetMap) del Corredor Bioceánico: el camión aparece
// en el ÚLTIMO punto de control cuyo paso quedó sellado en la cadena
// del lote (sin GPS: la posición es el paso, no un rastreo). La página
// se actualiza sola cada 5 s; escanear el QR y registrar un paso en
// /v/{serial} mueve el camión aquí.
// El OPERADOR (credencial de terminal, rol pos) puede enviar la
// instrucción "puerto seco" / "puerto", que el portador ve al instante
// en su credencial. Esta página es de lectura pública: solo muestra lo
// que el lote ya divulga en su pasaporte.
// ============================================================

const POLL_MS = 5000;

export default function Torre() {
  const { codigo } = useParams();
  const { t } = useIdioma();
  const versionCatalogo = useCatalogoCorredor();
  const [data, setData] = useState(null);
  const [mensajes, setMensajes] = useState([]);
  const [error, setError] = useState('');

  const cargar = useCallback(async () => {
    try {
      const [d, m] = await Promise.all([
        api.lotePublico(codigo),
        api.loteMensajes(codigo).catch(() => ({ mensajes: [] })),
      ]);
      setData(d);
      setMensajes(m.mensajes || []);
      setError('');
    } catch (e) {
      if (!data) setError(e.message);
    }
  }, [codigo, data]);

  useEffect(() => {
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
  }, [cargar]);

  // ---------- Mapa ----------
  const divRef = useRef(null);      // contenedor
  const mapaRef = useRef(null);     // L.Map
  const camionRef = useRef(null);   // marcador del camión
  const rutaRef = useRef(null);     // polilínea de pasos sellados
  const destinoRef = useRef(null);  // línea punteada hacia la instrucción
  const puntosRef = useRef({});     // id -> circleMarker
  const ultimoIdRef = useRef(null); // último punto donde estuvo el camión

  const baseRef = useRef(null);     // capa del trazado base + puntos (se redibuja si cambia el catálogo)
  const encuadradoRef = useRef(false);

  useEffect(() => {
    if (!divRef.current || mapaRef.current) return;
    const mapa = L.map(divRef.current, { scrollWheelZoom: true, zoomControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(mapa);

    // Polilínea de la ruta real (pasos sellados) y camión.
    rutaRef.current = L.polyline([], { color: '#28a745', weight: 4, opacity: 0.9 }).addTo(mapa);
    camionRef.current = L.marker([PUNTOS_CORREDOR[0].lat, PUNTOS_CORREDOR[0].lng], {
      icon: L.divIcon({ className: 'torre-camion', html: TRUCK_MARKER_SVG, iconSize: [38, 38], iconAnchor: [19, 19] }),
      opacity: 0,
      zIndexOffset: 1000,
      keyboard: false,
    }).addTo(mapa);

    mapaRef.current = mapa;
    return () => { mapa.remove(); mapaRef.current = null; };
  }, []);

  // Trazado base del corredor (referencial) + puntos de control — en su
  // propio effect con `version` como dependencia: si el catálogo cambió
  // en runtime (tabla puntos_corredor), se redibuja sin recrear el mapa.
  // El encuadre inicial solo la primera vez (no moverle el mapa al
  // operador por una edición de catálogo).
  useEffect(() => {
    const mapa = mapaRef.current;
    if (!mapa) return;
    if (baseRef.current) { baseRef.current.remove(); puntosRef.current = {}; }
    const capa = L.layerGroup().addTo(mapa);
    const coords = PUNTOS_CORREDOR.map((p) => [p.lat, p.lng]);
    L.polyline(coords, { color: '#94a3b8', weight: 2, dashArray: '6 6', opacity: 0.8 }).addTo(capa);
    for (const p of PUNTOS_CORREDOR) {
      const c = L.circleMarker([p.lat, p.lng], {
        radius: 6, color: '#0f1f2e', weight: 2, fillColor: '#ffffff', fillOpacity: 1,
      }).addTo(capa);
      c.bindPopup(`<strong>${p.nombre}</strong><br>${p.pais}`);
      puntosRef.current[p.id] = c;
    }
    baseRef.current = capa;
    if (!encuadradoRef.current) {
      mapa.fitBounds(L.latLngBounds(coords), { padding: [30, 30] });
      encuadradoRef.current = true;
    }
  }, [versionCatalogo]);

  // Recolocar camión / ruta / destino cuando llegan datos nuevos.
  useEffect(() => {
    const mapa = mapaRef.current;
    if (!mapa || !data) return;

    const eslabones = data.cadena?.eslabones || [];
    const visitados = [];
    for (const e of eslabones) {
      const p = puntoDe(e);
      if (p && visitados[visitados.length - 1]?.id !== p.id) visitados.push(p);
    }

    // Pintar los puntos ya visitados.
    const idsVisitados = new Set(visitados.map((p) => p.id));
    for (const [id, marcador] of Object.entries(puntosRef.current)) {
      marcador.setStyle(idsVisitados.has(id)
        ? { fillColor: '#28a745', color: '#218838' }
        : { fillColor: '#ffffff', color: '#0f1f2e' });
    }
    rutaRef.current.setLatLngs(visitados.map((p) => [p.lat, p.lng]));

    const ultimo = visitados[visitados.length - 1] || null;
    if (ultimo) {
      camionRef.current.setLatLng([ultimo.lat, ultimo.lng]);
      camionRef.current.setOpacity(1);
      if (ultimoIdRef.current && ultimoIdRef.current !== ultimo.id) {
        mapa.panTo([ultimo.lat, ultimo.lng], { animate: true, duration: 1 });
      }
      ultimoIdRef.current = ultimo.id;
    }

    // Instrucción vigente → línea punteada camión→destino.
    if (destinoRef.current) { destinoRef.current.remove(); destinoRef.current = null; }
    const vigente = mensajes[0];
    const destino = puntoDestinoDe(vigente);
    if (ultimo && destino && destino.id !== ultimo.id) {
      destinoRef.current = L.polyline(
        [[ultimo.lat, ultimo.lng], [destino.lat, destino.lng]],
        { color: '#d97706', weight: 3, dashArray: '4 8', opacity: 0.9 }
      ).addTo(mapa);
    }
  }, [data, mensajes]);

  const eslabones = data?.cadena?.eslabones || [];
  const pasos = eslabones.filter((e) => e.datos?.punto_control || e.datos?.punto_id);
  const vigente = mensajes[0] || null;
  const hayCamion = pasos.some((e) => puntoDe(e));
  // Alerta de avance: horas desde el ÚLTIMO paso sellado (con o sin punto
  // reconocido en el mapa — cualquier paso cuenta como actividad real).
  const horas = horasSinAvance(pasos[pasos.length - 1]?.creado);
  const estado = estadoAvance(horas);
  const retrocedidos = pasosRetrocedidos(pasos);

  return (
    <PublicLayout>
      <div className="container torre-page">
        <div className="torre-head">
          <div>
            <div className="pas-kicker">sicr3p · {t('torre.titulo')}</div>
            <h1 className="torre-titulo">
              {t('torre.lote')} <span className="mono">{codigo}</span>
              {data && (
                <span className={`badge ${data.cadena?.integra ? 'badge-green' : 'badge-red'}`} style={{ marginLeft: 10, verticalAlign: 'middle' }}>
                  {data.cadena?.integra ? t('torre.integra') : t('torre.no_integra')}
                </span>
              )}
            </h1>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>{t('torre.sub')}</p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link className="btn btn-outline btn-sm" to={`/lote/${codigo}`}>{t('tv.ver_pasaporte')}</Link>
          </div>
        </div>

        {error && (
          <div className="card card-pad" style={{ textAlign: 'center', margin: '20px 0' }}>
            <div style={{ color: '#b45309', display: 'flex', justifyContent: 'center' }}><Icon.Alert size={36} /></div>
            <p className="muted">{t('torre.error')}</p>
          </div>
        )}

        {!error && !data && (
          <div className="card card-pad" style={{ textAlign: 'center', margin: '20px 0' }}>
            <span className="spinner dark" /> Cargando…
          </div>
        )}

        {!error && data && (
          <>
            {(estado === 'ambar' || estado === 'rojo') && (
              <div className={`torre-banner ${estado === 'rojo' ? 'torre-banner-rojo' : ''}`} title={t('torre.sin_avance_hint')}>
                <span className="torre-banner-icono">{estado === 'rojo' ? '🔴' : '🟡'}</span>
                <div>
                  <div className="torre-banner-titulo">{t('torre.sin_avance')} {textoDuracion(horas)}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{t('torre.sin_avance_hint')}</div>
                </div>
              </div>
            )}
            {vigente && (
              <div className="torre-banner">
                <span className="torre-banner-icono">📢</span>
                <div>
                  <div className="torre-banner-titulo">{t('torre.vigente')}: {etiquetaInstruccion(vigente, t)}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {vigente.nota ? `${vigente.nota} · ` : ''}{vigente.emisor} · {new Date(vigente.creado).toLocaleString('es-CL')}
                  </div>
                </div>
              </div>
            )}

            <div className="torre-layout">
              <div>
                <div ref={divRef} className="torre-mapa" />
                <p className="muted" style={{ fontSize: 11, margin: '6px 0 0' }}>
                  {!hayCamion ? `${t('torre.esperando')} · ` : ''}{t('torre.mapa_nota')}
                </p>
              </div>

              <div className="torre-panel">
                <Operador codigo={codigo} t={t} onEnviado={cargar} />

                <div className="card card-pad" style={{ marginTop: 12 }}>
                  <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>{t('torre.mensajes')}</h3>
                  {!mensajes.length && <p className="muted" style={{ fontSize: 13 }}>{t('torre.sin_mensajes')}</p>}
                  {mensajes.map((m, i) => (
                    <div key={i} className="torre-msg">
                      <span className={`badge ${m.destino === 'puerto' ? 'badge-green' : 'badge-gray'}`}>
                        {etiquetaInstruccion(m, t)}
                      </span>
                      <div style={{ minWidth: 0 }}>
                        {m.nota && <div style={{ fontSize: 13 }}>{m.nota}</div>}
                        <div className="muted" style={{ fontSize: 11 }}>{m.emisor} · {new Date(m.creado).toLocaleString('es-CL')}</div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="card card-pad" style={{ marginTop: 12 }}>
                  <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>{t('torre.pasos')} ({pasos.length})</h3>
                  {!pasos.length && <p className="muted" style={{ fontSize: 13 }}>{t('torre.esperando')}</p>}
                  <div className="tl">
                    {[...pasos].reverse().map((e) => (
                      <div className="tl-item" key={e.eslabon}>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>
                            <span title={e.datos?.via_qr ? 'Registrado escaneando el punto de control' : 'Registrado a mano'}>
                              {e.datos?.via_qr ? '📷' : '⌨️'}
                            </span>{' '}
                            #{e.eslabon} · {e.datos?.punto_control || e.datos?.punto_id}
                            {!puntoDe(e) && <span className="muted" style={{ fontWeight: 400 }}> · {t('torre.fuera_mapa')}</span>}
                            {retrocedidos.has(e.eslabon) && (
                              <span className="torre-retroceso" title={t('torre.retrocedio_hint')}> · ↩ {t('torre.retrocedio')}</span>
                            )}
                          </div>
                          <div className="muted" style={{ fontSize: 11 }}>
                            {e.pais} · {e.fecha ? new Date(e.fecha).toLocaleDateString('es-CL') : ''}
                            {e.nombre_empresa ? ` · ${e.nombre_empresa}` : ''}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
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

// Caja del operador: inicia sesión con la credencial del terminal
// (rol pos) y envía la instrucción. El token vive solo en memoria.
function Operador({ codigo, t, onEnviado }) {
  const [token, setToken] = useState(null);
  const [nombre, setNombre] = useState('');
  const [serial, setSerial] = useState('');
  const [clave, setClave] = useState('');
  const [destino, setDestino] = useState('puerto');
  const [zona, setZona] = useState('');
  const [nota, setNota] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState(null);
  const flash = (texto, error) => { setMsg({ texto, error }); setTimeout(() => setMsg(null), 4000); };

  async function entrar() {
    if (!serial.trim() || !clave.trim()) return;
    setOcupado(true);
    try {
      const r = await api.posAuth({ serial: serial.trim(), clave: clave.trim() });
      setToken(r.token);
      setNombre(r.terminal?.nombre || serial.trim());
      setClave('');
    } catch (e) { flash(e.message, true); }
    finally { setOcupado(false); }
  }

  async function enviar() {
    if (destino === 'estacionamiento' && !zona.trim()) { flash(t('torre.falta_zona'), true); return; }
    if (destino === 'frontera' && !zona) { flash(t('torre.falta_paso'), true); return; }
    setOcupado(true);
    try {
      await api.torreMensaje(token, {
        codigo_lote: codigo,
        destino,
        zona: (destino === 'estacionamiento' || destino === 'frontera') ? zona.trim() : undefined,
        nota: nota.trim() || undefined,
      });
      setNota('');
      setZona('');
      flash(`✓ ${t('torre.enviado')}`);
      onEnviado();
    } catch (e) {
      flash(e.message, true);
      if (/token|sesión|autoriza/i.test(e.message)) setToken(null);
    } finally { setOcupado(false); }
  }

  const DESTINOS = [
    { valor: 'puerto', etiqueta: t('torre.puerto') },
    { valor: 'puerto_seco', etiqueta: t('torre.puerto_seco') },
    { valor: 'estacionamiento', etiqueta: t('torre.estacionamiento') },
    { valor: 'frontera', etiqueta: t('torre.frontera') },
  ];

  return (
    <div className="card card-pad">
      <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>🗼 {t('torre.operador')}</h3>
      {!token ? (
        <>
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>{t('torre.operador_hint')}</p>
          <div className="field">
            <label>{t('torre.serial')}</label>
            <input value={serial} placeholder="AV-XXXX" onChange={(e) => setSerial(e.target.value.toUpperCase())} autoComplete="off" />
          </div>
          <div className="field">
            <label>{t('torre.clave')}</label>
            <input type="password" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="off"
              onKeyDown={(e) => e.key === 'Enter' && entrar()} />
          </div>
          {msg && <div className={`badge ${msg.error ? 'badge-red' : 'badge-green'}`} style={{ marginBottom: 8 }}>{msg.texto}</div>}
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={entrar} disabled={ocupado}>
            {ocupado ? <span className="spinner" /> : t('torre.entrar')}
          </button>
          <p className="muted" style={{ fontSize: 11, textAlign: 'center', marginTop: 10 }}>
            {t('torre.perdiste_clave')}{' '}
            <a href="mailto:contacto@sicrep.cl?subject=Recuperar%20clave%20de%20terminal%20torre">{t('torre.perdiste_clave_link')}</a>
          </p>
        </>
      ) : (
        <>
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>✓ {t('torre.conectado')}: {nombre}</p>
          <div className="field">
            <label>{t('torre.destino')}</label>
            <div className="torre-dest">
              {DESTINOS.map((d) => (
                <button key={d.valor} type="button"
                  className={`torre-dest-btn ${destino === d.valor ? 'activo' : ''}`}
                  onClick={() => { setDestino(d.valor); setZona(''); }}>
                  {d.etiqueta}
                </button>
              ))}
            </div>
          </div>
          {destino === 'estacionamiento' && (
            <div className="field">
              <label>{t('torre.zona')}</label>
              <input value={zona} maxLength={60} placeholder={t('torre.zona_ej')} onChange={(e) => setZona(e.target.value)} />
            </div>
          )}
          {destino === 'frontera' && (
            <div className="field">
              <label>{t('torre.paso')}</label>
              <select value={zona} onChange={(e) => setZona(e.target.value)}>
                <option value="">—</option>
                {PUNTOS_FRONTERA.map((id) => (
                  <option key={id} value={id}>{PUNTOS_CORREDOR.find((p) => p.id === id)?.nombre || id}</option>
                ))}
              </select>
            </div>
          )}
          <div className="field">
            <label>{t('torre.nota')}</label>
            <input value={nota} maxLength={200} onChange={(e) => setNota(e.target.value)} />
          </div>
          {msg && <div className={`badge ${msg.error ? 'badge-red' : 'badge-green'}`} style={{ marginBottom: 8 }}>{msg.texto}</div>}
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={enviar} disabled={ocupado}>
            {ocupado ? <span className="spinner" /> : t('torre.enviar')}
          </button>
        </>
      )}
    </div>
  );
}
