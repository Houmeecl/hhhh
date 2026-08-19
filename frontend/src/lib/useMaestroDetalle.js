import { useState } from 'react';

// Patrón repetido en los paneles de solo-lectura (Puerto, Mandante, Agencia,
// Trazador): una lista maestra a la izquierda y, al elegir una fila, su
// detalle bajo demanda a la derecha. Centraliza el estado de
// selección/carga/error para no reescribir el mismo try/catch/finally en
// cada pantalla — simplifica el archivo de cada panel sin tocar la UI ni
// las llamadas a la API existentes.
export function useMaestroDetalle(cargarDetalle) {
  const [seleccionado, setSeleccionado] = useState(null);
  const [detalle, setDetalle] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');

  async function abrir(clave) {
    setSeleccionado(clave);
    setDetalle(null);
    setError('');
    setCargando(true);
    try {
      setDetalle(await cargarDetalle(clave));
    } catch (e) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }

  return { seleccionado, detalle, cargando, error, abrir };
}
