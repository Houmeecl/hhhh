import { useEffect, useMemo, useState } from 'react';
import { api, fmtFecha } from '../api.js';

// ============================================================
// Activos del piloto: alta y emisión de adhesivos.
//
// LA PATENTE SE VE ACÁ Y NO EN LA WEB PÚBLICA. Es una pantalla detrás de
// su propia sección; sin patente la lista es inservible para quien tiene
// que reconocer cuál camioneta es cuál antes de pegar el adhesivo. La
// respuesta de `GET /api/activo/:codigo` sigue sin traerla — ver
// services/activo.js, activoPublico vs activoParaImpresion.
//
// EL ESTADO DEL ADHESIVO NO SE MUESTRA EN ESTA TABLA. Tentaba mostrarlo,
// pero se calcula recorriendo los expedientes del par (proveedor,
// contrato) y esta lista trae decenas de filas: o se hacía una consulta
// por fila, o se guardaba una copia que se desincroniza. El estado se ve
// donde vive, al abrir el adhesivo o al escanear el QR.
// ============================================================

const TIPOS = [
  ['vehiculo', 'Vehículo'],
  ['maquinaria', 'Maquinaria'],
  ['equipo', 'Equipo'],
  ['otro', 'Otro'],
];
const NOMBRE_TIPO = Object.fromEntries(TIPOS);

const VACIO = {
  proveedor_id: '', nombre: '', tipo: 'vehiculo', contrato: '',
  identificador_interno: '', periodo_desde: '', periodo_hasta: '',
};

export default function Activos({ rol }) {
  const [lista, setLista] = useState([]);
  const [proveedores, setProveedores] = useState([]);
  const [form, setForm] = useState(null);
  const [marcados, setMarcados] = useState(() => new Set());
  const [msg, setMsg] = useState(null);
  const esAdmin = rol === 'admin';

  const cargar = () => {
    api.activos().then((r) => setLista(r.activos)).catch((e) => flash(e.message, true));
    api.activosProveedores().then((r) => setProveedores(r.proveedores)).catch(() => {});
  };
  useEffect(() => { cargar(); }, []);
  function flash(t, malo = false) { setMsg({ t, malo }); setTimeout(() => setMsg(null), 6000); }

  // Solo los vigentes se pueden imprimir: un activo dado de baja ya no
  // tiene página pública, así que su adhesivo abriría un 404.
  const vigentes = useMemo(() => lista.filter((a) => a.activo), [lista]);

  function alternar(codigo) {
    setMarcados((prev) => {
      const s = new Set(prev);
      if (s.has(codigo)) s.delete(codigo); else s.add(codigo);
      return s;
    });
  }
  const todosMarcados = vigentes.length > 0 && vigentes.every((a) => marcados.has(a.codigo));
  const marcarTodos = () => setMarcados(todosMarcados ? new Set() : new Set(vigentes.map((a) => a.codigo)));

  async function guardar() {
    try {
      const r = await api.crearActivo(form);
      setForm(null); cargar();
      flash(`Activo creado con código ${r.activo.codigo}.`);
    } catch (e) { flash(e.message, true); }
  }

  async function darDeBaja(a) {
    // Se avisa que el QR queda muerto: el adhesivo sigue pegado en la
    // camioneta y alguien lo va a escanear.
    const ok = window.confirm(
      `¿Dar de baja «${a.nombre}»?\n\nEl adhesivo ya impreso deja de funcionar: `
      + 'quien escanee su QR va a ver que el activo no existe.'
    );
    if (!ok) return;
    try { await api.darDeBajaActivo(a.id); cargar(); flash('Activo dado de baja.'); }
    catch (e) { flash(e.message, true); }
  }

  async function imprimirTanda() {
    const pedidos = marcados.size;
    try {
      const { omitidos } = await api.descargarAdhesivos([...marcados]);
      // Los omitidos se dicen. Nunca se entrega una tanda incompleta en
      // silencio: así es como el piloto sale a terreno con dos camionetas
      // sin adhesivo y nadie se entera hasta que están allá.
      if (omitidos.length) flash(`Se emitieron ${pedidos - omitidos.length} de ${pedidos}. No salieron: ${omitidos.join(', ')}.`, true);
      else flash(`${pedidos} adhesivo(s) en el ZIP.`);
    } catch (e) { flash(e.message, true); }
  }

  return (
    <div>
      <div className="admin-head">
        <h1>Activos y adhesivos</h1>
        {esAdmin && (
          <button className="btn btn-primary" onClick={() => setForm({ ...VACIO })}>+ Nuevo activo</button>
        )}
      </div>

      <p className="muted" style={{ maxWidth: 640, marginTop: 0 }}>
        Cada activo del piloto lleva un adhesivo con QR. El color del adhesivo sale de los
        expedientes de su contrato: no se escribe a mano y no se puede forzar desde acá.
      </p>

      {msg && <div className={`alert ${msg.malo ? 'alert-error' : 'alert-ok'}`} style={{ marginBottom: 16 }}>{msg.t}</div>}

      {marcados.size > 0 && (
        <div className="card" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <b>{marcados.size} seleccionado(s)</b>
          <button className="btn btn-primary btn-sm" onClick={imprimirTanda}>Descargar adhesivos (ZIP)</button>
          <button className="btn btn-outline btn-sm" onClick={() => setMarcados(new Set())}>Limpiar</button>
        </div>
      )}

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th style={{ width: 34 }}>
                <input type="checkbox" checked={todosMarcados} onChange={marcarTodos}
                  aria-label="Seleccionar todos los activos vigentes" />
              </th>
              <th>Empresa</th>
              <th>Activo</th>
              <th>Patente</th>
              <th>Contrato</th>
              <th>Período</th>
              <th>Código</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lista.map((a) => (
              <tr key={a.id} style={a.activo ? undefined : { opacity: 0.5 }}>
                <td>
                  {a.activo && (
                    <input type="checkbox" checked={marcados.has(a.codigo)}
                      onChange={() => alternar(a.codigo)}
                      aria-label={`Seleccionar ${a.nombre}`} />
                  )}
                </td>
                <td>
                  {a.nombre_empresa}
                  <div className="muted" style={{ fontSize: 12 }}>{a.rut}</div>
                </td>
                <td>
                  {a.nombre}
                  <div className="muted" style={{ fontSize: 12 }}>{NOMBRE_TIPO[a.tipo] || a.tipo}</div>
                </td>
                <td>{a.identificador_interno ? <code>{a.identificador_interno}</code> : <span className="muted">—</span>}</td>
                <td>{a.contrato || <span className="muted">sin contrato</span>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {a.periodo_desde && a.periodo_hasta
                    ? `${fmtFecha(a.periodo_desde)} a ${fmtFecha(a.periodo_hasta)}`
                    : <span className="muted">no declarado</span>}
                </td>
                <td><code style={{ fontSize: 11 }}>{a.codigo}</code></td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {a.activo ? (
                    <>
                      <button className="btn btn-outline btn-sm" onClick={() => api.abrirAdhesivo(a.codigo)}>Ver adhesivo</button>
                      {esAdmin && (
                        <button className="btn btn-outline btn-sm" style={{ marginLeft: 8 }} onClick={() => darDeBaja(a)}>Baja</button>
                      )}
                    </>
                  ) : <span className="muted">de baja</span>}
                </td>
              </tr>
            ))}
            {!lista.length && (
              <tr><td colSpan={8} className="muted" style={{ padding: 24, textAlign: 'center' }}>
                Todavía no hay activos en el piloto.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {form && (
        <div className="modal-bg" onClick={(e) => e.target.className === 'modal-bg' && setForm(null)}>
          <div className="modal">
            <h2 style={{ marginTop: 0 }}>Nuevo activo</h2>

            <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="field" style={{ gridColumn: '1 / -1' }}>
                <label>Empresa</label>
                <select value={form.proveedor_id} onChange={(e) => setForm({ ...form, proveedor_id: e.target.value })}>
                  <option value="">Seleccione…</option>
                  {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre_empresa} · {p.rut}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Nombre del activo</label>
                <input value={form.nombre} placeholder="Camioneta 4x4"
                  onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
              </div>
              <div className="field">
                <label>Tipo</label>
                <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
                  {TIPOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                </select>
              </div>
              <div className="field" style={{ gridColumn: '1 / -1' }}>
                <label>Patente o identificador de flota <span className="muted">(opcional)</span></label>
                <input value={form.identificador_interno} placeholder="KXPR-42"
                  onChange={(e) => setForm({ ...form, identificador_interno: e.target.value })} />
                <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                  Se imprime en el adhesivo para reconocer el móvil en terreno. No sale por la
                  página pública del QR.
                </div>
              </div>
              <div className="field" style={{ gridColumn: '1 / -1' }}>
                <label>Contrato <span className="muted">(debe calzar con el del expediente)</span></label>
                <input value={form.contrato} placeholder="Contrato A"
                  onChange={(e) => setForm({ ...form, contrato: e.target.value })} />
                <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                  Sin contrato el adhesivo sale en gris: no hay expedientes contra los cuales
                  comparar.
                </div>
              </div>
              <div className="field">
                <label>Período desde</label>
                <input type="date" value={form.periodo_desde}
                  onChange={(e) => setForm({ ...form, periodo_desde: e.target.value })} />
              </div>
              <div className="field">
                <label>Período hasta</label>
                <input type="date" value={form.periodo_hasta}
                  onChange={(e) => setForm({ ...form, periodo_hasta: e.target.value })} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-outline" onClick={() => setForm(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={guardar}>Crear</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
