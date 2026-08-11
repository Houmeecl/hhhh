import { useEffect, useState } from 'react';
import { setCatalogo, suscribirCatalogo } from './corredor.js';

// ============================================================
// Carga el catálogo VIVO de puntos del corredor (tabla puntos_corredor,
// migración 093) y lo inyecta en lib/corredor.js con setCatalogo().
//
// - El fetch se hace UNA vez por carga de la app (promesa cacheada a
//   nivel de módulo): todas las páginas comparten el resultado.
// - Si falla (sin red, backend caído, tabla vacía), SILENCIO TOTAL:
//   queda el catálogo estático de corredor.js y todo se ve como siempre
//   — el flujo QR del chofer en un paso fronterizo sin señal no puede
//   depender de esta llamada.
// - Devuelve `version`: un contador que cambia cuando el catálogo cambió,
//   para usarlo como dependencia de effects/useMemo que capturan el
//   catálogo (ej. la polilínea de Leaflet) — los arrays se mutan in
//   place, así que la referencia sola no dispara re-renders.
// ============================================================

let promesa = null;

function cargarUnaVez() {
  if (!promesa) {
    promesa = fetch('/api/corredor/puntos')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.puntos) setCatalogo(d.puntos); })
      .catch(() => { /* fallback estático — a propósito sin log ni aviso */ });
  }
  return promesa;
}

export function useCatalogoCorredor() {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const off = suscribirCatalogo(() => setVersion((v) => v + 1));
    cargarUnaVez();
    return off;
  }, []);
  return version;
}
