import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout.jsx';
import { api } from '../api.js';

// Mini sitio de prueba: se entra con un código que trae créditos
// (1 crédito = 1 factura procesada). El código lo entrega sicr3p.
export default function Prueba() {
  const nav = useNavigate();
  const [codigo, setCodigo] = useState('');
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(false);

  // Si ya hay un código válido en la sesión del navegador, sigue directo.
  useEffect(() => {
    const c = sessionStorage.getItem('sicr3p_codigo');
    if (c) nav('/cargar', { replace: true });
  }, []);

  async function validar(e) {
    e.preventDefault();
    setError(null); setCargando(true);
    try {
      const r = await api.codigoEstado(codigo.trim());
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
      <div style={{ maxWidth: 460, margin: '60px auto', padding: '0 20px' }}>
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
        <p className="muted" style={{ fontSize: 13, textAlign: 'center', marginTop: 14 }}>
          ¿No tienes código? Escríbenos a <a href="mailto:contacto@sicr3p.cl">contacto@sicr3p.cl</a>
        </p>
      </div>
    </PublicLayout>
  );
}
