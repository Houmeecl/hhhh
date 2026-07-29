import { useEffect, useState } from 'react';
import { api, fmtFecha } from '../api.js';

// Única pantalla del panel: lotes asignados a este proveedor, separados
// en "pendientes de firmar" (con un mini-formulario inline para confirmar
// la firma) y "ya firmadas" (solo lectura, colapsable). La identidad que
// firma la fija el backend con la sesión del proveedor logueado — nunca
// se manda desde acá.
export default function LotesPorFirmar() {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');
  const [firmando, setFirmando] = useState(null); // id de la asignación con el formulario abierto
  const [verFirmadas, setVerFirmadas] = useState(false);
  const [toast, setToast] = useState(null);
  const flash = (msg, err = false) => { setToast({ msg, err }); setTimeout(() => setToast(null), 3500); };

  const cargar = () => api.proveedorLotes().then(setDatos).catch((e) => setError(e.message));
  useEffect(() => { cargar(); }, []);

  async function firmar(asignacionId, body) {
    try {
      await api.proveedorFirmar(asignacionId, body);
      flash('Lote firmado.');
      setFirmando(null);
      cargar();
    } catch (e) {
      flash(e.message, true);
      throw e;
    }
  }

  if (error) return <div className="badge badge-red" role="alert" style={{ display: 'block', padding: 12 }}>{error}</div>;
  if (!datos) return <div style={{ padding: 40 }}><span className="spinner dark" /> Cargando lotes…</div>;

  const pendientes = datos.pendientes || [];
  const firmadas = datos.firmadas || [];

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Lotes por firmar</h1>
      <p className="muted" style={{ fontSize: 14 }}>
        Firma acá los lotes que sicr3p te asignó — la firma queda sellada en la cadena de custodia del lote,
        con tu identidad ya registrada (no es una firma electrónica con validez legal).
      </p>

      <div className="card" style={{ marginBottom: 24 }}>
        <div className="table-scroll">
          <table className="data">
            <thead><tr><th>Lote</th><th>Material</th><th>Asignado</th><th></th></tr></thead>
            <tbody>
              {pendientes.map((p) => (
                <FilaPendiente
                  key={p.id}
                  item={p}
                  abierto={firmando === p.id}
                  onAbrir={() => setFirmando(firmando === p.id ? null : p.id)}
                  onFirmar={(body) => firmar(p.id, body)}
                />
              ))}
              {pendientes.length === 0 && (
                <tr><td colSpan={4} className="muted" style={{ textAlign: 'center', padding: 30 }}>No tienes lotes pendientes de firmar.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <button className="btn btn-outline btn-sm" onClick={() => setVerFirmadas((v) => !v)}>
        {verFirmadas ? 'Ocultar' : 'Ver'} lotes ya firmados ({firmadas.length})
      </button>

      {verFirmadas && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="table-scroll">
            <table className="data">
              <thead><tr><th>Lote</th><th>Material</th><th>Firmado</th></tr></thead>
              <tbody>
                {firmadas.map((f) => (
                  <tr key={f.id}>
                    <td style={{ fontFamily: 'monospace' }}>{f.lote_codigo || f.codigo}</td>
                    <td>{f.material || '—'}</td>
                    <td>{f.firmado_at ? fmtFecha(f.firmado_at) : '—'}</td>
                  </tr>
                ))}
                {firmadas.length === 0 && (
                  <tr><td colSpan={3} className="muted" style={{ textAlign: 'center', padding: 30 }}>Todavía no firmaste ningún lote.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {toast && <div className={`toast ${toast.err ? 'err' : ''}`}>{toast.msg}</div>}
    </div>
  );
}

// Fila con mini-formulario inline (fecha/cantidad opcionales) que se abre
// al hacer clic en "Firmar" — sin salir de la tabla.
function FilaPendiente({ item, abierto, onAbrir, onFirmar }) {
  const [fecha, setFecha] = useState('');
  const [cantidad, setCantidad] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function submit() {
    setEnviando(true);
    try {
      await onFirmar({
        ...(fecha ? { fecha } : {}),
        ...(cantidad ? { cantidad: Number(cantidad) } : {}),
      });
    } catch {
      // El toast de error ya lo muestra el padre; solo evita romper el formulario.
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <tr>
        <td style={{ fontFamily: 'monospace' }}>{item.lote_codigo || item.codigo}</td>
        <td>{item.material || '—'}</td>
        <td className="muted" style={{ fontSize: 13 }}>{item.created_at ? fmtFecha(item.created_at) : '—'}</td>
        <td><button className="btn btn-primary btn-sm" onClick={onAbrir}>{abierto ? 'Cerrar' : 'Firmar'}</button></td>
      </tr>
      {abierto && (
        <tr>
          <td colSpan={4} style={{ background: 'var(--bg)' }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', padding: '10px 4px' }}>
              <div className="field" style={{ margin: 0 }}>
                <label>Fecha (opcional)</label>
                <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>Cantidad (opcional)</label>
                <input value={cantidad} onChange={(e) => setCantidad(e.target.value.replace(/[^\d.]/g, ''))} placeholder="0" />
              </div>
              <button className="btn btn-primary btn-sm" onClick={submit} disabled={enviando}>
                {enviando ? <span className="spinner" /> : 'Confirmar firma'}
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
