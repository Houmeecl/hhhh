import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout.jsx';
import { Icon } from '../components/icons.jsx';
import { api } from '../api.js';
import { useIdioma } from '../lib/i18n.js';

// Credencial de Firma del actor de la cadena: atestación con credencial
// propia (serial+clave, mismo patrón que la Tarjeta de Viaje) para el
// eslabón 'proveedor' (Pasaporte tipo 'producto') o 'puerto' (Pasaporte
// tipo 'documental', Corredor Bioceánico) — el rol viene del resolver
// (info.rol). NO es firma electrónica con validez legal (Ley N° 19.799)
// — es una atestación sellada por hash, con identidad FIJADA por quien
// emitió la credencial (nunca declarada por quien firma). Un solo uso.
export default function FirmaProveedor() {
  const { serial } = useParams();
  const { t } = useIdioma();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  // Formulario del firmante
  const [abierto, setAbierto] = useState(false);
  const [clave, setClave] = useState('');
  const [cantidad, setCantidad] = useState('');
  const [nota, setNota] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [errFirma, setErrFirma] = useState('');

  function cargar() {
    api.firmaResolver(serial).then(setInfo).catch((e) => setError(e.message));
  }
  useEffect(() => { cargar(); }, [serial]);

  async function firmar() {
    setErrFirma('');
    setResultado(null);
    if (!clave.trim()) { setErrFirma(t('fp.falta_clave')); return; }
    setEnviando(true);
    try {
      const { token } = await api.firmaAuth({ serial, clave: clave.trim() });
      const r = await api.firmaFirmar(token, {
        cantidad: cantidad.trim() ? Number(cantidad) : undefined,
        datos: nota.trim() ? { nota: nota.trim() } : {},
      });
      setResultado(r.eslabon);
      setClave('');
      setCantidad('');
      setNota('');
      cargar(); // refresca: info.firmado pasa a true
    } catch (e) { setErrFirma(e.message); }
    finally { setEnviando(false); }
  }

  return (
    <PublicLayout>
      <div className="container" style={{ padding: '48px 24px', maxWidth: 560 }}>
        {error && (
          <div className="card card-pad" style={{ textAlign: 'center' }}>
            <div style={{ color: '#b45309', display: 'flex', justifyContent: 'center' }}><Icon.Alert size={40} /></div>
            <h2>{t('fp.error_titulo')}</h2>
            <p className="muted">{t('fp.error_texto')}</p>
          </div>
        )}

        {info && (
          <div className="card card-pad pasaporte-doc" style={{ textAlign: 'center' }}>
            <div className="pas-kicker">sicr3p</div>
            <h1 style={{ fontSize: 22, margin: '10px 0 10px' }}>
              {t(info.rol === 'puerto' ? 'fp.titulo_puerto' : 'fp.titulo')}
            </h1>
            <div className="pas-lbl" style={{ marginBottom: 4 }}>{t('fp.lote')}</div>
            <div className="pas-code">{info.codigo}</div>
            <p className="muted" style={{ margin: '8px 0 16px', fontSize: 12 }}>
              {t('fp.empresa')}: <b>{info.nombre_empresa}</b>
            </p>

            <div
              className="badge badge-amber"
              style={{ marginBottom: 14, textAlign: 'left', display: 'block', whiteSpace: 'normal' }}
            >
              {t('fp.disclaimer')}
            </div>

            <div className="pas-qr" style={{ marginBottom: 16 }}>
              <img src={`/api/f/${info.serial}/qr.png`} alt={t('fp.qr_alt')} width={132} height={132} />
            </div>

            <Link className="btn btn-outline" style={{ width: '100%', marginBottom: 10 }} to={`/lote/${info.codigo}`}>
              {t('fp.ver_pasaporte')}
            </Link>

            {info.firmado ? (
              <div className="badge badge-gray" style={{ width: '100%' }}>{t('fp.ya_firmado')}</div>
            ) : info.lote_estado !== 'abierto' ? (
              <div className="badge badge-gray" style={{ width: '100%' }}>{t('fp.lote_cerrado')}</div>
            ) : (
              <>
                <button className="btn btn-outline" style={{ width: '100%' }} onClick={() => setAbierto(!abierto)}>
                  {t(info.rol === 'puerto' ? 'fp.soy_puerto' : 'fp.soy_proveedor')}
                </button>

                {abierto && (
                  <div style={{ textAlign: 'left', marginTop: 16 }}>
                    <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>{t('fp.instruccion')}</p>
                    <div className="field">
                      <label>{t('fp.clave')}</label>
                      <input type="password" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="off" />
                    </div>
                    <div className="field">
                      <label>{t('fp.cantidad')}</label>
                      <input value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
                    </div>
                    <div className="field">
                      <label>{t('fp.nota')}</label>
                      <input value={nota} onChange={(e) => setNota(e.target.value)} />
                    </div>
                    {errFirma && <div className="badge badge-red" style={{ marginBottom: 10 }}>{errFirma}</div>}
                    {resultado && (
                      <div className="badge badge-green" style={{ marginBottom: 10 }}>
                        ✓ {t('fp.firmado_ok')} #{resultado.eslabon}
                      </div>
                    )}
                    <button className="btn btn-primary" style={{ width: '100%' }} onClick={firmar} disabled={enviando}>
                      {enviando ? <span className="spinner" /> : t('fp.firmar')}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </PublicLayout>
  );
}
