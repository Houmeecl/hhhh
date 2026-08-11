import { useRef, useState } from 'react';
import { comprimirImagen } from '../lib/imagen.js';

// ============================================================
// "Estimar con foto" — el mismo mecanismo de visión del juego Sube y
// Suma aplicado a la declaración REP: en vez de tipear el embalaje al
// ojo, la persona fotografía el producto y la IA PROPONE los componentes
// (material/peso/cantidad en la taxonomía REP). La propuesta solo
// precarga el formulario: la persona la revisa y ajusta, y el servidor
// recalcula todo al guardar. La foto se analiza en memoria en el
// servidor y se descarta (nunca se guarda).
//
// `estimar`: async (file) => { componentes } — la API del panel que
// corresponda (posEstimarEmbalaje | repEstimarEmbalaje). `onResultado`:
// recibe los componentes propuestos ya como strings editables.
// ============================================================
export default function EstimarEmbalajeFoto({ estimar, onResultado }) {
  const inputRef = useRef(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [listo, setListo] = useState(false);

  async function procesar(file) {
    if (!file) return;
    setError('');
    setListo(false);
    setCargando(true);
    try {
      const comprimida = await comprimirImagen(file, 'embalaje.jpg');
      const { componentes } = await estimar(comprimida);
      onResultado(componentes.map((c) => ({
        material: c.material,
        peso_gr: String(c.peso_gr),
        cantidad: String(c.cantidad),
        reciclable: !!c.reciclable,
      })));
      setListo(true);
    } catch (e) {
      setError(e.message || 'No se pudo estimar con la foto — ingresa los componentes a mano.');
    } finally {
      setCargando(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div style={{ marginBottom: 10 }}>
      <input
        ref={inputRef} type="file" accept="image/*" capture="environment"
        style={{ display: 'none' }}
        onChange={(e) => procesar(e.target.files?.[0])}
      />
      <button type="button" className="btn btn-outline btn-sm" disabled={cargando}
        onClick={() => inputRef.current?.click()}>
        {cargando ? <span className="spinner dark" /> : '📷 Estimar con una foto del producto'}
      </button>
      {listo && (
        <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
          ✓ Componentes propuestos por la foto — <b>estimación referencial</b>: revisa los pesos y ajusta lo que no calce antes de guardar.
        </p>
      )}
      {error && (
        <p style={{ fontSize: 12, margin: '6px 0 0', color: '#b45309' }}>{error}</p>
      )}
    </div>
  );
}
