import { useState } from 'react';
import { Link } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout.jsx';
import Logo from '../components/Logo.jsx';
import { Icon } from '../components/icons.jsx';
import { useIdioma } from '../lib/i18n.js';
import { useSeo } from '../lib/seo.js';
import { api } from '../api.js';
import { validarRut } from '../lib/rut.js';

// Página especial de inscripción de empresas, con la marca al centro:
// hero navy con el logo grande, argumentos a la izquierda y el
// formulario a la derecha. Enviar NO crea un cliente ni un contrato:
// deja la solicitud registrada para que alguien la revise desde el
// panel (mismo patrón que /auspicio). El texto lo dice, para no
// prometer una relación que todavía no existe.
const VACIO = {
  nombre_empresa: '', rut: '', contacto_nombre: '', contacto_cargo: '',
  contacto_email: '', contacto_telefono: '', intereses: [], mensaje: '',
};

// Claves cerradas — deben calzar con INTERESES de services/inscripcion.js.
const INTERESES = ['carbono', 'corredor', 'capacitacion', 'rep'];

// Por qué inscribirse: cada punto apunta a una capacidad real y
// verificable de la plataforma, nada aspiracional.
const BENEFICIOS = [
  ['b1', Icon.Chart],
  ['b2', Icon.Qr],
  ['b3', Icon.Shield],
  ['b4', Icon.Users],
];

export default function Inscripcion() {
  const { t } = useIdioma();
  useSeo(
    'Inscripción de empresas — sicr3p',
    'Inscribe tu empresa en sicr3p: contabilidad de carbono, trazabilidad documental y declaración REP desde una misma carga de facturas.'
  );
  const [f, setF] = useState(VACIO);
  const [enviando, setEnviando] = useState(false);
  const [listo, setListo] = useState(null);
  const [error, setError] = useState(null);
  // Autocompletado por RUT con datos públicos del SII (el backend consulta
  // BaseAPI; acá nunca hay API key). Cualquier falla —módulo apagado, RUT
  // sin registro, rate limit— se ignora en silencio: el formulario manual
  // es el camino principal y esto es solo una ayuda.
  const [sii, setSii] = useState(null); // null | 'consultando' | {razonSocial, giro}

  async function consultarSii() {
    // validarRut evita gastar una consulta (cuota pagada de BaseAPI) en un
    // RUT con dígito verificador malo; el servidor valida de nuevo igual.
    if (!validarRut(f.rut)) { setSii(null); return; }
    setSii('consultando');
    try {
      const { situacion } = await api.consultarRutSiiPublico(f.rut);
      setSii({ razonSocial: situacion.razonSocial, giro: situacion.actividades?.[0]?.descripcion || null });
      setF((x) => (x.nombre_empresa.trim() ? x : { ...x, nombre_empresa: situacion.razonSocial }));
    } catch { setSii(null); }
  }

  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const toggleInteres = (k) => setF((x) => ({
    ...x,
    intereses: x.intereses.includes(k) ? x.intereses.filter((i) => i !== k) : [...x.intereses, k],
  }));

  async function enviar(e) {
    e.preventDefault();
    setError(null); setEnviando(true);
    try { setListo(await api.inscribirEmpresa(f)); }
    catch (err) { setError(err.message); }
    finally { setEnviando(false); }
  }

  if (listo) {
    return (
      <PublicLayout>
        <div className="card card-pad" style={{ maxWidth: 640, margin: '40px auto', textAlign: 'center' }}>
          <div style={{ marginBottom: 12 }}><Logo size={34} /></div>
          <h1 style={{ marginTop: 0 }}>{t('ins.recibida_titulo')}</h1>
          <p>{listo.mensaje}</p>
          <p className="muted" style={{ fontSize: 14 }}>{t('ins.recibida_nota')}</p>
          <Link to="/" className="btn btn-outline">{t('ins.volver')}</Link>
        </div>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout>
      {/* HERO — mismo sistema visual navy de la portada, con el logo
          grande como protagonista (versión clara sobre fondo oscuro). */}
      <div className="av2-hero">
        <div className="container">
          <section style={{ maxWidth: 720, margin: '0 auto', textAlign: 'center', padding: '8px 0 4px' }}>
            <div style={{ marginBottom: 18 }}><Logo size={52} tagline light /></div>
            <span className="av2-eyebrow"><span className="av-led" /> {t('ins.eyebrow')}</span>
            <h1 className="av2-h1">{t('ins.hero_h1')}</h1>
            <p className="av2-sub">{t('ins.sub')}</p>
          </section>
        </div>
      </div>

      <section className="sec-pad">
        <div className="container">
          <div className="two-col-grid" style={{ gap: 36, alignItems: 'start' }}>
            {/* Por qué inscribirse */}
            <div>
              <h2 style={{ fontSize: 26, margin: '0 0 6px' }}>{t('ins.beneficios_titulo')}</h2>
              <p className="muted" style={{ fontSize: 14, lineHeight: 1.6, marginBottom: 18 }}>{t('ins.nota')}</p>
              <div style={{ display: 'grid', gap: 14 }}>
                {BENEFICIOS.map(([k, Ico]) => (
                  <div key={k} className="result-box" style={{ display: 'flex', gap: 12, alignItems: 'flex-start', margin: 0 }}>
                    <div style={{ color: 'var(--green)', marginTop: 2 }}><Ico size={22} /></div>
                    <div>
                      <b style={{ fontSize: 15 }}>{t(`ins.${k}_t`)}</b>
                      <div className="muted" style={{ fontSize: 13, lineHeight: 1.55 }}>{t(`ins.${k}_d`)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Formulario */}
            <form className="card card-pad" onSubmit={enviar}>
              <h2 style={{ fontSize: 20, margin: '0 0 14px' }}>{t('ins.titulo')}</h2>
              <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <div className="field"><label>{t('ins.empresa')} *</label>
                  <input required value={f.nombre_empresa} onChange={(e) => set('nombre_empresa', e.target.value)} /></div>
                <div className="field"><label>RUT *</label>
                  <input required placeholder="76.123.456-7" value={f.rut} onChange={(e) => set('rut', e.target.value)} onBlur={consultarSii} />
                  {sii === 'consultando' && <span className="muted" style={{ fontSize: 12 }}>{t('sii.consultando')}</span>}
                  {sii && sii !== 'consultando' && (
                    <span className="muted" style={{ fontSize: 12 }}>
                      {t('sii.segun_sii')} <b>{sii.razonSocial}</b>{sii.giro ? ` · ${sii.giro}` : ''}
                    </span>
                  )}
                </div>
                <div className="field"><label>{t('ins.nombre')} *</label>
                  <input required value={f.contacto_nombre} onChange={(e) => set('contacto_nombre', e.target.value)} /></div>
                <div className="field"><label>{t('ins.cargo')}</label>
                  <input value={f.contacto_cargo} onChange={(e) => set('contacto_cargo', e.target.value)} /></div>
                <div className="field"><label>{t('ins.correo')} *</label>
                  <input required type="email" value={f.contacto_email} onChange={(e) => set('contacto_email', e.target.value)} /></div>
                <div className="field"><label>{t('ins.fono')}</label>
                  <input value={f.contacto_telefono} onChange={(e) => set('contacto_telefono', e.target.value)} /></div>
              </div>

              <div className="field" style={{ marginTop: 8 }}>
                <label>{t('ins.interes')} *</label>
                <div style={{ display: 'grid', gap: 8, marginTop: 6 }}>
                  {INTERESES.map((k) => (
                    <label key={k} className="result-box" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer', margin: 0, fontWeight: 400, fontSize: 14 }}>
                      <input type="checkbox" checked={f.intereses.includes(k)} onChange={() => toggleInteres(k)} style={{ marginTop: 3 }} />
                      <span><b>{t(`ins.int_${k}_t`)}</b><br /><span className="muted" style={{ fontSize: 13 }}>{t(`ins.int_${k}_d`)}</span></span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="field"><label>{t('ins.mensaje')}</label>
                <textarea rows={3} value={f.mensaje} onChange={(e) => set('mensaje', e.target.value)} /></div>

              {error && <p style={{ color: '#b91c1c' }}>{error}</p>}
              <button className="btn btn-primary" disabled={enviando || f.intereses.length === 0} style={{ width: '100%' }}>
                {enviando ? <><span className="spinner" /> {t('ins.enviando')}</> : t('ins.enviar')}
              </button>
              {f.intereses.length === 0 && (
                <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>{t('ins.falta_interes')}</p>
              )}
            </form>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
