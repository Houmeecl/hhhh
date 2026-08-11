import { useEffect, useState } from 'react';
import { api, fmt, fmtFecha } from '../api.js';
import { Icon } from '../components/icons.jsx';
import Dropzone from '../components/Dropzone.jsx';

const PAISES = { CL: 'Chile', AR: 'Argentina', PY: 'Paraguay', BR: 'Brasil' };
const TIPOS = [
  { value: 'factura', label: 'Factura' },
  { value: 'energia', label: 'Energía' },
  { value: 'combustible', label: 'Combustible' },
  { value: 'guia', label: 'Guía de despacho' },
  { value: 'manifiesto', label: 'Manifiesto de carga' },
  { value: 'aduana', label: 'Declaración aduanera' },
  { value: 'mic_dta', label: 'MIC/DTA (tránsito ATIT)' },
  { value: 'contrato', label: 'Contrato' },
  { value: 'otro', label: 'Otro' },
];
// Nombre real del documento aduanero según el país cuya aduana interviene.
const ADUANA_PAIS = {
  CL: 'DIN / DUS (Aduana de Chile)',
  AR: 'Declaración SIM (Aduana Argentina)',
  PY: 'Despacho SOFIA (DNA Paraguay)',
  BR: 'DU-E / DI — Siscomex (Receita Federal Brasil)',
};

export default function Corredor() {
  const [tab, setTab] = useState('metodologias');
  const [toast, setToast] = useState(null);
  const flash = (msg, err = false) => { setToast({ msg, err }); setTimeout(() => setToast(null), 3500); };

  return (
    <div>
      <div className="admin-head">
        <div>
          <h1 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: 'var(--green-600)' }}><Icon.Target size={24} /></span> Corredor Bioceánico Capricornio
          </h1>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 14 }}>
            Brasil · Paraguay · Argentina · Chile — trazabilidad y contabilidad de carbono por tramo, con metodología por país.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        <button className={`btn btn-sm ${tab === 'metodologias' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('metodologias')}>Metodologías por país</button>
        <button className={`btn btn-sm ${tab === 'documentos' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('documentos')}>Documentos</button>
        <button className={`btn btn-sm ${tab === 'puntos' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('puntos')}>Puntos de control</button>
      </div>

      {tab === 'metodologias' && <Metodologias flash={flash} />}
      {tab === 'documentos' && <Documentos flash={flash} />}
      {tab === 'puntos' && <PuntosControl flash={flash} />}

      {toast && <div className={`toast ${toast.err ? 'err' : ''}`}>{toast.msg}</div>}
    </div>
  );
}

// Catálogo de puntos de control del corredor (tabla puntos_corredor,
// migración 093). Antes vivía hardcodeado: agregar un punto requería un
// deploy. El id (slug) es la identidad sellada en los eslabones y NO es
// editable; tampoco hay eliminar — un punto que sale de servicio se
// desactiva y su id queda reservado (los pasos históricos lo referencian).
const PUNTO_VACIO = { id: '', nombre: '', pais: 'CL', lat: '', lng: '', orden: '', es_frontera: false, activo: true };

function PuntosControl({ flash }) {
  const [items, setItems] = useState(null);
  const [modal, setModal] = useState(null); // {esNuevo, ...punto} | null
  const [guardando, setGuardando] = useState(false);

  const cargar = () => api.corredorPuntos().then((r) => setItems(r.puntos)).catch((e) => flash(e.message, true));
  useEffect(() => { cargar(); }, []);

  async function guardar() {
    setGuardando(true);
    try {
      const body = {
        ...modal,
        lat: parseFloat(modal.lat), lng: parseFloat(modal.lng), orden: parseInt(modal.orden, 10),
      };
      if (modal.esNuevo) await api.corredorCrearPunto(body);
      else await api.corredorEditarPunto(modal.id, body);
      setModal(null); cargar();
      flash('Punto guardado — aparece en el mapa, el selector del portador y los carteles QR sin deploy.');
    } catch (e) { flash(e.message, true); }
    finally { setGuardando(false); }
  }

  async function alternarActivo(p) {
    try {
      await api.corredorEditarPunto(p.id, { ...p, activo: !p.activo });
      cargar();
      flash(p.activo
        ? 'Punto desactivado — sale del catálogo pero su historial queda intacto.'
        : 'Punto reactivado.');
    } catch (e) { flash(e.message, true); }
  }

  return (
    <div className="card">
      <div style={{ padding: '14px 16px 0', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <b>Puntos de control del corredor</b>
        <span className="muted" style={{ fontSize: 13 }}>
          orden = posición a lo largo del corredor (0 = Campo Grande) · el id no se puede cambiar ni eliminar
        </span>
        <button className="btn btn-sm btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setModal({ ...PUNTO_VACIO, esNuevo: true })}>
          + Nuevo punto
        </button>
      </div>
      <div className="table-scroll">
        <table className="data">
          <thead><tr><th>Orden</th><th>Punto</th><th>País</th><th>Coordenadas</th><th>Frontera</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {(items || []).map((p) => (
              <tr key={p.id} style={p.activo ? {} : { opacity: 0.55 }}>
                <td>{p.orden}</td>
                <td><b>{p.nombre}</b><div className="muted mono" style={{ fontSize: 11 }}>{p.id}</div></td>
                <td>{PAISES[p.pais] || p.pais}</td>
                <td className="muted" style={{ fontSize: 12 }}>{fmt(p.lat, 4)}, {fmt(p.lng, 4)}</td>
                <td>{p.es_frontera ? <span className="badge badge-amber">Frontera</span> : <span className="muted">—</span>}</td>
                <td>{p.activo ? <span className="badge badge-green">Activo</span> : <span className="badge badge-gray">Inactivo</span>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => setModal({ ...p, esNuevo: false })}>Editar</button>{' '}
                  <button className="btn btn-ghost btn-sm" onClick={() => alternarActivo(p)}>{p.activo ? 'Desactivar' : 'Reactivar'}</button>
                </td>
              </tr>
            ))}
            {items && items.length === 0 && (
              <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 24 }}>Sin puntos — corre las migraciones para sembrar los 14 fundacionales.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {modal && (
        <div className="modal-bg" onClick={(e) => e.target.className === 'modal-bg' && setModal(null)}>
          <div className="modal">
            <h2 style={{ marginTop: 0 }}>{modal.esNuevo ? 'Nuevo punto de control' : `Editar — ${modal.nombre}`}</h2>
            {modal.esNuevo && (
              <div className="field"><label>Id (slug — no se podrá cambiar)</label>
                <input value={modal.id} placeholder="bascula-km-45"
                  onChange={(e) => setModal({ ...modal, id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} /></div>
            )}
            <div className="form-row" style={{ gridTemplateColumns: '2fr 1fr' }}>
              <div className="field"><label>Nombre</label>
                <input value={modal.nombre} onChange={(e) => setModal({ ...modal, nombre: e.target.value })} /></div>
              <div className="field"><label>País</label>
                <select value={modal.pais} onChange={(e) => setModal({ ...modal, pais: e.target.value })}>
                  {Object.entries(PAISES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select></div>
            </div>
            <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
              <div className="field"><label>Latitud</label>
                <input inputMode="decimal" value={modal.lat} placeholder="-23.2358" onChange={(e) => setModal({ ...modal, lat: e.target.value })} /></div>
              <div className="field"><label>Longitud</label>
                <input inputMode="decimal" value={modal.lng} placeholder="-67.0333" onChange={(e) => setModal({ ...modal, lng: e.target.value })} /></div>
              <div className="field"><label>Orden en el corredor</label>
                <input inputMode="numeric" value={modal.orden} placeholder="8" onChange={(e) => setModal({ ...modal, orden: e.target.value.replace(/\D/g, '') })} /></div>
            </div>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer', marginBottom: 14 }}>
              <input type="checkbox" checked={!!modal.es_frontera} onChange={(e) => setModal({ ...modal, es_frontera: e.target.checked })} />
              Es paso fronterizo (la torre puede dirigir camiones a él como "frontera")
            </label>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setModal(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={guardar} disabled={guardando}>
                {guardando ? <span className="spinner" /> : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Metodologias({ flash }) {
  const [items, setItems] = useState([]);
  const [edit, setEdit] = useState(null);

  const cargar = () => api.corredorMetodologias().then((r) => setItems(r.metodologias)).catch((e) => flash(e.message, true));
  useEffect(() => { cargar(); }, []);

  async function guardar() {
    try {
      const factores = {
        electricidad_kgco2e_kwh: parseFloat(edit.elec) || 0,
        diesel_kgco2e_l: parseFloat(edit.diesel) || 0,
      };
      await api.guardarMetodologia(edit.pais, {
        nombre: edit.nombre, factores, referencia: edit.referencia, fuente: edit.fuente,
        vigencia: edit.vigencia, notas: edit.notas,
      });
      setEdit(null); cargar(); flash('Metodología guardada.');
    } catch (e) { flash(e.message, true); }
  }
  async function toggle(m) {
    try { await api.guardarMetodologia(m.pais, { activo: !m.activo }); cargar(); flash(`${PAISES[m.pais]} ${!m.activo ? 'activado' : 'desactivado'}.`); }
    catch (e) { flash(e.message, true); }
  }

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
        {items.map((m) => (
          <div className="card card-pad" key={m.pais}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <b style={{ fontSize: 17 }}>{PAISES[m.pais]}</b>
              <span className={`badge ${m.activo ? 'badge-green' : 'badge-gray'}`}>{m.activo ? '● Activo' : '○ Inactivo'}</span>
            </div>
            <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{m.referencia}</div>
            <div className="table-scroll">
              <table className="data" style={{ marginTop: 12 }}>
                <tbody>
                  <tr><td className="muted">Electricidad</td><td className="num">{fmt(m.factores?.electricidad_kgco2e_kwh, 4)} kgCO2e/kWh</td></tr>
                  <tr><td className="muted">Diésel</td><td className="num">{fmt(m.factores?.diesel_kgco2e_l, 3)} kgCO2e/L</td></tr>
                </tbody>
              </table>
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Fuente: {m.fuente} · {m.vigencia}</div>
            {m.notas && <div className="muted" style={{ fontSize: 12, marginTop: 4, fontStyle: 'italic' }}>{m.notas}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn btn-outline btn-sm" onClick={() => setEdit({
                pais: m.pais, nombre: m.nombre, referencia: m.referencia, fuente: m.fuente, vigencia: m.vigencia, notas: m.notas || '',
                elec: m.factores?.electricidad_kgco2e_kwh ?? '', diesel: m.factores?.diesel_kgco2e_l ?? '',
              })}>Editar</button>
              <button className={`btn btn-sm ${m.activo ? 'btn-danger' : 'btn-primary'}`} onClick={() => toggle(m)}>
                {m.activo ? 'Desactivar' : 'Activar'}
              </button>
            </div>
          </div>
        ))}
      </div>
      <p className="muted" style={{ fontSize: 13, marginTop: 14 }}>
        Cada país aplica su propia metodología. Solo los países <b>activos</b> calculan CO2e; los inactivos guardan los documentos como traza hasta validar sus factores.
      </p>

      {edit && (
        <div className="modal-bg" onClick={(e) => e.target.className === 'modal-bg' && setEdit(null)}>
          <div className="modal">
            <h2 style={{ marginTop: 0 }}>Metodología · {PAISES[edit.pais]}</h2>
            <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="field"><label>Nombre</label><input value={edit.nombre || ''} onChange={(e) => setEdit({ ...edit, nombre: e.target.value })} /></div>
              <div className="field"><label>Referencia (marco/norma)</label><input value={edit.referencia || ''} onChange={(e) => setEdit({ ...edit, referencia: e.target.value })} /></div>
              <div className="field"><label>Electricidad (kgCO2e/kWh)</label><input value={edit.elec} onChange={(e) => setEdit({ ...edit, elec: e.target.value })} /></div>
              <div className="field"><label>Diésel (kgCO2e/L)</label><input value={edit.diesel} onChange={(e) => setEdit({ ...edit, diesel: e.target.value })} /></div>
              <div className="field"><label>Fuente</label><input value={edit.fuente || ''} onChange={(e) => setEdit({ ...edit, fuente: e.target.value })} /></div>
              <div className="field"><label>Vigencia</label><input value={edit.vigencia || ''} onChange={(e) => setEdit({ ...edit, vigencia: e.target.value })} /></div>
            </div>
            <div className="field" style={{ marginBottom: 14 }}><label>Notas</label><textarea rows={2} value={edit.notas} onChange={(e) => setEdit({ ...edit, notas: e.target.value })} /></div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-outline" onClick={() => setEdit(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={guardar}>Guardar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Documentos({ flash }) {
  const [docs, setDocs] = useState([]);
  const [form, setForm] = useState({ pais_origen: 'BR', pais_destino: 'CL', tramo: '', tipo_documento: 'factura', rut_emisor: '', rut_receptor: '', numero_documento: '' });
  const [file, setFile] = useState(null);
  const [subiendo, setSubiendo] = useState(false);

  const cargar = () => api.corredorDocumentos().then((r) => setDocs(r.documentos)).catch((e) => flash(e.message, true));
  useEffect(() => { cargar(); }, []);

  async function subir() {
    if (!file) { flash('Adjunta un documento (archivo o foto).', true); return; }
    setSubiendo(true);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v));
      fd.append('archivo', file);
      const { documento } = await api.subirDocumentoCorredor(fd);
      setFile(null);
      cargar();
      flash(documento.estado === 'procesado' ? `Procesado: ${fmt(documento.total_co2e, 3)} t CO2e` : documento.estado === 'pendiente_motor' ? 'Guardado (país inactivo: pendiente de motor).' : 'Guardado como traza documental.');
    } catch (e) { flash(e.message, true); } finally { setSubiendo(false); }
  }

  const badge = (e) => e === 'procesado' ? 'badge-green' : e === 'pendiente_motor' ? 'badge-amber' : 'badge-gray';

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 20, alignItems: 'start' }}>
      <div className="card card-pad">
        <h3 style={{ marginTop: 0 }}>Cargar documento</h3>
        <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr', margin: '0 0 12px' }}>
          <div className="field"><label>País origen</label>
            <select value={form.pais_origen} onChange={(e) => setForm({ ...form, pais_origen: e.target.value })}>{Object.entries(PAISES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </div>
          <div className="field"><label>País destino</label>
            <select value={form.pais_destino} onChange={(e) => setForm({ ...form, pais_destino: e.target.value })}>{Object.entries(PAISES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </div>
          <div className="field"><label>Tramo</label><input value={form.tramo} onChange={(e) => setForm({ ...form, tramo: e.target.value })} placeholder="Campo Grande → Antofagasta" /></div>
          <div className="field"><label>Tipo</label>
            <select value={form.tipo_documento} onChange={(e) => setForm({ ...form, tipo_documento: e.target.value })}>{TIPOS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select>
          </div>
          <div className="field"><label>N° documento</label><input value={form.numero_documento} onChange={(e) => setForm({ ...form, numero_documento: e.target.value })} placeholder="N° DIN / MIC-DTA / DU-E" /></div>
          <div className="field"><label>RUT emisor</label><input value={form.rut_emisor} onChange={(e) => setForm({ ...form, rut_emisor: e.target.value })} /></div>
          <div className="field"><label>RUT receptor</label><input value={form.rut_receptor} onChange={(e) => setForm({ ...form, rut_receptor: e.target.value })} /></div>
        </div>
        {form.tipo_documento === 'aduana' && (
          <div className="muted" style={{ fontSize: 12, margin: '0 0 10px' }}>
            Documento aduanero del país destino: <b>{ADUANA_PAIS[form.pais_destino]}</b>. Se guarda como traza documental del tránsito (sin cálculo de carbono).
          </div>
        )}
        {form.tipo_documento === 'mic_dta' && (
          <div className="muted" style={{ fontSize: 12, margin: '0 0 10px' }}>
            Manifiesto Internacional de Carga / Declaración de Tránsito Aduanero (Acuerdo ATIT). Traza el tránsito terrestre entre los cuatro países.
          </div>
        )}
        {/* Carga por archivo o cámara del teléfono. Mismo Dropzone que el
            resto de la plataforma: en móvil separa "Tomar foto" (cámara
            directa) de "Elegir archivos" — un solo input con capture= y
            accept mixto (.pdf) forzaba la cámara en Android y no dejaba
            elegir el PDF. Un documento por envío: se toma el primero. */}
        <Dropzone
          accept=".pdf,.xml,.jpg,.jpeg,.png"
          hint="Formatos permitidos: PDF, XML, JPG, PNG"
          onFiles={(list) => setFile(Array.from(list)[0] || null)}
        />
        {file && (
          <div className="file-item" style={{ marginTop: 8, marginBottom: 8 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}><Icon.Doc size={14} /> {file.name}</span>
            <span className="rm" onClick={() => setFile(null)}>Quitar</span>
          </div>
        )}
        <button className="btn btn-primary" style={{ width: '100%' }} onClick={subir} disabled={subiendo}>
          {subiendo ? <span className="spinner" /> : 'Cargar y trazar'}
        </button>
        <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
          Facturas, energía y combustible calculan CO2e con la metodología del país destino (si está activo). El resto se guarda como traza documental.
        </p>
      </div>

      <div className="card">
        <div className="table-scroll">
          <table className="data">
            <thead><tr><th>Fecha</th><th>Tramo</th><th>Tipo</th><th>Metodología</th><th>Estado</th><th className="num">t CO2e</th></tr></thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td className="muted" style={{ fontSize: 13 }}>{fmtFecha(d.created_at)}</td>
                  <td>{d.pais_origen} → {d.pais_destino}{d.tramo ? <div className="muted" style={{ fontSize: 12 }}>{d.tramo}</div> : null}</td>
                  <td>
                    <span className="badge badge-gray">{(TIPOS.find((t) => t.value === d.tipo_documento) || {}).label || d.tipo_documento}</span>
                    {d.numero_documento && <div className="muted" style={{ fontSize: 12 }}>N° {d.numero_documento}</div>}
                  </td>
                  <td>{d.metodologia_pais}</td>
                  <td><span className={`badge ${badge(d.estado)}`}>{d.estado}</span></td>
                  <td className="num">{d.estado === 'procesado' ? fmt(d.total_co2e, 3) : '—'}</td>
                </tr>
              ))}
              {docs.length === 0 && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 30 }}>Sin documentos cargados.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
