import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout.jsx';
import { Icon } from '../components/icons.jsx';
import { api } from '../api.js';
import { useIdioma } from '../lib/i18n.js';

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
  const [punto, setPunto] = useState('');
  const [pais, setPais] = useState('CL');
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [errPaso, setErrPaso] = useState('');

  useEffect(() => {
    api.tarjetaResolver(serial).then(setInfo).catch((e) => setError(e.message));
  }, [serial]);

  async function registrarPaso() {
    setErrPaso('');
    setResultado(null);
    if (!clave.trim()) { setErrPaso(t('tv.falta_clave')); return; }
    setEnviando(true);
    try {
      const { token } = await api.tarjetaAuth({ serial, clave: clave.trim() });
      const r = await api.tarjetaPaso(token, {
        punto_control: punto.trim() || null,
        pais: pais.trim().toUpperCase() || 'CL',
      });
      setResultado(r.eslabon);
      setClave('');
      setPunto('');
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
          <div className="card card-pad" style={{ textAlign: 'center' }}>
            <div className="muted" style={{ fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase' }}>sicr3p</div>
            <h1 style={{ fontSize: 24, margin: '6px 0 2px' }}>{t('tv.titulo')}</h1>
            <p className="muted" style={{ margin: '0 0 6px' }}>
              {t('tv.serial')}: <b style={{ fontFamily: 'monospace' }}>{info.serial}</b>
            </p>
            <p style={{ margin: '0 0 18px' }}>
              {t('tv.lote')}: <b style={{ fontFamily: 'monospace' }}>{info.codigo}</b>
            </p>

            <Link className="btn btn-primary" style={{ width: '100%', marginBottom: 10 }} to={`/lote/${info.codigo}`}>
              {t('tv.ver_pasaporte')}
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
                </div>
                <div className="field">
                  <label>{t('tv.punto')}</label>
                  <input value={punto} placeholder={t('tv.punto_ej')} onChange={(e) => setPunto(e.target.value)} />
                </div>
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
