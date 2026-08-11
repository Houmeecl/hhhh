import { useEffect, useState } from 'react';
import { api, fmt, fmtInt, fmtFecha } from '../api.js';
import { Icon } from '../components/icons.jsx';
import { Donut } from '../components/Charts.jsx';
import Dropzone from '../components/Dropzone.jsx';

// ============================================================
// Transporte de personal (GHG Protocol Categoría 7) desde el panel de
// la empresa — mismo cálculo y mismos modos/factores que ya usa el
// admin (routes/transporte.js, calcularCo2eViaje), acá scopeado a la
// propia empresa, con evidencia OPCIONAL adjunta (el dato central es
// el km declarado, no el documento — a diferencia de Ley REP, donde la
// factura sí es obligatoria).
// ============================================================

function periodoActual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function Transporte() {
  const [viajes, setViajes] = useState(null);
  const [resumen, setResumen] = useState(null);
  const [modos, setModos] = useState([]);
  const [toast, setToast] = useState(null);
  const flash = (msg, err = false) => { setToast({ msg, err }); setTimeout(() => setToast(null), 4000); };

  const cargar = () => Promise.all([api.proveedorTransporteViajes(), api.proveedorTransporteModos()])
    .then(([v, m]) => { setViajes(v.viajes); setResumen(v.resumen); setModos(m.modos); });

  useEffect(() => { cargar().catch((e) => flash(e.message, true)); }, []);

  if (!viajes) return <div style={{ padding: 40 }}><span className="spinner dark" /> Cargando…</div>;

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Transporte de personal</h1>
      <p className="muted" style={{ fontSize: 14, maxWidth: 760 }}>
        Alcance 3 · Categoría 7 (GHG Protocol). Registra los traslados de tu personal — bus, camioneta,
        auto, tren o avión — con la distancia recorrida: sicr3p calcula el CO2e con los factores por modo.
        Adjuntar el comprobante (boleta, peaje) es opcional.
      </p>

      <ResumenTransporte resumen={resumen} flash={flash} />
      <RegistrarViaje modos={modos} alRegistrar={() => cargar().catch(() => {})} flash={flash} />
      <Viajes viajes={viajes} recargar={() => cargar().catch(() => {})} flash={flash} />

      {toast && <div className={`toast ${toast.err ? 'err' : ''}`}>{toast.msg}</div>}
    </div>
  );
}

// ---------- Resumen: CO2e por modo + informe mensual ----------
function ResumenTransporte({ resumen, flash }) {
  const [periodo, setPeriodo] = useState(periodoActual());
  const [generando, setGenerando] = useState(false);

  async function generarInforme() {
    setGenerando(true);
    try { await api.descargarProveedorTransporteInformePdf(periodo); }
    catch (e) { flash(e.message, true); }
    finally { setGenerando(false); }
  }

  if (!resumen || resumen.total.n_viajes === 0) {
    return (
      <div className="card card-pad" style={{ marginBottom: 20 }}>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Aún no registras traslados. Parte por el formulario de abajo.
        </p>
      </div>
    );
  }

  const donutData = resumen.por_modo.map((m) => ({ label: m.nombre, value: m.co2e }));

  return (
    <div className="card card-pad" style={{ marginBottom: 20 }}>
      <h3 style={{ marginTop: 0 }}>Traslados registrados</h3>
      <div className="stat-grid" style={{ marginBottom: 14 }}>
        <div className="stat"><div className="n green">{fmt(resumen.total.co2e, 3)} t CO2e</div><div className="l">Total emitido</div></div>
        <div className="stat"><div className="n">{fmt(resumen.total.km, 0)} km</div><div className="l">Distancia total</div></div>
        <div className="stat"><div className="n">{fmtInt(resumen.total.n_viajes)}</div><div className="l">Traslados</div></div>
      </div>
      {donutData.length > 0 && <Donut data={donutData} unit="t CO2e" />}

      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 18, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
        <div className="field" style={{ margin: 0 }}>
          <label>Período del informe</label>
          <input type="month" value={periodo} onChange={(e) => setPeriodo(e.target.value)} />
        </div>
        <button className="btn btn-outline" onClick={generarInforme} disabled={generando}>
          {generando ? <span className="spinner" /> : <><Icon.Download size={16} /> Generar informe del mes</>}
        </button>
      </div>
    </div>
  );
}

// ---------- Registrar un traslado ----------
const VIAJE_VACIO = { modo: 'bus', fecha: '', origen: '', destino: '', km: '', pasajeros: '1', ida_vuelta: true, notas: '' };

function RegistrarViaje({ modos, alRegistrar, flash }) {
  const [form, setForm] = useState({ ...VIAJE_VACIO });
  const [archivo, setArchivo] = useState(null);
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    if (!form.origen || !form.destino || !form.km) { flash('Origen, destino y km son obligatorios.', true); return; }
    setGuardando(true);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v));
      if (archivo) fd.append('archivo', archivo);
      const { viaje } = await api.proveedorTransporteCrearViaje(fd);
      setForm({ ...VIAJE_VACIO });
      setArchivo(null);
      alRegistrar();
      flash(`Traslado registrado: ${fmt(viaje.co2e, 3)} t CO2e.`);
    } catch (e) { flash(e.message, true); }
    finally { setGuardando(false); }
  }

  return (
    <div className="card card-pad" style={{ marginBottom: 20 }}>
      <h3 style={{ marginTop: 0 }}>Registrar traslado</h3>
      <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr', margin: '0 0 12px' }}>
        <div className="field"><label>Modo</label>
          <select value={form.modo} onChange={(e) => setForm({ ...form, modo: e.target.value })}>
            {modos.map((m) => <option key={m.codigo} value={m.codigo}>{m.nombre}</option>)}
          </select>
        </div>
        <div className="field"><label>Fecha</label><input type="date" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} /></div>
        <div className="field"><label>Origen</label><input value={form.origen} onChange={(e) => setForm({ ...form, origen: e.target.value })} placeholder="Antofagasta" /></div>
        <div className="field"><label>Destino</label><input value={form.destino} onChange={(e) => setForm({ ...form, destino: e.target.value })} placeholder="Faena / Calama" /></div>
        <div className="field"><label>Km (por tramo)</label><input value={form.km} onChange={(e) => setForm({ ...form, km: e.target.value.replace(/[^\d.,]/g, '').replace(',', '.') })} placeholder="200" /></div>
        <div className="field"><label>Pasajeros</label><input value={form.pasajeros} onChange={(e) => setForm({ ...form, pasajeros: e.target.value.replace(/\D/g, '') })} /></div>
        <div className="field" style={{ display: 'flex', alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 500, marginBottom: 8 }}>
            <input type="checkbox" checked={form.ida_vuelta} onChange={(e) => setForm({ ...form, ida_vuelta: e.target.checked })} style={{ width: 'auto' }} /> Ida y vuelta
          </label>
        </div>
      </div>

      <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>Comprobante (opcional):</div>
      <Dropzone
        accept=".pdf,.xml,.jpg,.jpeg,.png,.heic"
        hint="Boleta de pasaje, peaje, u otro respaldo — PDF, XML o foto (JPG, PNG, HEIC)"
        onFiles={(list) => setArchivo(Array.from(list)[0] || null)}
      />
      {archivo && (
        <div className="file-item" style={{ marginTop: 8 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}><Icon.Doc size={14} /> {archivo.name}</span>
          <span className="rm" onClick={() => setArchivo(null)}>Quitar</span>
        </div>
      )}

      <button className="btn btn-primary" style={{ width: '100%', marginTop: 14 }} onClick={guardar} disabled={guardando || !form.origen || !form.destino || !form.km}>
        {guardando ? <span className="spinner" /> : 'Calcular y registrar'}
      </button>
    </div>
  );
}

// ---------- Historial de traslados propios ----------
function Viajes({ viajes, recargar, flash }) {
  if (viajes.length === 0) return null;

  async function eliminar(v) {
    if (!window.confirm(`¿Eliminar el traslado ${v.origen} → ${v.destino}?`)) return;
    try { await api.proveedorTransporteEliminarViaje(v.id); recargar(); flash('Traslado eliminado.'); }
    catch (e) { flash(e.message, true); }
  }

  return (
    <div className="card">
      <div className="table-scroll">
        <table className="data">
          <thead><tr><th>Fecha</th><th>Trayecto</th><th>Modo</th><th className="num">Km</th><th className="num">Pax</th><th className="num">t CO2e</th><th>Evidencia</th><th></th></tr></thead>
          <tbody>
            {viajes.map((v) => (
              <tr key={v.id}>
                <td className="muted" style={{ fontSize: 13 }}>{fmtFecha(v.fecha)}</td>
                <td><b>{v.origen} → {v.destino}</b>{v.ida_vuelta && <span className="muted" style={{ fontSize: 12 }}> · ida y vuelta</span>}</td>
                <td><span className="badge badge-gray">{v.modo_nombre}</span></td>
                <td className="num">{fmt(v.km, 0)}</td>
                <td className="num">{v.pasajeros}</td>
                <td className="num"><b>{fmt(v.co2e, 3)}</b></td>
                <td>
                  {v.archivo_nombre ? (
                    <button className="btn btn-outline btn-sm"
                      onClick={() => api.proveedorTransporteDescargarEvidencia(v.id, v.archivo_nombre).catch((e) => flash(e.message, true))}>
                      Descargar
                    </button>
                  ) : <span className="muted" style={{ fontSize: 12 }}>—</span>}
                </td>
                <td><button className="btn btn-outline btn-sm" onClick={() => eliminar(v)}>Eliminar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
