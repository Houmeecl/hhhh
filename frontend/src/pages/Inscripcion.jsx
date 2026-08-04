import { useState } from 'react';
import { Link } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout.jsx';
import { useIdioma } from '../lib/i18n.js';
import { api } from '../api.js';

// Inscripción pública de empresas. Enviar el formulario NO crea un
// cliente ni un contrato: deja la solicitud registrada para que alguien
// la revise desde el panel (mismo patrón que /auspicio). El texto lo
// dice, para no prometer una relación que todavía no existe.
const VACIO = {
  nombre_empresa: '', rut: '', contacto_nombre: '', contacto_cargo: '',
  contacto_email: '', contacto_telefono: '', intereses: [], mensaje: '',
};

// Claves cerradas — deben calzar con INTERESES de services/inscripcion.js.
const INTERESES = ['carbono', 'corredor', 'capacitacion', 'rep'];

export default function Inscripcion() {
  const { t } = useIdioma();
  const [f, setF] = useState(VACIO);
  const [enviando, setEnviando] = useState(false);
  const [listo, setListo] = useState(null);
  const [error, setError] = useState(null);

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
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <h1>{t('ins.titulo')}</h1>
        <p className="muted">{t('ins.sub')}</p>
        <p className="muted" style={{ fontSize: 14 }}>{t('ins.nota')}</p>

        <form className="card card-pad" onSubmit={enviar} style={{ marginTop: 18 }}>
          <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div className="field"><label>{t('ins.empresa')} *</label>
              <input required value={f.nombre_empresa} onChange={(e) => set('nombre_empresa', e.target.value)} /></div>
            <div className="field"><label>RUT *</label>
              <input required placeholder="76.123.456-7" value={f.rut} onChange={(e) => set('rut', e.target.value)} /></div>
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
            <textarea rows={4} value={f.mensaje} onChange={(e) => set('mensaje', e.target.value)} /></div>

          {error && <p style={{ color: '#b91c1c' }}>{error}</p>}
          <button className="btn btn-primary" disabled={enviando || f.intereses.length === 0}>
            {enviando ? <><span className="spinner" /> {t('ins.enviando')}</> : t('ins.enviar')}
          </button>
          {f.intereses.length === 0 && (
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>{t('ins.falta_interes')}</p>
          )}
        </form>
      </div>
    </PublicLayout>
  );
}
