import { useState } from 'react';
import { api } from '../api.js';
import { useIdioma } from '../lib/i18n.js';

// ============================================================
// Captación de leads en el sitio público — reemplaza los CTA que
// terminaban en mailto: (en el celular suele no abrir nada y el
// interesado se perdía sin dejar rastro).
//
// LeadCta: un botón con el MISMO look del CTA que reemplaza (className
// pasa btn btn-primary / btn-outline); al hacer click se expande un
// formulario INLINE debajo — no un modal: las páginas públicas no tienen
// infraestructura de modal y en el celular (donde el mailto fallaba) un
// formulario en el mismo lugar es lo que menos fricción agrega. El único
// campo obligatorio es el correo.
//
// Anti-bot: campo honeypot `sitio_web` invisible (fuera de pantalla,
// tabIndex -1) — el backend responde 201 falso si viene lleno, sin
// avisarle al bot. Ver services/interesados.js.
// ============================================================

export default function LeadCta({ origen, etiqueta, className = 'btn btn-primary', hint = '', style }) {
  const { t } = useIdioma();
  const [abierto, setAbierto] = useState(false);
  const [form, setForm] = useState({ nombre: '', email: '', empresa: '', mensaje: hint, sitio_web: '' });
  const [estado, setEstado] = useState('inicial'); // inicial | enviando | listo | error
  const [error, setError] = useState('');

  async function enviar(e) {
    e.preventDefault();
    setEstado('enviando');
    setError('');
    try {
      await api.crearInteresado({ ...form, origen });
      setEstado('listo');
    } catch (err) {
      setEstado('error');
      setError(err.message);
    }
  }

  if (estado === 'listo') {
    return (
      <div className="badge badge-green" style={{ display: 'inline-block', padding: '12px 18px', fontSize: 14, ...style }}>
        ✓ {t('lead.gracias')}
      </div>
    );
  }

  return (
    <div style={{ display: 'inline-block', maxWidth: '100%', ...style }}>
      {!abierto ? (
        <button type="button" className={className} onClick={() => setAbierto(true)}>{etiqueta}</button>
      ) : (
        <form onSubmit={enviar} className="card card-pad" style={{ textAlign: 'left', maxWidth: 440, marginTop: 4 }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>{etiqueta}</div>
          <div className="field" style={{ marginBottom: 10 }}>
            <label>{t('lead.email')} *</label>
            <input
              type="email" required autoFocus value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="contacto@empresa.cl"
            />
          </div>
          <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr', margin: '0 0 10px' }}>
            <div className="field" style={{ margin: 0 }}>
              <label>{t('lead.nombre')}</label>
              <input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>{t('lead.empresa')}</label>
              <input value={form.empresa} onChange={(e) => setForm({ ...form, empresa: e.target.value })} />
            </div>
          </div>
          <div className="field" style={{ marginBottom: 10 }}>
            <label>{t('lead.mensaje')}</label>
            <textarea rows={2} value={form.mensaje} onChange={(e) => setForm({ ...form, mensaje: e.target.value })} />
          </div>
          {/* Honeypot: invisible para humanos; un bot que rellena todo cae acá. */}
          <input
            type="text" value={form.sitio_web} tabIndex={-1} autoComplete="off" aria-hidden="true"
            onChange={(e) => setForm({ ...form, sitio_web: e.target.value })}
            style={{ position: 'absolute', left: -9999, width: 1, height: 1, opacity: 0 }}
          />
          {error && <div className="badge badge-red" style={{ display: 'block', padding: '8px 12px', marginBottom: 10 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button type="submit" className="btn btn-primary" disabled={estado === 'enviando'}>
              {estado === 'enviando' ? <span className="spinner" /> : t('lead.enviar')}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAbierto(false)}>{t('lead.cancelar')}</button>
          </div>
          <p className="muted" style={{ fontSize: 11.5, marginTop: 10, marginBottom: 0 }}>{t('lead.privacidad')}</p>
        </form>
      )}
    </div>
  );
}
