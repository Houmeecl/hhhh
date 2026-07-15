import { useEffect, useMemo, useRef, useState } from 'react';
import Logo from '../components/Logo.jsx';
import { Icon } from '../components/icons.jsx';
import { api, fmt, fmtInt, fmtFecha } from '../api.js';
import { validarRut, formatearRut } from '../lib/rut.js';
import {
  MATERIALES_REP,
  calcularReciclabilidad,
  UMBRAL_EXENCION_REP_KG,
  EXENCION_REP_NOTA,
} from '../lib/rep.js';

// ============================================================
// Terminal POS "Aduana Verde" (tablet) — la cara al público de sicr3p.
//
// Modelo: patrón dispositivo de VecinoXpress/NotaryPro. El terminal es un
// DISPOSITIVO registrado que se conecta con serial + clave (AV-XXXX) y opera
// con marca de dos capas: "Aduana Verde" para el público, "by sicr3p" como
// sistema. El terminal solo CAPTURA documentos y COBRA; el reconocimiento y
// el cálculo de CO2e ocurren en la plataforma sicr3p (POST /api/sesiones).
//
// Cobro = compensación del CO2 calculado: monto = t CO2e × tarifa por
// tonelada (referencial, editable). El pago es SIMULADO y se dice siempre:
// no hay pasarela conectada todavía (la integración real, ej. VirtualPos,
// reemplaza ese paso).
//
// REP (Ley 20.920): los ítems que parecen envases/embalajes se marcan con
// badge "REP" y el operador puede pre-declarar la composición del embalaje
// por componentes, con % de reciclabilidad en vivo (lib/rep.js) y la nota de
// exención <300 kg/año. Además hay "Verificación en recepción" pública (sin
// conectar terminal), al estilo de la validación por QR de SICREP.
// ============================================================

const STORAGE_KEY = 'av_terminal';
const MAX_ARCHIVOS = 5;
const OK_EXT = /\.(pdf|xml|jpe?g|png|heic)$/i;

// Quita tildes y baja a minúsculas para detectar "envase/embalaje" en las
// descripciones sin importar cómo vengan escritas.
const sinTildes = (s) =>
  String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const esItemRep = (descripcion) => /envase|embalaje/.test(sinTildes(descripcion));

// Los endpoints POS son nuevos y no están en api.js: fetch directo local.
async function posAuth(serial, clave) {
  const res = await fetch('/api/pos/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serial, clave }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'auth');
  return data; // { terminal, token }
}

function posActividad(token, documentos_procesados) {
  // Fire and forget: registrar actividad del terminal no debe bloquear el flujo.
  fetch('/api/pos/actividad', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ documentos_procesados }),
  }).catch(() => {});
}

export default function PosTerminal() {
  // pos: null = sin conectar; { demo:true } = modo demostración;
  // { token, terminal } = terminal registrado.
  const [pos, setPos] = useState(null);
  const [paso, setPaso] = useState('inicio'); // inicio | conexion | verificacion | cliente | captura | procesando | resultado | cobro | comprobante

  // Datos del trámite en curso.
  const [cliente, setCliente] = useState({ rut: '', empresa: '', email: '' });
  const [codigo, setCodigo] = useState('');
  const [codigoInfo, setCodigoInfo] = useState(null);
  const [files, setFiles] = useState([]);
  const [resultado, setResultado] = useState(null); // { sesion, facturas }
  const [pago, setPago] = useState(null); // { monto, metodo, tarifa } | 'omitido'

  // Al montar: si hay una sesión de terminal guardada, se reutiliza.
  useEffect(() => {
    try {
      const guardado = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (guardado?.token && guardado?.terminal) {
        setPos({ token: guardado.token, terminal: guardado.terminal });
        setPaso('cliente');
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  function limpiarTramite() {
    setCliente({ rut: '', empresa: '', email: '' });
    setCodigo('');
    setCodigoInfo(null);
    setFiles([]);
    setResultado(null);
    setPago(null);
  }

  function desconectar() {
    localStorage.removeItem(STORAGE_KEY);
    limpiarTramite();
    setPos(null);
    setPaso('inicio');
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
      <HeaderAv pos={pos} />

      <main style={{ flex: 1, display: 'flex', justifyContent: 'center', padding: '28px 16px' }}>
        <div style={{ width: '100%', maxWidth: 640, minWidth: 0 }}>
          {paso === 'inicio' && (
            <Inicio
              onConectar={() => setPaso('conexion')}
              onVerificar={() => setPaso('verificacion')}
            />
          )}

          {paso === 'conexion' && (
            <Conexion
              onVolver={() => setPaso('inicio')}
              onConectado={(sesionPos) => { setPos(sesionPos); setPaso('cliente'); }}
              onDemo={() => { setPos({ demo: true }); setPaso('cliente'); }}
            />
          )}

          {paso === 'verificacion' && <Verificacion onVolver={() => setPaso('inicio')} />}

          {paso === 'cliente' && (
            <Cliente
              cliente={cliente} setCliente={setCliente}
              codigo={codigo} setCodigo={setCodigo}
              codigoInfo={codigoInfo} setCodigoInfo={setCodigoInfo}
              onDesconectar={desconectar}
              demo={!!pos?.demo}
              onContinuar={() => setPaso('captura')}
            />
          )}

          {paso === 'captura' && (
            <Captura
              files={files} setFiles={setFiles}
              onVolver={() => setPaso('cliente')}
              onCancelar={() => { limpiarTramite(); setPaso('cliente'); }}
              onProcesar={() => setPaso('procesando')}
            />
          )}

          {paso === 'procesando' && (
            <Procesando
              cliente={cliente} codigo={codigoInfo ? codigo : ''} files={files}
              onListo={(data) => { setResultado(data); setPaso('resultado'); }}
              onError={() => setPaso('captura')}
            />
          )}

          {paso === 'resultado' && resultado && (
            <Resultado
              resultado={resultado}
              onCancelar={() => { limpiarTramite(); setPaso('cliente'); }}
              onCobrar={() => setPaso('cobro')}
            />
          )}

          {paso === 'cobro' && resultado && (
            <Cobro
              totalCo2e={Number(resultado.sesion?.total_co2e) || 0}
              onVolver={() => setPaso('resultado')}
              onPagado={(p) => { setPago(p); setPaso('comprobante'); }}
              onOmitir={() => { setPago('omitido'); setPaso('comprobante'); }}
            />
          )}

          {paso === 'comprobante' && resultado && (
            <Comprobante
              pos={pos} cliente={cliente} resultado={resultado} pago={pago}
              onNuevo={() => { limpiarTramite(); setPaso('cliente'); }}
            />
          )}
        </div>
      </main>
    </div>
  );
}

// ---------- Header persistente: marca de dos capas ----------
function HeaderAv({ pos }) {
  return (
    <header style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      padding: '14px 20px', background: '#fff', borderBottom: '1px solid var(--border)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <span style={{ color: 'var(--green-600)', display: 'inline-flex', flexShrink: 0 }}>
          <Icon.Leaf size={26} />
        </span>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
          <span style={{ fontWeight: 800, fontSize: 19, color: 'var(--navy)', whiteSpace: 'nowrap' }}>
            Aduana Verde
          </span>
          <span className="muted" style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>
            by <Logo size={13} />
          </span>
        </div>
      </div>
      <div style={{ flexShrink: 0 }}>
        {pos?.terminal && (
          <span className="badge badge-green" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon.Tablet size={13} /> {pos.terminal.serial} conectado
          </span>
        )}
        {pos?.demo && <span className="badge badge-gray">Demo</span>}
      </div>
    </header>
  );
}

function Volver({ onClick, children = '← Volver' }) {
  return (
    <button className="btn btn-outline btn-sm" onClick={onClick} style={{ marginBottom: 16 }}>
      {children}
    </button>
  );
}

// ---------- Pantalla inicial (terminal sin conectar) ----------
function Inicio({ onConectar, onVerificar }) {
  return (
    <div>
      <h1 style={{ fontSize: 24, textAlign: 'center', margin: '10px 0 4px' }}>Terminal Aduana Verde</h1>
      <p className="muted" style={{ textAlign: 'center', marginTop: 0, marginBottom: 24 }}>
        Captura y compensación de CO2e en el punto de atención.
      </p>
      <div style={{ display: 'grid', gap: 14 }}>
        <button onClick={onConectar} className="card card-pad"
          style={{ display: 'flex', alignItems: 'center', gap: 16, textAlign: 'left', border: '1px solid var(--border)', cursor: 'pointer', minHeight: 84 }}>
          <span style={{ color: 'var(--green-600)', flexShrink: 0 }}><Icon.Tablet size={32} /></span>
          <span style={{ minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 700 }}>Conectar terminal</div>
            <div className="muted" style={{ fontSize: 13 }}>
              Ingresa el ID y la clave del dispositivo registrado para atender trámites.
            </div>
          </span>
        </button>
        <button onClick={onVerificar} className="card card-pad"
          style={{ display: 'flex', alignItems: 'center', gap: 16, textAlign: 'left', border: '1px solid var(--border)', cursor: 'pointer', minHeight: 84 }}>
          <span style={{ color: 'var(--green-600)', flexShrink: 0 }}><Icon.Shield size={32} /></span>
          <span style={{ minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 700 }}>Verificación en recepción</div>
            <div className="muted" style={{ fontSize: 13 }}>
              Valida un documento al recibirlo, sin conectar el terminal. Verificación pública.
            </div>
          </span>
        </button>
      </div>
    </div>
  );
}

// ---------- Paso conexión: el terminal es un dispositivo con serial + clave ----------
function Conexion({ onVolver, onConectado, onDemo }) {
  const [serial, setSerial] = useState('');
  const [clave, setClave] = useState('');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  async function conectar(e) {
    e.preventDefault();
    setError('');
    setCargando(true);
    try {
      const { terminal, token } = await posAuth(serial.trim().toUpperCase(), clave);
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, terminal }));
      onConectado({ token, terminal });
    } catch {
      // Error genérico a propósito: no revelar si falló el serial o la clave.
      setError('No se pudo conectar el terminal. Revisa el ID y la clave.');
    } finally {
      setCargando(false);
    }
  }

  return (
    <div>
      <Volver onClick={onVolver} />
      <div className="card card-pad">
        <h2 style={{ marginTop: 0 }}>Conectar terminal</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          Cada terminal Aduana Verde es un dispositivo registrado en la plataforma sicr3p.
        </p>
        <form onSubmit={conectar}>
          <div className="field">
            <label>ID de terminal</label>
            <input required autoFocus value={serial}
              onChange={(e) => setSerial(e.target.value.toUpperCase())}
              placeholder="AV-0000"
              style={{ textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600 }} />
          </div>
          <div className="field">
            <label>Clave del terminal</label>
            <input required type="password" value={clave} onChange={(e) => setClave(e.target.value)} placeholder="••••••••" />
          </div>
          {error && <div className="badge badge-red" style={{ display: 'block', padding: '10px 14px', margin: '10px 0' }}>{error}</div>}
          <button className="btn btn-primary" style={{ width: '100%', marginTop: 8, padding: '14px 0', fontSize: 16 }} disabled={cargando}>
            {cargando ? <span className="spinner" /> : 'Conectar'}
          </button>
        </form>
      </div>

      <div className="card card-pad" style={{ marginTop: 16, textAlign: 'center' }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>Modo demostración (sin terminal registrado)</div>
        <p className="muted" style={{ fontSize: 13, margin: '6px 0 12px' }}>
          Recorre el flujo completo sin credenciales. El procesamiento de documentos igual es real;
          la actividad no queda asociada a ningún terminal.
        </p>
        <button className="btn btn-outline" style={{ width: '100%' }} onClick={onDemo}>
          Entrar en modo demostración
        </button>
      </div>
    </div>
  );
}

// ---------- Paso cliente: datos que exige POST /api/sesiones ----------
function Cliente({ cliente, setCliente, codigo, setCodigo, codigoInfo, setCodigoInfo, onContinuar, onDesconectar, demo }) {
  const [error, setError] = useState('');
  const [codigoError, setCodigoError] = useState('');
  const [validandoCodigo, setValidandoCodigo] = useState(false);

  const rutValido = cliente.rut === '' || validarRut(cliente.rut);

  async function validarCodigo() {
    const c = codigo.trim();
    setCodigoError('');
    setCodigoInfo(null);
    if (!c) return;
    setValidandoCodigo(true);
    try {
      const r = await api.codigoEstado(c);
      setCodigoInfo(r);
    } catch {
      setCodigoError('Código no válido o no encontrado.');
    } finally {
      setValidandoCodigo(false);
    }
  }

  function continuar(e) {
    e.preventDefault();
    setError('');
    if (!cliente.rut || !cliente.empresa || !cliente.email) {
      setError('Completa RUT, empresa y email: son obligatorios para el trámite.');
      return;
    }
    if (!validarRut(cliente.rut)) {
      setError('El RUT no es válido. Revisa el dígito verificador.');
      return;
    }
    onContinuar();
  }

  return (
    <div>
      <Volver onClick={onDesconectar}>{demo ? '← Salir del modo demo' : '← Desconectar terminal'}</Volver>
      <div className="card card-pad">
        <h2 style={{ marginTop: 0 }}>Datos del cliente</h2>
        <form onSubmit={continuar}>
          <div className="field">
            <label>RUT empresa</label>
            <input value={cliente.rut}
              onChange={(e) => setCliente({ ...cliente, rut: e.target.value })}
              onBlur={() => cliente.rut && validarRut(cliente.rut) && setCliente((c) => ({ ...c, rut: formatearRut(c.rut) }))}
              placeholder="76.123.456-7"
              style={!rutValido ? { borderColor: '#ef4444', outlineColor: '#ef4444' } : {}} />
            {!rutValido && <div style={{ color: '#b91c1c', fontSize: 12, marginTop: 4 }}>RUT inválido (dígito verificador)</div>}
            {cliente.rut && rutValido && <div style={{ color: 'var(--green-600)', fontSize: 12, marginTop: 4 }}>✓ RUT válido</div>}
          </div>
          <div className="field">
            <label>Empresa</label>
            <input value={cliente.empresa} onChange={(e) => setCliente({ ...cliente, empresa: e.target.value })} placeholder="Mi Empresa SpA" />
          </div>
          <div className="field">
            <label>Email</label>
            <input type="email" value={cliente.email} onChange={(e) => setCliente({ ...cliente, email: e.target.value })} placeholder="contacto@empresa.cl" />
          </div>

          <div className="field">
            <label>Código de acceso (opcional, con créditos)</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={codigo}
                onChange={(e) => { setCodigo(e.target.value.toUpperCase()); setCodigoInfo(null); setCodigoError(''); }}
                onBlur={validarCodigo}
                placeholder="SICR3P-XXXXXX"
                style={{ textTransform: 'uppercase', letterSpacing: '.05em', flex: 1, minWidth: 0 }} />
              <button type="button" className="btn btn-outline" onClick={validarCodigo} disabled={validandoCodigo || !codigo.trim()}>
                {validandoCodigo ? <span className="spinner dark" /> : 'Validar'}
              </button>
            </div>
            {codigoInfo && (
              <div className="badge badge-green" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
                <Icon.Tag size={13} /> Código válido · {fmtInt(codigoInfo.creditos_restantes)} crédito{Number(codigoInfo.creditos_restantes) === 1 ? '' : 's'} restante{Number(codigoInfo.creditos_restantes) === 1 ? '' : 's'}
              </div>
            )}
            {codigoError && <div className="badge badge-red" style={{ display: 'inline-block', marginTop: 8 }}>{codigoError}</div>}
          </div>

          {error && <div className="badge badge-red" style={{ display: 'block', padding: '10px 14px', margin: '10px 0' }}>{error}</div>}
          <button className="btn btn-primary" style={{ width: '100%', marginTop: 8, padding: '14px 0', fontSize: 16 }}>
            Continuar a captura
          </button>
        </form>
      </div>
    </div>
  );
}

// ---------- Paso captura: el terminal captura; la plataforma reconoce y calcula ----------
function Captura({ files, setFiles, onVolver, onCancelar, onProcesar }) {
  const camRef = useRef(null);
  const archRef = useRef(null);
  const [error, setError] = useState('');

  function addFiles(list) {
    setError('');
    const entrantes = Array.from(list || []).filter((f) => OK_EXT.test(f.name));
    const rechazados = Array.from(list || []).length - entrantes.length;
    if (rechazados > 0) setError('Algunos archivos no tienen un formato permitido (PDF, XML, JPG, PNG, HEIC).');
    const combinados = [...files, ...entrantes];
    if (combinados.length > MAX_ARCHIVOS) {
      setError(`Máximo ${MAX_ARCHIVOS} documentos por trámite.`);
    }
    setFiles(combinados.slice(0, MAX_ARCHIVOS));
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <Volver onClick={onVolver} />
        <button className="btn btn-ghost btn-sm" onClick={onCancelar} style={{ marginBottom: 16, color: '#b91c1c' }}>
          Cancelar trámite
        </button>
      </div>
      <div className="card card-pad">
        <h2 style={{ marginTop: 0 }}>Capturar documentos</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          Fotografía la factura o guía con la cámara, o carga el XML/PDF. Hasta {MAX_ARCHIVOS} documentos.
        </p>

        <div className="two-col-grid" style={{ margin: '14px 0' }}>
          <button type="button" className="btn btn-outline" style={{ padding: '18px 10px', flexDirection: 'column', gap: 6 }}
            onClick={() => camRef.current?.click()}>
            <Icon.Camera size={28} />
            <span>Tomar foto</span>
          </button>
          <button type="button" className="btn btn-outline" style={{ padding: '18px 10px', flexDirection: 'column', gap: 6 }}
            onClick={() => archRef.current?.click()}>
            <Icon.Upload size={28} />
            <span>Cargar XML / PDF</span>
          </button>
        </div>
        {/* Cámara real de la tablet (trasera) */}
        <input ref={camRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
          onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
        <input ref={archRef} type="file" multiple accept=".pdf,.xml,.jpg,.jpeg,.png,.heic" style={{ display: 'none' }}
          onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />

        {files.length > 0 && (
          <div className="file-list">
            {files.map((f, i) => (
              <div className="file-item" key={i}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <Icon.Doc size={16} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                </span>
                <span className="rm" onClick={() => setFiles(files.filter((_, j) => j !== i))}>Quitar</span>
              </div>
            ))}
            <div className="muted" style={{ fontSize: 13 }}>{files.length} de {MAX_ARCHIVOS} documentos</div>
          </div>
        )}

        {error && <div className="badge badge-red" style={{ display: 'block', padding: '10px 14px', margin: '10px 0' }}>{error}</div>}

        <button className="btn btn-primary" style={{ width: '100%', marginTop: 8, padding: '14px 0', fontSize: 16 }}
          onClick={onProcesar} disabled={files.length === 0}>
          Procesar {files.length > 0 ? `${files.length} documento${files.length > 1 ? 's' : ''}` : 'documentos'}
        </button>
        <p className="muted" style={{ fontSize: 12, marginTop: 10, textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <Icon.Info size={14} /> El reconocimiento y cálculo se hace en la plataforma sicr3p.
        </p>
      </div>
    </div>
  );
}

// ---------- Paso procesando: POST /api/sesiones real ----------
function Procesando({ cliente, codigo, files, onListo, onError }) {
  const [error, setError] = useState('');
  const enviado = useRef(false);

  useEffect(() => {
    if (enviado.current) return; // evitar doble envío en StrictMode
    enviado.current = true;
    (async () => {
      try {
        const fd = new FormData();
        fd.append('rut', cliente.rut);
        fd.append('empresa', cliente.empresa);
        fd.append('email', cliente.email);
        if (codigo) fd.append('codigo', codigo);
        files.forEach((f) => fd.append('archivos', f));
        const data = await api.crearSesion(fd);
        onListo(data);
      } catch (e) {
        setError(e.message || 'No se pudo procesar el trámite.');
      }
    })();
  }, []);

  if (error) {
    return (
      <div className="card card-pad" style={{ textAlign: 'center' }}>
        <div style={{ color: '#b45309', display: 'flex', justifyContent: 'center' }}><Icon.Alert size={40} /></div>
        <h2>No se pudo procesar</h2>
        <div className="badge badge-red" style={{ display: 'block', padding: '10px 14px', margin: '10px 0' }}>{error}</div>
        <button className="btn btn-primary" style={{ width: '100%' }} onClick={onError}>Volver a la captura</button>
      </div>
    );
  }

  return (
    <div className="card card-pad" style={{ textAlign: 'center', padding: '48px 24px' }}>
      <span className="spinner dark" style={{ width: 34, height: 34 }} />
      <h2 style={{ margin: '18px 0 4px' }}>Procesando en plataforma…</h2>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        sicr3p está reconociendo los documentos y calculando el CO2e.
      </p>
    </div>
  );
}

// ---------- Paso resultado: cálculo del servidor + bloque REP Ley 20.920 ----------
function Resultado({ resultado, onCancelar, onCobrar }) {
  const { sesion, facturas = [] } = resultado;
  const items = useMemo(() => facturas.flatMap((f) => f.items || []), [facturas]);
  const categorias = useMemo(
    () => [...new Set(facturas.map((f) => f.categoria).filter(Boolean))],
    [facturas]
  );
  const motorPropio = facturas.some((f) => f.motor === 'propio');
  const hayRep = items.some((it) => esItemRep(it.descripcion));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn btn-ghost btn-sm" onClick={onCancelar} style={{ marginBottom: 16, color: '#b91c1c' }}>
          Cancelar trámite
        </button>
      </div>
      <div className="card card-pad">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, flex: 1, minWidth: 0 }}>Resultado del cálculo</h2>
          <span className={`badge ${motorPropio ? 'badge-green' : 'badge-gray'}`}>
            {motorPropio ? 'Cálculo motor sicr3p' : 'Cálculo motor externo'}
          </span>
        </div>

        <div style={{ textAlign: 'center', margin: '18px 0' }}>
          <div style={{ fontSize: 42, fontWeight: 800, color: 'var(--green-600)', lineHeight: 1 }}>
            {fmt(sesion?.total_co2e, 3)} <small style={{ fontSize: 16, color: 'var(--navy)', fontWeight: 600 }}>t CO2e</small>
          </div>
          <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
            {categorias.length > 0 ? `Categoría: ${categorias.join(' · ')}` : 'Total del trámite'}
          </div>
        </div>

        <h3 style={{ margin: '0 0 8px' }}>Detalle por ítem</h3>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr><th>Descripción</th><th className="num">Cant.</th><th className="num">t CO2e</th><th className="num">% del total</th></tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i}>
                  <td>
                    {it.descripcion}{' '}
                    {esItemRep(it.descripcion) && <span className="badge badge-amber" title="Envase/embalaje: producto prioritario Ley 20.920">REP</span>}
                  </td>
                  <td className="num">{fmtInt(it.cantidad)}</td>
                  <td className="num">{fmt(it.co2e, 4)}</td>
                  <td className="num">{fmt(it.porcentaje_total, 1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {hayRep && (
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Los ítems marcados <span className="badge badge-amber">REP</span> parecen envases o embalajes:
            productos prioritarios de la Ley 20.920 (Responsabilidad Extendida del Productor).
          </p>
        )}

        <DeclaracionEmbalaje />

        <button className="btn btn-primary" style={{ width: '100%', marginTop: 18, padding: '14px 0', fontSize: 16 }} onClick={onCobrar}>
          Continuar a compensación
        </button>
      </div>
    </div>
  );
}

// Sección plegable: pre-declaración de embalaje por componentes (SICREP,
// Ley 20.920) con % de reciclabilidad en vivo.
function DeclaracionEmbalaje() {
  const [abierta, setAbierta] = useState(false);
  const [componentes, setComponentes] = useState([]);
  const calculo = calcularReciclabilidad(componentes);

  const nivelBadge = { Alto: 'badge-green', Medio: 'badge-amber', Bajo: 'badge-red' };

  function agregar() {
    setComponentes((cs) => [...cs, { material: MATERIALES_REP[0].codigo, peso_gr: '', cantidad: '1', reciclable: true }]);
  }
  function actualizar(i, patch) {
    setComponentes((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  }
  function quitar(i) {
    setComponentes((cs) => cs.filter((_, j) => j !== i));
  }

  return (
    <div style={{ marginTop: 18, border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
      <button type="button" onClick={() => setAbierta((a) => !a)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px',
          background: 'var(--bg)', border: 'none', cursor: 'pointer', textAlign: 'left',
          font: 'inherit', color: 'var(--navy)',
        }}>
        <span style={{ color: 'var(--green-600)', display: 'inline-flex', flexShrink: 0 }}><Icon.Package size={20} /></span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>Declaración de embalaje (opcional)</span>
          <span className="muted" style={{ display: 'block', fontSize: 12 }}>Ley 20.920 · composición por componentes y reciclabilidad</span>
        </span>
        <span className="muted" style={{ flexShrink: 0 }}>{abierta ? '▴' : '▾'}</span>
      </button>

      {abierta && (
        <div style={{ padding: 16 }}>
          {componentes.length === 0 && (
            <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
              Agrega los componentes del embalaje (caja, film, zuncho…) para estimar su reciclabilidad.
            </p>
          )}

          {componentes.map((c, i) => (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10,
              alignItems: 'end', padding: '10px 0', borderBottom: '1px solid var(--border)',
            }}>
              <div className="field" style={{ margin: 0, minWidth: 0 }}>
                <label>Material</label>
                <select value={c.material} onChange={(e) => actualizar(i, { material: e.target.value })}>
                  {MATERIALES_REP.map((m) => <option key={m.codigo} value={m.codigo}>{m.nombre}</option>)}
                </select>
              </div>
              <div className="field" style={{ margin: 0, minWidth: 0 }}>
                <label>Peso unitario (gr)</label>
                <input inputMode="decimal" value={c.peso_gr} placeholder="250"
                  onChange={(e) => actualizar(i, { peso_gr: e.target.value.replace(/[^\d.,]/g, '').replace(',', '.') })} />
              </div>
              <div className="field" style={{ margin: 0, minWidth: 0 }}>
                <label>Cantidad</label>
                <input inputMode="numeric" value={c.cantidad} placeholder="1"
                  onChange={(e) => actualizar(i, { cantidad: e.target.value.replace(/\D/g, '') })} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 10, minWidth: 0 }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: 'var(--navy)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!c.reciclable} onChange={(e) => actualizar(i, { reciclable: e.target.checked })} />
                  Reciclable
                </label>
                <span className="rm" style={{ color: '#b91c1c', cursor: 'pointer', fontWeight: 600, fontSize: 13 }} onClick={() => quitar(i)}>Quitar</span>
              </div>
            </div>
          ))}

          <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 12 }} onClick={agregar}>
            + Agregar componente
          </button>

          {calculo.nivel && (
            <div style={{ marginTop: 14, padding: '12px 16px', background: 'var(--bg)', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--green-600)' }}>{fmt(calculo.porcentaje, 1)}%</div>
              <div style={{ minWidth: 0 }}>
                <span className={`badge ${nivelBadge[calculo.nivel]}`}>Reciclabilidad: {calculo.nivel}</span>
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  {fmtInt(calculo.peso_reciclable_gr)} gr reciclables de {fmtInt(calculo.peso_total_gr)} gr totales
                </div>
              </div>
            </div>
          )}

          <p className="muted" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
            <b>Exención &lt;{UMBRAL_EXENCION_REP_KG} kg/año:</b> {EXENCION_REP_NOTA}
          </p>
        </div>
      )}
    </div>
  );
}

// ---------- Paso cobro: compensación del CO2 calculado (pago SIMULADO) ----------
function Cobro({ totalCo2e, onVolver, onPagado, onOmitir }) {
  const [tarifa, setTarifa] = useState('5000'); // CLP por t CO2e
  const [metodo, setMetodo] = useState('tarjeta');
  const [procesando, setProcesando] = useState(false);

  const monto = Math.round(totalCo2e * (Number(tarifa) || 0));

  async function cobrar() {
    setProcesando(true);
    // Simulación del cobro: sin pasarela conectada todavía.
    await new Promise((r) => setTimeout(r, 1200));
    onPagado({ monto, metodo, tarifa: Number(tarifa) || 0 });
  }

  return (
    <div>
      <Volver onClick={onVolver} />
      <div className="card card-pad">
        <h2 style={{ marginTop: 0 }}>Compensación del CO2 calculado</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          El monto a cobrar corresponde a compensar las toneladas calculadas por la plataforma.
        </p>

        <div className="field">
          <label>Tarifa por t CO2e (CLP)</label>
          <input inputMode="numeric" value={tarifa}
            onChange={(e) => setTarifa(e.target.value.replace(/\D/g, ''))} />
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            Tarifa referencial (ancla: impuesto verde chileno US$5/t) — validar.
          </div>
        </div>

        <div style={{ margin: '14px 0', padding: '14px 16px', background: 'var(--bg)', borderRadius: 10, textAlign: 'center' }}>
          <div className="muted" style={{ fontSize: 13 }}>
            {fmt(totalCo2e, 3)} t CO2e × ${fmtInt(Number(tarifa) || 0)}
          </div>
          <div style={{ fontSize: 30, fontWeight: 800, color: 'var(--navy)' }}>= ${fmtInt(monto)} CLP</div>
        </div>

        <div className="field" style={{ marginBottom: 16 }}>
          <label>Método de pago</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8 }}>
            {[
              ['tarjeta', 'Tarjeta', Icon.CreditCard],
              ['nfc', 'NFC', Icon.Nfc],
              ['qr', 'QR', Icon.Qr],
            ].map(([valor, etiqueta, Ico]) => (
              <label key={valor} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                padding: '12px 8px', borderRadius: 10, cursor: 'pointer', fontWeight: 600, fontSize: 14, minWidth: 0,
                border: `1.5px solid ${metodo === valor ? 'var(--green)' : 'var(--border)'}`,
                background: metodo === valor ? 'var(--green-50)' : '#fff',
                color: metodo === valor ? 'var(--green-600)' : 'var(--navy)',
              }}>
                <input type="radio" name="metodo-pago" value={valor} checked={metodo === valor}
                  onChange={() => setMetodo(valor)} style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }} />
                <Ico size={18} /> {etiqueta}
              </label>
            ))}
          </div>
        </div>

        <button className="btn btn-primary" style={{ width: '100%', padding: '14px 0', fontSize: 16 }}
          onClick={cobrar} disabled={procesando || monto <= 0}>
          {procesando ? <span className="spinner" /> : `Cobrar $${fmtInt(monto)}`}
        </button>
        <button className="btn btn-ghost" style={{ width: '100%', marginTop: 8 }} onClick={onOmitir} disabled={procesando}>
          Omitir cobro
        </button>

        <p className="muted" style={{ fontSize: 12, marginTop: 12, textAlign: 'center' }}>
          Pago simulado — sin pasarela conectada todavía. Con la integración real (ej. VirtualPos)
          este paso se reemplaza por el cobro efectivo.
        </p>
      </div>
    </div>
  );
}

// ---------- Paso comprobante: QR real, verificación pública y actividad POS ----------
function Comprobante({ pos, cliente, resultado, pago, onNuevo }) {
  const { sesion, facturas = [] } = resultado;
  const f0 = facturas[0];
  const notificado = useRef(false);

  // Registrar actividad del terminal (solo si hay terminal real conectado).
  useEffect(() => {
    if (notificado.current) return;
    notificado.current = true;
    if (pos?.token) posActividad(pos.token, facturas.length);
  }, []);

  const hash = f0?.hash_cadena || '';
  const hashCorto = hash ? `${hash.slice(0, 10)}…${hash.slice(-8)}` : null;

  return (
    <div className="card card-pad" style={{ textAlign: 'center' }}>
      <div style={{ color: 'var(--green-600)', display: 'flex', justifyContent: 'center', margin: '6px 0' }}>
        <Icon.CheckCircle size={56} />
      </div>
      <h2 style={{ margin: '0 0 4px' }}>Trámite registrado</h2>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Comprobante Aduana Verde · plataforma sicr3p</p>

      <div style={{ margin: '16px 0', padding: '14px 16px', background: 'var(--bg)', borderRadius: 12, textAlign: 'left' }}>
        <div className="two-col-grid" style={{ fontSize: 14, gap: 10 }}>
          <div><span className="muted">Cliente</span><br /><b>{cliente.empresa}</b><br /><span className="muted" style={{ fontSize: 12 }}>{cliente.rut}</span></div>
          <div><span className="muted">Total calculado</span><br /><b>{fmt(sesion?.total_co2e, 3)} t CO2e</b></div>
          <div>
            <span className="muted">Compensación</span><br />
            {pago && pago !== 'omitido'
              ? <><b>${fmtInt(pago.monto)} CLP</b><br /><span className="badge badge-amber" style={{ marginTop: 2 }}>Pago simulado · {pago.metodo}</span></>
              : <span className="badge badge-gray">Sin cobro</span>}
          </div>
          <div><span className="muted">Documentos</span><br /><b>{fmtInt(facturas.length)}</b></div>
        </div>
      </div>

      {f0 && (
        <>
          <img src={api.qrUrl(f0.id)} alt={`Código QR de verificación del documento ${f0.numero_venta || f0.id}`}
            width={150} height={150}
            style={{ maxWidth: '100%', border: '1px solid var(--border)', borderRadius: 12, padding: 8, background: '#fff' }} />
          <div style={{ marginTop: 8 }}>
            <a href={`/verificar/${f0.id}`} target="_blank" rel="noreferrer" style={{ fontWeight: 700, fontSize: 14 }}>
              Verificar trazabilidad →
            </a>
          </div>
          {hashCorto && (
            <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
              Eslabón #{fmtInt(f0.eslabon)} · hash{' '}
              <span style={{ fontFamily: 'monospace' }}>{hashCorto}</span>
            </div>
          )}
        </>
      )}

      <div className="two-col-grid" style={{ marginTop: 18 }}>
        <a className="btn btn-outline" href={api.informeUrl(sesion.id)} target="_blank" rel="noreferrer"
          style={{ display: 'inline-flex' }}>
          <Icon.Download size={16} /> Informe PDF
        </a>
        <button className="btn btn-primary" onClick={onNuevo}>Nuevo trámite</button>
      </div>
    </div>
  );
}

// ---------- Verificación en recepción (pública, sin conectar terminal) ----------
function Verificacion({ onVolver }) {
  const [entrada, setEntrada] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  async function verificar(e) {
    e.preventDefault();
    setError('');
    setData(null);
    // Acepta el código directo o una URL /verificar/<id> pegada desde el QR.
    const m = entrada.match(/verificar\/([^/?#\s]+)/i);
    const id = (m ? m[1] : entrada).trim();
    if (!id) return;
    setCargando(true);
    try {
      const r = await api.verificar(id);
      setData(r);
    } catch {
      setError('Documento no encontrado. Revisa el código o el enlace del QR.');
    } finally {
      setCargando(false);
    }
  }

  return (
    <div>
      <Volver onClick={onVolver} />
      <div className="card card-pad">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: 'var(--green-600)', display: 'inline-flex' }}><Icon.Shield size={26} /></span>
          <h2 style={{ margin: 0 }}>Verificación en recepción</h2>
        </div>
        <p className="muted" style={{ fontSize: 13 }}>
          Para portería o recepción: pega el código del documento (o el enlace del QR del comprobante)
          y confirma su trazabilidad antes de recibir la carga.
        </p>
        <form onSubmit={verificar}>
          <div className="field">
            <label>Código del documento</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input required autoFocus value={entrada} onChange={(e) => setEntrada(e.target.value)}
                placeholder="p. ej. 3f2a…-…-… o https://sicr3p.cl/verificar/…"
                style={{ flex: 1, minWidth: 0 }} />
              <button className="btn btn-primary" disabled={cargando}>
                {cargando ? <span className="spinner" /> : 'Verificar'}
              </button>
            </div>
          </div>
        </form>

        {error && (
          <div className="badge badge-red" style={{ display: 'block', padding: '10px 14px', marginTop: 6 }}>{error}</div>
        )}

        {data && (
          <div style={{ marginTop: 14, padding: '16px', background: 'var(--bg)', borderRadius: 12, textAlign: 'left' }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              <span className={`badge ${data.valido ? 'badge-green' : 'badge-red'}`} style={{ fontSize: 13, padding: '5px 12px' }}>
                {data.valido ? '✓ Documento válido' : '✗ Documento no válido'}
              </span>
              {data.cadena && (
                <span className={`badge ${data.cadena.intacto ? 'badge-green' : 'badge-red'}`} style={{ fontSize: 13, padding: '5px 12px' }}>
                  {data.cadena.intacto ? '✓ Cadena intacta' : '⚠ Cadena alterada'}
                </span>
              )}
            </div>
            <div className="two-col-grid" style={{ fontSize: 14, gap: 10 }}>
              <div><span className="muted">Cliente</span><br /><b>{data.cliente?.nombre}</b><br /><span className="muted" style={{ fontSize: 12 }}>{data.cliente?.rut}</span></div>
              <div><span className="muted">Total</span><br /><b>{fmt(data.factura?.total_co2e, 3)} t CO2e</b></div>
              <div><span className="muted">Categoría</span><br /><b>{data.factura?.categoria || '—'}</b></div>
              <div><span className="muted">Fecha</span><br /><b>{fmtFecha(data.factura?.fecha)}</b></div>
            </div>
            {data.cadena && (
              <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
                Eslabón #{fmtInt(data.cadena.eslabon)} ·{' '}
                <span style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{data.cadena.hash_cadena}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
