import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout.jsx';
import { Icon } from '../components/icons.jsx';
import { api } from '../api.js';
import { useIdioma } from '../lib/i18n.js';
import { PUNTOS_CORREDOR, etiquetaInstruccion } from '../lib/corredor.js';
import { useCatalogoCorredor } from '../lib/useCatalogoCorredor.js';
import { useEscanerQR, idPuntoDesdeQr } from '../lib/qrScan.js';
import { encolarPaso, listarPendientes, quitarPendiente, esErrorDeConexion } from '../lib/pasoOffline.js';

// Tarjeta de Viaje: la URL grabada en el NDEF de la tarjeta NFC/RFID
// que acompaña a la carga es /v/{serial}. Cualquiera que la lea llega
// aquí y puede VER el pasaporte del lote (solo lectura). El PORTADOR
// (clave entregada junto con la tarjeta) registra pasos en ruta — cada
// paso queda sellado como eslabón de transporte en la cadena del lote:
// la secuencia de pasos ES la ruta, sin GPS.
export default function TarjetaViaje() {
  const { serial } = useParams();
  const { t } = useIdioma();
  useCatalogoCorredor(); // el select de puntos refleja el catálogo vivo (re-render vía version)
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  // La instrucción de la torre ya NO viene en /v/:serial: ahí el destino
  // de cada carga quedaba a la vista de cualquiera que probara seriales.
  // Se pide con el token que devuelve la clave del portador, y se guarda
  // solo en memoria — nada de localStorage: es una credencial.
  const [token, setToken] = useState(null);
  const [instruccion, setInstruccion] = useState(null);
  // Formulario del portador
  const [abierto, setAbierto] = useState(false);
  const [clave, setClave] = useState('');
  const [puntoId, setPuntoId] = useState('');   // punto del catálogo del corredor
  const [punto, setPunto] = useState('');       // texto libre (si no es del catálogo)
  const [pais, setPais] = useState('CL');
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [errPaso, setErrPaso] = useState('');
  // Escaneo de QR del punto de control (frontend/src/lib/qrScan.js).
  const [escaneando, setEscaneando] = useState(false);
  const [avisoQr, setAvisoQr] = useState('');
  const [viaQr, setViaQr] = useState(false);
  // Cola local de pasos sin señal (frontend/src/lib/pasoOffline.js).
  const [pendientes, setPendientes] = useState(() => listarPendientes(serial));
  const [enviandoPendientes, setEnviandoPendientes] = useState(false);
  const claveRef = useRef(clave);
  useEffect(() => { claveRef.current = clave; }, [clave]);

  // Identidad del lote: pública, se lee una vez.
  useEffect(() => {
    api.tarjetaResolver(serial).then(setInfo).catch((e) => setError(e.message));
  }, [serial]);

  // La instrucción se refresca sola mientras haya token: así el portador
  // ve un cambio de destino ("puerto seco" / "puerto") apenas lo envían,
  // sin recargar. Si el token vence, se limpia y la pantalla vuelve a
  // pedir la clave en vez de dejar a la vista una instrucción vieja.
  useEffect(() => {
    if (!token) return undefined;
    let vivo = true;
    const cargar = () => {
      if (document.hidden) return;
      api.tarjetaInstruccion(token)
        .then((r) => { if (vivo) setInstruccion(r.instruccion); })
        .catch(() => { if (vivo) { setToken(null); setInstruccion(null); } });
    };
    cargar();
    const timer = setInterval(cargar, 10000);
    return () => { vivo = false; clearInterval(timer); };
  }, [token]);

  const elegirPunto = (id) => {
    setPuntoId(id);
    const p = PUNTOS_CORREDOR.find((x) => x.id === id);
    if (p) { setPais(p.pais); setPunto(''); }
  };

  const { videoRef } = useEscanerQR({
    activo: escaneando,
    onDetect: (texto) => {
      const id = idPuntoDesdeQr(texto);
      const p = id && PUNTOS_CORREDOR.find((x) => x.id === id);
      setEscaneando(false);
      if (p) {
        elegirPunto(p.id);
        setViaQr(true);
        setAvisoQr('');
      } else {
        setAvisoQr(t('tv.qr_no_reconocido'));
      }
    },
    onError: () => {
      setEscaneando(false);
      setAvisoQr(t('tv.camara_denegada'));
    },
  });

  // Vacía la cola de pasos pendientes con un token recién obtenido — se
  // llama apenas hay una autenticación exitosa (prueba de que hay señal),
  // nunca con un token guardado: no se persiste ninguna credencial.
  async function flushPendientes(token) {
    const lista = listarPendientes(serial);
    if (!lista.length) return;
    setEnviandoPendientes(true);
    for (const p of lista) {
      const { id, capturado_en, ...body } = p;
      try {
        await api.tarjetaPaso(token, { ...body, capturado_en });
        quitarPendiente(serial, id);
      } catch {
        break; // probablemente sigue sin señal: se deja el resto para el próximo intento
      }
    }
    setPendientes(listarPendientes(serial));
    setEnviandoPendientes(false);
  }

  async function reintentarPendientesAhora() {
    if (!clave.trim()) { setErrPaso(t('tv.falta_clave')); return; }
    try {
      const r = await api.tarjetaAuth({ serial, clave: clave.trim() });
      setToken(r.token);
      setInstruccion(r.instruccion || null);
      await flushPendientes(r.token);
    } catch (e) { setErrPaso(e.message); }
  }

  // Si vuelve la señal mientras el portador sigue con la clave escrita en
  // pantalla, se reintenta solo — sin esto tendría que acordarse de volver
  // y tocar "Reintentar ahora".
  useEffect(() => {
    function alVolverOnline() {
      if (claveRef.current.trim() && listarPendientes(serial).length) reintentarPendientesAhora();
    }
    window.addEventListener('online', alVolverOnline);
    return () => window.removeEventListener('online', alVolverOnline);
  }, [serial, clave]);

  async function registrarPaso() {
    setErrPaso('');
    setResultado(null);
    if (!clave.trim()) { setErrPaso(t('tv.falta_clave')); return; }
    setEnviando(true);
    const sel = PUNTOS_CORREDOR.find((x) => x.id === puntoId) || null;
    const entrada = {
      punto_control: sel ? sel.nombre : (punto.trim() || null),
      punto_id: sel ? sel.id : undefined,
      pais: pais.trim().toUpperCase() || 'CL',
      ...(viaQr ? { via_qr: true } : {}),
    };
    try {
      const auth = await api.tarjetaAuth({ serial, clave: clave.trim() });
      setToken(auth.token);
      setInstruccion(auth.instruccion || null);
      await flushPendientes(auth.token); // conexión + clave OK: aprovecha para vaciar la cola
      const r = await api.tarjetaPaso(auth.token, entrada);
      setResultado(r.eslabon);
      setClave('');
      setPunto('');
      setPuntoId('');
      setViaQr(false);
    } catch (e) {
      if (esErrorDeConexion(e)) {
        encolarPaso(serial, entrada);
        setPendientes(listarPendientes(serial));
        setClave('');
        setViaQr(false);
      } else {
        setErrPaso(e.message);
      }
    } finally { setEnviando(false); }
  }

  return (
    <PublicLayout>
      <div className="container" style={{ padding: '48px 24px', maxWidth: 560 }}>
        {error && (
          <div className="card card-pad" style={{ textAlign: 'center' }}>
            <div style={{ color: '#b45309', display: 'flex', justifyContent: 'center' }}><Icon.Alert size={40} /></div>
            <h2>{t('tv.error_titulo')}</h2>
            <p className="muted">{t('tv.error_texto')}</p>
          </div>
        )}

        {info && (
          <div className="card card-pad pasaporte-doc" style={{ textAlign: 'center' }}>
            <div className="pas-kicker">sicr3p</div>
            <h1 style={{ fontSize: 24, margin: '10px 0 10px' }}>{t('tv.titulo')}</h1>
            <div className="pas-lbl" style={{ marginBottom: 4 }}>{t('tv.lote')}</div>
            <div className="pas-code">{info.codigo}</div>
            <p className="muted" style={{ margin: '8px 0 16px', fontSize: 12 }}>
              {t('tv.serial')}: <span className="mono">{info.serial}</span>
            </p>

            {/* Instrucción vigente de la torre: exige la clave del portador
                y desde ahí se refresca sola. */}
            {instruccion && (
              <div className="torre-banner" style={{ textAlign: 'left', marginBottom: 14 }}>
                <span className="torre-banner-icono">📢</span>
                <div>
                  <div className="torre-banner-titulo">
                    {t('tv.instr_torre')}: {etiquetaInstruccion(instruccion, t)}
                  </div>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {instruccion.nota ? `${instruccion.nota} · ` : ''}
                    {instruccion.emisor} · {new Date(instruccion.creado).toLocaleString('es-CL')}
                  </div>
                </div>
              </div>
            )}
            {!token && (
              <p className="muted" style={{ fontSize: 11, marginBottom: 14 }}>
                {t('tv.instr_tras_clave')}
              </p>
            )}

            {/* Pasos sin señal, guardados en este teléfono — se vacía sola
                en la próxima autenticación exitosa, o con el botón. */}
            {pendientes.length > 0 && (
              <div className="badge badge-amber" style={{ display: 'block', textAlign: 'left', padding: '10px 14px', marginBottom: 14 }}>
                <div>{t('tv.pendientes_offline')} ({pendientes.length})</div>
                <button className="btn btn-sm btn-outline" style={{ marginTop: 8 }} onClick={reintentarPendientesAhora} disabled={enviandoPendientes}>
                  {enviandoPendientes ? <><span className="spinner" /> {t('tv.enviando_pendientes')}</> : t('tv.reintentar_ahora')}
                </button>
              </div>
            )}

            {/* QR de la propia credencial: el portador muestra la pantalla
                y otro la escanea — la tarjeta ES el teléfono. */}
            <div className="pas-qr" style={{ marginBottom: 16 }}>
              <img src={`/api/v/${info.serial}/qr.png`} alt={t('tv.qr_alt')} width={132} height={132} />
            </div>

            <Link className="btn btn-primary" style={{ width: '100%', marginBottom: 10 }} to={`/lote/${info.codigo}`}>
              {t('tv.ver_pasaporte')}
            </Link>

            <Link className="btn btn-outline" style={{ width: '100%', marginBottom: 10 }} to={`/torre/${info.codigo}`}>
              🗼 {t('tv.ver_torre')}
            </Link>

            <button className="btn btn-outline" style={{ width: '100%' }} onClick={() => setAbierto(!abierto)}>
              {t('tv.soy_portador')}
            </button>

            {abierto && (
              <div style={{ textAlign: 'left', marginTop: 16 }}>
                <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>{t('tv.instruccion')}</p>
                <div className="field">
                  <label>{t('tv.clave')}</label>
                  <input type="password" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="off" />
                  <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                    {t('tv.perdiste_clave')}{' '}
                    <a href={`mailto:contacto@sicrep.cl?subject=Recuperar%20clave%20de%20tarjeta%20${info?.serial || ''}`}>
                      {t('tv.perdiste_clave_link')}
                    </a>
                  </p>
                </div>
                {/* Escaneo del cartel QR del punto de control — autocompleta el
                    select de abajo en vez de tipear a mano. */}
                <div className="field">
                  {!escaneando ? (
                    <button type="button" className="btn btn-outline" style={{ width: '100%' }} onClick={() => { setAvisoQr(''); setEscaneando(true); }}>
                      {t('tv.escanear')}
                    </button>
                  ) : (
                    <div style={{ textAlign: 'center' }}>
                      <video ref={videoRef} playsInline muted autoPlay style={{ width: '100%', maxWidth: 320, borderRadius: 10, background: '#000' }} />
                      <p className="muted" style={{ fontSize: 12, margin: '8px 0' }}>{t('tv.escaneando')}</p>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEscaneando(false)}>{t('tv.cancelar_escaneo')}</button>
                    </div>
                  )}
                  {avisoQr && <p className="muted" style={{ fontSize: 12, color: '#b45309', marginTop: 6 }}>{avisoQr}</p>}
                  {viaQr && puntoId && (
                    <div className="badge badge-green" style={{ display: 'inline-block', marginTop: 8 }}>
                      ✓ {t('tv.punto_detectado')}: {PUNTOS_CORREDOR.find((p) => p.id === puntoId)?.nombre}{' '}
                      <a href="#" onClick={(e) => { e.preventDefault(); setViaQr(false); }}>({t('tv.cambiar')})</a>
                    </div>
                  )}
                </div>
                <div className="field">
                  <label>{t('tv.punto_sel')}</label>
                  <select value={puntoId} onChange={(e) => { elegirPunto(e.target.value); setViaQr(false); }}>
                    <option value="">{t('tv.punto_otro')}</option>
                    {PUNTOS_CORREDOR.map((p) => (
                      <option key={p.id} value={p.id}>{p.nombre} ({p.pais})</option>
                    ))}
                  </select>
                </div>
                {!puntoId && (
                  <div className="field">
                    <label>{t('tv.punto')}</label>
                    <input value={punto} placeholder={t('tv.punto_ej')} onChange={(e) => { setPunto(e.target.value); setViaQr(false); }} />
                  </div>
                )}
                <div className="field">
                  <label>{t('tv.pais')}</label>
                  <input value={pais} maxLength={2} style={{ width: 90 }}
                    onChange={(e) => setPais(e.target.value.toUpperCase())} />
                </div>
                {errPaso && <div className="badge badge-red" style={{ marginBottom: 10 }}>{errPaso}</div>}
                {resultado && (
                  <div className="badge badge-green" style={{ marginBottom: 10 }}>
                    ✓ {t('tv.paso_ok')} #{resultado.eslabon}
                  </div>
                )}
                <button className="btn btn-primary" style={{ width: '100%' }} onClick={registrarPaso} disabled={enviando}>
                  {enviando ? <span className="spinner" /> : t('tv.registrar')}
                </button>
              </div>
            )}

            <p className="muted" style={{ fontSize: 11, marginTop: 18 }}>{t('tv.nota')}</p>
          </div>
        )}
      </div>
    </PublicLayout>
  );
}
