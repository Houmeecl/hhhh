import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout.jsx';
import LeadCta from '../components/LeadForm.jsx';
import { api } from '../api.js';

// Mini sitio de prueba: se entra con un código que trae créditos
// (1 crédito = 1 factura procesada). El código lo entrega sicr3p.
// El código llega en el FRAGMENTO de la URL (#codigo=…), no en la query.
// El fragmento no se manda al servidor: no queda en el access log de
// nginx ni viaja en la cabecera Referer. Con `?codigo=` la clave recién
// vendida quedaba escrita en texto plano en los registros del servidor.
function codigoDelFragmento() {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.hash.replace(/^#/, '')).get('codigo')?.trim() || '';
}

export default function Prueba() {
  const nav = useNavigate();
  const [codigo, setCodigo] = useState(codigoDelFragmento);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(false);
  const autoIntentado = useRef(false);

  // Si ya hay un código válido en la sesión del navegador, sigue directo.
  useEffect(() => {
    const c = sessionStorage.getItem('sicr3p_codigo');
    if (c) nav('/cargar', { replace: true });
  }, []);

  // El enlace del correo que se manda al confirmarse un pago
  // (services/cobros.js) trae el código y entra solo: quien acaba de
  // pagar no tendría por qué copiar su clave a mano desde el correo.
  // El campo igual queda cargado y visible por si la validación falla.
  useEffect(() => {
    const c = codigoDelFragmento();
    if (!c || autoIntentado.current) return;
    autoIntentado.current = true;
    // Se saca de la barra de direcciones apenas se leyó: el historial
    // del navegador y lo que se comparte al copiar la URL tampoco tienen
    // por qué llevar la clave.
    window.history.replaceState(null, '', window.location.pathname);
    validar(null, c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function validar(e, codigoDirecto) {
    e?.preventDefault();
    setError(null); setCargando(true);
    try {
      const r = await api.codigoEstado((codigoDirecto || codigo || '').trim());
      if (r.creditos_restantes <= 0) {
        setError('Este código ya usó todos sus créditos. Contáctanos para más.');
        return;
      }
      sessionStorage.setItem('sicr3p_codigo', r.codigo);
      nav('/cargar');
    } catch (err) { setError(err.message); }
    finally { setCargando(false); }
  }

  return (
    <PublicLayout>
      <div className="narrow-page">
        <div className="card card-pad">
          <h1 style={{ marginTop: 0, fontSize: 26 }}>Prueba sicr3p</h1>
          <p className="muted" style={{ fontSize: 14 }}>
            Ingresa el código que te entregamos. Cada código incluye <b>créditos de
            procesamiento</b> (1 crédito = 1 factura) para que pruebes la contabilidad
            de carbono trazable con tus propios documentos.
          </p>
          <form onSubmit={validar}>
            <div className="field">
              <label>Código de acceso</label>
              <input required autoFocus value={codigo}
                onChange={(e) => setCodigo(e.target.value.toUpperCase())}
                placeholder="SICR3P-XXXXXX"
                style={{ textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600 }} />
            </div>
            {error && <div className="badge badge-red" style={{ display: 'block', padding: '10px 14px', margin: '10px 0' }}>{error}</div>}
            <button className="btn btn-primary" style={{ width: '100%', marginTop: 10 }} disabled={cargando}>
              {cargando ? <span className="spinner" /> : 'Comenzar'}
            </button>
          </form>
        </div>
        {/* Antes: mailto a contacto@sicrep.cl — en el celular suele no abrir
            nada y quien llegó hasta acá (intención altísima: quiere probar)
            se perdía sin dejar rastro. Ahora deja su correo y queda como
            lead en el panel. */}
        <div style={{ textAlign: 'center', marginTop: 14 }}>
          <p className="muted" style={{ fontSize: 13, marginBottom: 8 }}>¿No tienes código?</p>
          <LeadCta
            origen="prueba" etiqueta="Pídenos un código de prueba"
            className="btn btn-outline btn-sm" hint="Quiero un código de prueba"
          />
        </div>
      </div>
    </PublicLayout>
  );
}
