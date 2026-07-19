import { useEffect, useMemo, useRef, useState } from 'react';
import Logo from '../components/Logo.jsx';
import { Icon } from '../components/icons.jsx';
import { api, fmt, fmtInt, fmtFecha } from '../api.js';
import { validarRut, formatearRut } from '../lib/rut.js';
import DeclaracionEmbalaje, { NIVEL_BADGE } from '../components/DeclaracionEmbalaje.jsx';
import { t } from '../lib/i18n.js';

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

// Etiquetas legibles de cada paso, para el aria-label del header y lectores
// de pantalla (el estado interno usa claves cortas).
const PASO_LABEL = {
  inicio: 'Inicio',
  conexion: 'Conexión del terminal',
  verificacion: 'Verificación en recepción',
  cliente: 'Datos del cliente',
  captura: 'Captura de documentos',
  procesando: 'Procesando',
  resultado: 'Resultado del cálculo',
  cobro: 'Compensación',
  comprobante: 'Comprobante',
};

// Quita tildes y baja a minúsculas para detectar "envase/embalaje" en las
// descripciones sin importar cómo vengan escritas.
const sinTildes = (s) =>
  String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const esItemRep = (descripcion) => /envase|embalaje/.test(sinTildes(descripcion));

// ---------- Sello compartible (mismo helper que en Resultado.jsx) ----------
// Duplicado a propósito: no va en api.js (se edita en paralelo). El sello SVG
// lo sirve GET /api/sesiones/:id/sello.svg y el snippet enlaza a la
// verificación pública de la primera factura de la sesión.
function selloSnippet(sesionId, facturaId) {
  const origin = window.location.origin;
  return `<a href="${origin}/verificar/${facturaId}"><img src="${origin}/api/sesiones/${sesionId}/sello.svg" alt="Contabilidad de carbono trazable — sicr3p" width="340"></a>`;
}

// Copia al portapapeles con fallback de <textarea> (navegadores sin Clipboard API).
async function copiarTexto(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = texto;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

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

// Registra la compensación (simulada u omitida) de la sesión. Fetch directo
// local para poder mandar el Bearer del terminal POS cuando hay uno conectado
// (así el backend atribuye el cobro al terminal); sin token va anónimo.
async function posRegistrarCompensacion(token, sesionId, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`/api/sesiones/${sesionId}/compensacion`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'No se pudo registrar la compensación');
  return data; // { compensacion }
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
  // pago: { estado:'simulado'|'omitido', monto?, metodo?, tarifa?, compensacion?, errorRegistro? } | null
  const [pago, setPago] = useState(null);
  // Accesibilidad: al cambiar de paso, el foco salta al título del paso para
  // que lectores de pantalla anuncien dónde quedó el usuario.
  const contenidoRef = useRef(null);
  // Declaración de embalaje REP: los componentes en edición y la declaración
  // ya guardada en el backend viven en el padre para sobrevivir al cambio de
  // paso (resultado → cobro → comprobante y de vuelta).
  const [embComponentes, setEmbComponentes] = useState([]);
  const [embalajeGuardado, setEmbalajeGuardado] = useState(null); // declaracion del servidor | null

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

  useEffect(() => {
    const titulo = contenidoRef.current?.querySelector('h1, h2');
    if (titulo) {
      titulo.setAttribute('tabindex', '-1');
      titulo.style.outline = 'none';
      titulo.focus();
    }
  }, [paso]);

  function limpiarTramite() {
    setCliente({ rut: '', empresa: '', email: '' });
    setCodigo('');
    setCodigoInfo(null);
    setFiles([]);
    setResultado(null);
    setPago(null);
    setEmbComponentes([]);
    setEmbalajeGuardado(null);
  }

  function desconectar() {
    localStorage.removeItem(STORAGE_KEY);
    limpiarTramite();
    setPos(null);
    setPaso('inicio');
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
      <HeaderAv pos={pos} paso={paso} />

      <main style={{ flex: 1, display: 'flex', justifyContent: 'center', padding: '28px 16px' }}>
        <div ref={contenidoRef} style={{ width: '100%', maxWidth: 640, minWidth: 0 }}>
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
              embComponentes={embComponentes} setEmbComponentes={setEmbComponentes}
              embalajeGuardado={embalajeGuardado} setEmbalajeGuardado={setEmbalajeGuardado}
              onCancelar={() => { limpiarTramite(); setPaso('cliente'); }}
              onCobrar={() => setPaso('cobro')}
            />
          )}

          {paso === 'cobro' && resultado && (
            <Cobro
              sesionId={resultado.sesion?.id}
              posToken={pos?.token}
              totalCo2e={Number(resultado.sesion?.total_co2e) || 0}
              onVolver={() => setPaso('resultado')}
              onPagado={(p) => { setPago(p); setPaso('comprobante'); }}
              onOmitir={(p) => { setPago(p); setPaso('comprobante'); }}
            />
          )}

          {paso === 'comprobante' && resultado && (
            <Comprobante
              pos={pos} cliente={cliente} resultado={resultado} pago={pago} embalaje={embalajeGuardado}
              onNuevo={() => { limpiarTramite(); setPaso('cliente'); }}
            />
          )}
        </div>
      </main>
    </div>
  );
}

// ---------- Header persistente: marca de dos capas ----------
function HeaderAv({ pos, paso }) {
  return (
    <header
      aria-label={`Terminal Aduana Verde — paso: ${PASO_LABEL[paso] || paso}`}
      style={{
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
function Resultado({ resultado, embComponentes, setEmbComponentes, embalajeGuardado, setEmbalajeGuardado, onCancelar, onCobrar }) {
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

        <DeclaracionEmbalaje
          sesionId={sesion?.id}
          componentes={embComponentes} setComponentes={setEmbComponentes}
          guardada={embalajeGuardado}
          onGuardada={setEmbalajeGuardado}
          onModificar={() => setEmbalajeGuardado(null)}
        />

        <button className="btn btn-primary" style={{ width: '100%', marginTop: 18, padding: '14px 0', fontSize: 16 }} onClick={onCobrar}>
          Continuar a compensación
        </button>
      </div>
    </div>
  );
}

// ---------- Paso cobro: compensación del CO2 calculado (pago SIMULADO) ----------
function Cobro({ sesionId, posToken, totalCo2e, onVolver, onPagado, onOmitir }) {
  const [tarifa, setTarifa] = useState('5000'); // fallback si no hay config del servidor
  const [config, setConfig] = useState(null); // { tarifa_clp_tco2e, fuente } | null
  const [configFallo, setConfigFallo] = useState(false);
  const [metodo, setMetodo] = useState('tarjeta');
  const [procesando, setProcesando] = useState(false);
  const [omitiendo, setOmitiendo] = useState(false);

  // Tarifa oficial desde la plataforma; si no responde, se cae al modo
  // editable con el valor referencial de siempre.
  useEffect(() => {
    let vivo = true;
    api.posConfig()
      .then((c) => {
        if (!vivo) return;
        setConfig(c);
        if (c?.tarifa_clp_tco2e != null) setTarifa(String(c.tarifa_clp_tco2e));
      })
      .catch(() => { if (vivo) setConfigFallo(true); });
    return () => { vivo = false; };
  }, []);

  const tarifaNum = Number(tarifa) || 0;
  const monto = Math.round(totalCo2e * tarifaNum);
  // Tipo de cambio USD/CLP referencial: solo si la config lo trae (> 0).
  // Tolerante a backends sin el campo: null = no se muestra nada en USD.
  const tipoCambio = Number(config?.tipo_cambio_usd_clp) > 0 ? Number(config.tipo_cambio_usd_clp) : null;

  // Registra la compensación en la plataforma. Si falla, el trámite continúa
  // igual (no se bloquea) pero el comprobante avisa que no quedó registrada.
  async function registrar(estado, extra = {}) {
    try {
      const { compensacion } = await posRegistrarCompensacion(posToken, sesionId, { estado, ...extra });
      return { compensacion, errorRegistro: false };
    } catch {
      return { compensacion: null, errorRegistro: true };
    }
  }

  async function cobrar() {
    setProcesando(true);
    // Simulación del cobro: sin pasarela conectada todavía.
    await new Promise((r) => setTimeout(r, 1200));
    const { compensacion, errorRegistro } = await registrar('simulado', { metodo });
    // El monto/tarifa que se muestra después es el que DEVUELVE el servidor
    // (recalcula con su tarifa); lo local queda solo de respaldo.
    onPagado({
      estado: 'simulado',
      metodo,
      monto: compensacion?.monto_clp != null ? Number(compensacion.monto_clp) : monto,
      tarifa: compensacion?.tarifa_clp_tco2e != null ? Number(compensacion.tarifa_clp_tco2e) : tarifaNum,
      // Para el "≈ US$ (referencial)" del comprobante: manda el tipo de cambio
      // del servidor si vino en la compensación; si no, el de la config.
      tipoCambio: Number(compensacion?.tipo_cambio_usd_clp) > 0
        ? Number(compensacion.tipo_cambio_usd_clp)
        : tipoCambio,
      compensacion,
      errorRegistro,
    });
  }

  async function omitir() {
    setOmitiendo(true);
    const { compensacion, errorRegistro } = await registrar('omitido');
    onOmitir({ estado: 'omitido', compensacion, errorRegistro });
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
          {config ? (
            <>
              <input inputMode="numeric" value={tarifa} readOnly aria-readonly="true"
                style={{ background: 'var(--bg)' }} />
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                Tarifa vigente — configurable en el panel{config.fuente ? ` · Fuente: ${config.fuente}` : ''}.
              </div>
            </>
          ) : (
            <>
              <input inputMode="numeric" value={tarifa}
                onChange={(e) => setTarifa(e.target.value.replace(/\D/g, ''))} />
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                {configFallo
                  ? 'No se pudo cargar la tarifa oficial — usando valor referencial editable (ancla: impuesto verde chileno US$5/t) — validar.'
                  : 'Tarifa referencial (ancla: impuesto verde chileno US$5/t) — validar.'}
              </div>
            </>
          )}
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
          onClick={cobrar} disabled={procesando || omitiendo || monto <= 0}>
          {procesando ? <span className="spinner" /> : `Cobrar $${fmtInt(monto)}`}
        </button>
        <button className="btn btn-ghost" style={{ width: '100%', marginTop: 8 }} onClick={omitir} disabled={procesando || omitiendo}>
          {omitiendo ? <span className="spinner dark" /> : 'Omitir cobro'}
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
// Comprobante bilingüe: un botón discreto alterna las ETIQUETAS entre español
// e inglés (los datos no cambian). Usa t(clave, idioma) del i18n con idioma
// explícito, sin tocar el idioma global del sitio.
function Comprobante({ pos, cliente, resultado, pago, embalaje, onNuevo }) {
  const { sesion, facturas = [] } = resultado;
  const f0 = facturas[0];
  const notificado = useRef(false);
  // Envío del comprobante por correo: null | 'enviando' | 'ok' | 'error'
  const [envio, setEnvio] = useState(null);
  // Feedback del botón "Copiar código del sello": null | 'ok' | 'error'
  const [selloCopia, setSelloCopia] = useState(null);
  // Idioma del comprobante (solo etiquetas): false = español, true = inglés.
  const [enIngles, setEnIngles] = useState(false);
  const lr = (clave) => t(clave, enIngles ? 'en' : 'es');
  // USD referencial del monto compensado: solo si llegó tipo de cambio (> 0).
  const usdComp = pago?.estado === 'simulado' && Number(pago?.tipoCambio) > 0
    ? Math.round(Number(pago.monto) / Number(pago.tipoCambio))
    : null;

  async function copiarSello() {
    const ok = await copiarTexto(selloSnippet(sesion.id, f0.id));
    setSelloCopia(ok ? 'ok' : 'error');
    if (ok) setTimeout(() => setSelloCopia(null), 2500);
  }

  // Registrar actividad del terminal (solo si hay terminal real conectado).
  useEffect(() => {
    if (notificado.current) return;
    notificado.current = true;
    if (pos?.token) posActividad(pos.token, facturas.length);
  }, []);

  const hash = f0?.hash_cadena || '';
  const hashCorto = hash ? `${hash.slice(0, 10)}…${hash.slice(-8)}` : null;
  const compId = pago?.compensacion?.id != null ? String(pago.compensacion.id) : null;
  const compIdCorto = compId ? (compId.length > 8 ? `${compId.slice(0, 8)}…` : compId) : null;

  async function enviarCorreo() {
    setEnvio('enviando');
    try {
      const r = await api.enviarComprobanteCorreo(sesion.id);
      setEnvio(r?.ok ? 'ok' : 'error');
    } catch {
      setEnvio('error');
    }
  }

  return (
    <div className="card card-pad" style={{ textAlign: 'center' }}>
      <div style={{ color: 'var(--green-600)', display: 'flex', justifyContent: 'center', margin: '6px 0' }}>
        <Icon.CheckCircle size={56} />
      </div>
      <h2 style={{ margin: '0 0 4px' }}>{lr('pos.tramite_registrado')}</h2>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>{lr('pos.comprobante_sub')}</p>

      {/* Alterna solo las etiquetas del comprobante; los datos no cambian. */}
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEnIngles((v) => !v)}
        aria-pressed={enIngles} style={{ marginTop: 2 }}>
        {enIngles ? 'Comprobante en español / Spanish receipt' : 'Comprobante en inglés / English receipt'}
      </button>

      {pago?.errorRegistro && (
        <div className="badge badge-red" style={{ display: 'block', padding: '10px 14px', margin: '10px 0', textAlign: 'left' }}>
          {lr('pos.error_registro')}
        </div>
      )}

      <div style={{ margin: '16px 0', padding: '14px 16px', background: 'var(--bg)', borderRadius: 12, textAlign: 'left' }}>
        <div className="two-col-grid" style={{ fontSize: 14, gap: 10 }}>
          <div><span className="muted">{lr('pos.cliente')}</span><br /><b>{cliente.empresa}</b><br /><span className="muted" style={{ fontSize: 12 }}>{cliente.rut}</span></div>
          <div><span className="muted">{lr('pos.total_calculado')}</span><br /><b>{fmt(sesion?.total_co2e, 3)} t CO2e</b></div>
          <div>
            <span className="muted">{lr('pos.compensacion')}</span><br />
            {pago?.estado === 'simulado'
              ? <>
                  <b>${fmtInt(pago.monto)} CLP</b>
                  {usdComp != null && (
                    <div className="muted" style={{ fontSize: 12 }}>
                      ≈ US$ {usdComp.toLocaleString('en-US')} ({lr('comun.referencial')})
                    </div>
                  )}
                  <span className="badge badge-amber" style={{ marginTop: 2 }}>{lr('pos.pago_simulado')} · {pago.metodo}</span>
                  {compIdCorto && (
                    <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                      {lr('pos.n_compensacion')} <span style={{ fontFamily: 'monospace' }}>{compIdCorto}</span>
                    </div>
                  )}
                </>
              : <>
                  <span className="badge badge-gray">{lr('pos.sin_cobro')}</span>
                  {compIdCorto && (
                    <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                      {lr('pos.registro')} <span style={{ fontFamily: 'monospace' }}>{compIdCorto}</span>
                    </div>
                  )}
                </>}
          </div>
          <div><span className="muted">{lr('pos.documentos')}</span><br /><b>{fmtInt(facturas.length)}</b></div>
          {embalaje && (
            <div style={{ gridColumn: '1 / -1' }}>
              <span className="muted">{lr('pos.embalaje_rep')}</span><br />
              <b>{fmt(embalaje.porcentaje, 1)}% {lr('pos.reciclabilidad')} · {lr('pos.nivel')} {embalaje.nivel}</b>
            </div>
          )}
        </div>
      </div>

      {f0 && (
        <>
          <img src={api.qrUrl(f0.id)} alt={`${lr('pos.qr_alt')} ${f0.numero_venta || f0.id}`}
            width={150} height={150}
            style={{ maxWidth: '100%', border: '1px solid var(--border)', borderRadius: 12, padding: 8, background: '#fff' }} />
          <div style={{ marginTop: 8 }}>
            <a href={`/verificar/${f0.id}${enIngles ? '?lang=en' : ''}`} target="_blank" rel="noreferrer" style={{ fontWeight: 700, fontSize: 14 }}>
              {lr('pos.verificar_traz')}
            </a>
          </div>
          {hashCorto && (
            <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
              {lr('pos.eslabon')} #{fmtInt(f0.eslabon)} · {lr('pos.hash')}{' '}
              <span style={{ fontFamily: 'monospace' }}>{hashCorto}</span>
            </div>
          )}

          {/* Sello compartible en miniatura, con el snippet para el sitio del
              cliente. Con el comprobante en inglés pide el sello con ?lang=en
              (si el backend aún no lo soporta, sirve el sello de siempre). */}
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <img
              src={`/api/sesiones/${sesion.id}/sello.svg${enIngles ? '?lang=en' : ''}`}
              alt={lr('pos.sello_alt')}
              width={260}
              style={{ maxWidth: '100%', height: 'auto' }}
            />
            <button type="button" className="btn btn-outline btn-sm" onClick={copiarSello}>
              {selloCopia === 'ok' ? lr('pos.copiado') : lr('pos.copiar_sello')}
            </button>
            {selloCopia === 'error' && (
              <span className="badge badge-red">{lr('pos.copia_error')}</span>
            )}
          </div>
        </>
      )}

      {cliente.email && (
        <div style={{ marginTop: 16 }}>
          <button className="btn btn-outline" style={{ width: '100%' }}
            onClick={enviarCorreo} disabled={envio === 'enviando' || envio === 'ok'}>
            {envio === 'enviando'
              ? <span className="spinner dark" />
              : envio === 'ok' ? lr('pos.enviado') : lr('pos.enviar_correo')}
          </button>
          {envio === 'ok' && (
            <div className="badge badge-green" style={{ display: 'inline-block', marginTop: 8 }}>
              {lr('pos.enviado_a')} {cliente.email}
            </div>
          )}
          {envio === 'error' && (
            <div className="badge badge-red" style={{ display: 'inline-block', marginTop: 8 }}>
              {lr('pos.envio_error')}
            </div>
          )}
        </div>
      )}

      <div className="two-col-grid" style={{ marginTop: 18 }}>
        <a className="btn btn-outline" href={api.informeUrl(sesion.id)} target="_blank" rel="noreferrer"
          style={{ display: 'inline-flex' }}>
          <Icon.Download size={16} /> {lr('pos.informe_pdf')}
        </a>
        <button className="btn btn-primary" onClick={onNuevo}>{lr('pos.nuevo_tramite')}</button>
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
              {data.embalaje && (
                <span className={`badge ${NIVEL_BADGE[data.embalaje.nivel] || 'badge-gray'}`} style={{ fontSize: 13, padding: '5px 12px' }}>
                  Embalaje REP: {data.embalaje.nivel} · {fmt(data.embalaje.porcentaje, 1)}%
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
