import { query } from '../lib/db.js';
import { PUNTOS_CORREDOR_IDS, PUNTOS_FRONTERA } from './pasaporteOrigen.js';

// ============================================================
// Catálogo de puntos del Corredor Bioceánico leído de la tabla
// puntos_corredor (migración 093), con dos protecciones:
//
//  - Cache in-memory con TTL de 60 s: el catálogo se consulta en cada
//    registro de paso y en cada carga de la torre; cambiar un punto de
//    control no es una operación de segundos, así que 60 s de desfase
//    son aceptables. El CRUD admin (routes/corredor.js) invalida el
//    cache del propio proceso al escribir; con pm2 en modo cluster otros
//    workers verían el cambio en ≤60 s — asumido y documentado.
//  - FALLBACK al catálogo estático (PUNTOS_CORREDOR_IDS/PUNTOS_FRONTERA
//    de pasaporteOrigen.js) si la query falla o la tabla está vacía
//    (entorno fresco donde la migración aún no corre): el corredor
//    nunca queda sin catálogo por un problema de BD.
// ============================================================

const TTL_MS = 60 * 1000;
let cache = { filas: null, leidoEn: 0 };

export function invalidarCacheCatalogo() {
  cache = { filas: null, leidoEn: 0 };
}

async function filas() {
  const ahora = Date.now();
  if (cache.filas && ahora - cache.leidoEn < TTL_MS) return cache.filas;
  try {
    const { rows } = await query(
      `SELECT id, nombre, pais, lat, lng, orden, es_frontera
         FROM puntos_corredor WHERE activo = true ORDER BY orden`
    );
    if (rows.length) {
      cache = { filas: rows, leidoEn: ahora };
      return rows;
    }
  } catch (e) {
    console.error('[catalogoCorredor] no se pudo leer la tabla (se usa el catálogo estático):', e.message);
  }
  return null; // el llamador cae al estático
}

// Puntos activos completos (para GET /api/corredor/puntos). null nunca:
// siempre hay catálogo (tabla o estático — el estático no tiene lat/lng
// acá en el backend, así que en fallback se devuelven solo los ids con
// nombre=id; el frontend en ese caso ya tiene su propio estático completo
// y no depende de esta respuesta).
export async function puntosCorredor() {
  const f = await filas();
  if (f) {
    return f.map((p) => ({
      id: p.id, nombre: p.nombre, pais: p.pais,
      lat: Number(p.lat), lng: Number(p.lng),
      orden: p.orden, es_frontera: p.es_frontera,
    }));
  }
  return PUNTOS_CORREDOR_IDS.map((id, i) => ({
    id, nombre: id, pais: null, lat: null, lng: null,
    orden: i, es_frontera: PUNTOS_FRONTERA.includes(id),
  }));
}

// Solo los ids (validación de punto_id declarado en origen.js).
export async function idsCorredor() {
  const f = await filas();
  return f ? f.map((p) => p.id) : PUNTOS_CORREDOR_IDS;
}

// Solo los pasos fronterizos (validarMensajeTorre en torre.js).
export async function fronterasCorredor() {
  const f = await filas();
  if (!f) return PUNTOS_FRONTERA;
  const fronteras = f.filter((p) => p.es_frontera).map((p) => p.id);
  return fronteras.length ? fronteras : PUNTOS_FRONTERA;
}
