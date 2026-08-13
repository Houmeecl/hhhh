import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout.jsx';
import { Icon } from '../components/icons.jsx';
import { api } from '../api.js';

// ============================================================
// Página de pago del link que va en el correo comercial.
//
// Tres modos en una sola URL, según lo que diga el backend:
//  · pasarela 'flow'    → botón que lleva a pagar en línea.
//  · pasarela 'manual'  → datos para transferir + a quién avisar.
//  · /pagar/:token/baja → darse de baja de los correos comerciales.
//
// Lo que NO hace esta página: entregar el acceso. La clave llega por
// correo a la dirección registrada, nunca se muestra acá — el link es
// compartible y el acceso no.
// ============================================================

const clp = (n) => `$ ${Number(n || 0).toLocaleString('es-CL')}`;

export default function Pagar({ modo = 'pago' }) {
  const { token } = useParams();
  const [params] = useSearchParams();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [yendo, setYendo] = useState(false);
  const [baja, setBaja] = useState(null);
  // `/pagar/:token/listo` es a donde vuelve el navegador desde Flow. El
  // pago lo confirma el webhook servidor-a-servidor, que puede llegar
  // un instante después que la persona: por eso acá se consulta el
  // estado en vez de dar por hecho que ya está pagado.
  const [esperando, setEsperando] = useState(modo === 'listo');
  const intentos = useRef(0);

  const cargar = useCallback(async () => {
    try { setInfo(await api.pagoInfo(token)); }
    catch (e) { setError(e.message); }
  }, [token]);

  useEffect(() => {
    if (modo === 'baja') {
      api.darseDeBaja(token).then((r) => setBaja(r.email)).catch((e) => setError(e.message));
      return;
    }
    cargar();
  }, [modo, token, cargar]);

  // Sondeo acotado: 20 intentos cada 3 s (un minuto). Si en un minuto la
  // pasarela no confirmó, seguir girando para siempre no informa nada —
  // se le dice a la persona que el correo va a llegar igual, que es la
  // verdad: la entrega no depende de que esta pestaña siga abierta.
  useEffect(() => {
    if (!esperando) return undefined;
    const t = setInterval(async () => {
      intentos.current += 1;
      try {
        const r = await api.estadoPago(token);
        if (r.estado === 'pagado') { setEsperando(false); cargar(); return; }
      } catch { /* un fallo puntual de red no corta el sondeo */ }
      if (intentos.current >= 20) setEsperando(false);
    }, 3000);
    return () => clearInterval(t);
  }, [esperando, token, cargar]);

  async function pagar() {
    setYendo(true);
    try {
      const r = await api.iniciarPago(token);
      window.location.href = r.url;
    } catch (e) {
      setError(e.message);
      setYendo(false);
    }
  }

  if (modo === 'baja') {
    return (
      <PublicLayout>
        <div className="container" style={{ maxWidth: 560, padding: '48px 16px' }}>
          {error ? <div className="alert alert-error">{error}</div> : baja ? (
            <div className="card" style={{ padding: 28, textAlign: 'center' }}>
              <Icon.CheckCircle size={40} />
              <h1 style={{ fontSize: 22, margin: '12px 0 8px' }}>Listo, no le escribimos más</h1>
              <p className="muted">
                Sacamos <b>{baja}</b> de nuestras comunicaciones comerciales. No necesita hacer nada más.
              </p>
              <p className="muted" style={{ fontSize: 13, marginTop: 16 }}>
                Si algún día quiere volver a saber de sicr3p, escríbanos y lo revertimos.
              </p>
            </div>
          ) : <p className="muted">Procesando…</p>}
        </div>
      </PublicLayout>
    );
  }

  if (error) {
    return (
      <PublicLayout>
        <div className="container" style={{ maxWidth: 560, padding: '48px 16px' }}>
          <div className="alert alert-error">{error}</div>
        </div>
      </PublicLayout>
    );
  }
  if (!info) {
    return (
      <PublicLayout>
        <div className="container" style={{ maxWidth: 560, padding: '48px 16px' }}>
          <p className="muted">Cargando…</p>
        </div>
      </PublicLayout>
    );
  }

  const pagado = info.estado === 'pagado';
  const anulado = info.estado === 'anulado';

  return (
    <PublicLayout>
      <div className="container" style={{ maxWidth: 560, padding: '40px 16px' }}>
        <div className="card" style={{ padding: 28 }}>
          <div className="muted" style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' }}>
            {info.campana}
          </div>
          <h1 style={{ fontSize: 24, margin: '6px 0 4px' }}>
            Acceso a sicr3p{info.empresa ? ` — ${info.empresa}` : ''}
          </h1>
          {info.descripcion && <p className="muted">{info.descripcion}</p>}

          <div style={{ background: '#eaf6ef', border: '1px solid #28a745', borderRadius: 10, padding: '16px 18px', margin: '18px 0' }}>
            <div style={{ fontSize: 12, color: '#218838', fontWeight: 700 }}>INCLUYE</div>
            <div style={{ fontSize: 24, fontWeight: 800 }}>{info.creditos} documento{info.creditos === 1 ? '' : 's'}</div>
            <div style={{ fontSize: 14, color: '#64748b' }}>Total a pagar: <b>{clp(info.monto_clp)}</b> CLP</div>
          </div>

          {anulado && <div className="alert alert-error">Este cobro fue anulado. Escríbanos si fue un error.</div>}

          {pagado && (
            <div className="alert alert-ok">
              <b>Pago recibido.</b> La clave de acceso salió por correo a la dirección de contacto de su
              empresa. Si no la ve, revise el correo no deseado.
            </div>
          )}

          {esperando && !pagado && (
            <div className="alert" style={{ background: '#fffbeb', border: '1px solid #f59e0b' }}>
              Confirmando el pago con la pasarela… Esto toma unos segundos.
            </div>
          )}

          {!pagado && !anulado && !esperando && info.pasarela === 'flow' && (
            <>
              <button className="btn btn-primary" style={{ width: '100%', padding: '14px' }} disabled={yendo} onClick={pagar}>
                {yendo ? 'Abriendo el pago…' : `Pagar ${clp(info.monto_clp)}`}
              </button>
              <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>
                El pago se procesa en Flow. Apenas se confirme, su clave de acceso llega por correo de forma automática.
              </p>
            </>
          )}

          {/* Se exige que los tres datos que identifican la cuenta estén
              completos. El backend ya bloquea el ENVÍO del correo sin
              ellos, así que en la práctica nadie llega acá en ese estado
              — pero con la configuración a medias esta tabla mostraba
              "Titular —, Banco —", que es peor que no mostrar nada:
              parece un cobro falso. */}
          {!pagado && !anulado && info.pasarela === 'manual'
            && info.transferencia?.titular && info.transferencia?.banco && info.transferencia?.numero && (
            <>
              <h2 style={{ fontSize: 16, marginTop: 8 }}>Datos para transferir</h2>
              <table style={{ width: '100%', fontSize: 14, marginTop: 8 }}>
                <tbody>
                  <Fila k="Titular" v={info.transferencia.titular} />
                  <Fila k="RUT" v={info.transferencia.rut} />
                  <Fila k="Banco" v={info.transferencia.banco} />
                  <Fila k="Cuenta" v={`${info.transferencia.tipoCuenta} ${info.transferencia.numero}`} />
                  <Fila k="Correo" v={info.transferencia.email} />
                  <Fila k="Monto" v={clp(info.monto_clp)} />
                </tbody>
              </table>
              <p className="muted" style={{ fontSize: 13, marginTop: 14 }}>
                Envíe el comprobante a <b>{info.transferencia.email}</b>. Al confirmarlo le llega su clave de
                acceso por correo, a la dirección de contacto de su empresa.
              </p>
            </>
          )}

          {!pagado && !anulado && info.pasarela === 'manual'
            && !(info.transferencia?.titular && info.transferencia?.banco && info.transferencia?.numero) && (
            <div className="alert alert-error">
              No pudimos mostrarle los datos de pago. Escríbanos y se los enviamos.
            </div>
          )}

          {/* Cambiar de opinión tiene que ser tan fácil como pagar. */}
          <p className="muted" style={{ fontSize: 12, marginTop: 22, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
            ¿No quiere recibir más correos nuestros?{' '}
            <a href={`/pagar/${token}/baja`}>Darse de baja</a>.
            {params.get('ref') ? ` Ref: ${params.get('ref')}` : ''}
          </p>
        </div>
      </div>
    </PublicLayout>
  );
}

const Fila = ({ k, v }) => (
  <tr style={{ borderBottom: '1px solid var(--border)' }}>
    <td style={{ padding: '8px 0', color: '#64748b' }}>{k}</td>
    <td style={{ padding: '8px 0', textAlign: 'right', fontWeight: 600 }}>{v || '—'}</td>
  </tr>
);
