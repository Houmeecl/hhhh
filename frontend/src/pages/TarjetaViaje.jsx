import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout.jsx';
import { Icon } from '../components/icons.jsx';
import { api } from '../api.js';
import { useIdioma } from '../lib/i18n.js';
import { PUNTOS_CORREDOR, etiquetaInstruccion } from '../lib/corredor.js';

// Tarjeta de Viaje: la URL grabada en el NDEF de la tarjeta NFC/RFID
// que acompaña a la carga es /v/{serial}. Cualquiera que la lea llega
// aquí y puede VER el pasaporte del lote (solo lectura). El PORTADOR
// (clave entregada junto con la tarjeta) registra pasos en ruta — cada
// paso queda sellado como eslabón de transporte en la cadena del lote:
// la secuencia de pasos ES la ruta, sin GPS.
export default function TarjetaViaje() {
  const { serial } = useParams();
  const { t } = useIdioma();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  // Formulario del portador
  const [abierto, setAbierto] = useState(false);
  const [clave, setClave] = useState('');
  const [puntoId, setPuntoId] = useState('');   // punto del catálogo del corredor
  const [punto, setPunto] = useState('');       // texto libre (si no es del catálogo)
  const [pais, setPais] = useState('CL');
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [errPaso, setErrPaso] = useState('');

  // La credencial se refresca sola: así el portador ve la instrucción de
  // la torre ("puerto seco" / "puerto") apenas la envían, sin recargar.
  useEffect(() => {
    const cargar = () => {
      if (document.hidden) return;
      api.tarjetaResolver(serial).then(setInfo).catch((e) => setError(e.message));
    };
    cargar();
    const timer = setInterval(cargar, 10000);
    return () => clearInterval(timer);
  }, [serial]);

  const elegirPunto = (id) => {
    setPuntoId(id);
    const p = PUNTOS_CORREDOR.find((x) => x.id === id);
    if (p) { setPais(p.pais); setPunto(''); }
  };

  async function registrarPaso() {
    setErrPaso('');
    setResultado(null);
    if (!clave.trim()) { setErrPaso(t('tv.falta_clave')); return; }
    setEnviando(true);
    try {
      const sel = PUNTOS_CORREDOR.find((x) => x.id === puntoId) || null;
      const { token } = await api.tarjetaAuth({ serial, clave: clave.trim() });
      const r = await api.tarjetaPaso(token, {
        punto_control: sel ? sel.nombre : (punto.trim() || null),
        punto_id: sel ? sel.id : undefined,
        pais: pais.trim().toUpperCase() || 'CL',
      });
      setResultado(r.eslabon);
      setClave('');
      setPunto('');
      setPuntoId('');
    } catch (e) { setErrPaso(e.message); }
    finally { setEnviando(false); }
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

            {/* Instrucción vigente de la torre de control (se refresca sola). */}
            {info.instruccion && (
              <div className="torre-banner" style={{ textAlign: 'left', marginBottom: 14 }}>
                <span className="torre-banner-icono">📢</span>
                <div>
                  <div className="torre-banner-titulo">
                    {t('tv.instr_torre')}: {etiquetaInstruccion(info.instruccion, t)}
                  </div>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {info.instruccion.nota ? `${info.instruccion.nota} · ` : ''}
                    {info.instruccion.emisor} · {new Date(info.instruccion.creado).toLocaleString('es-CL')}
                  </div>
                </div>
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
                    <a href={`mailto:contacto@sicr3p.cl?subject=Recuperar%20clave%20de%20tarjeta%20${info?.serial || ''}`}>
                      {t('tv.perdiste_clave_link')}
                    </a>
                  </p>
                </div>
                <div className="field">
                  <label>{t('tv.punto_sel')}</label>
                  <select value={puntoId} onChange={(e) => elegirPunto(e.target.value)}>
                    <option value="">{t('tv.punto_otro')}</option>
                    {PUNTOS_CORREDOR.map((p) => (
                      <option key={p.id} value={p.id}>{p.nombre} ({p.pais})</option>
                    ))}
                  </select>
                </div>
                {!puntoId && (
                  <div className="field">
                    <label>{t('tv.punto')}</label>
                    <input value={punto} placeholder={t('tv.punto_ej')} onChange={(e) => setPunto(e.target.value)} />
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
