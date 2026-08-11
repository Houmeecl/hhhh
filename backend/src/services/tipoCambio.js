// ============================================================
// Dólar automático — actualiza config_pos.tipo_cambio_usd_clp con el
// dólar observado del Banco Central de Chile, publicado por la API
// pública de mindicador.cl (sin credenciales).
//
// Reglas:
//  - Solo actúa si el admin activó tipo_cambio_auto (opt-in, migración 020).
//  - El valor lo escribe el SERVIDOR y pasa por validarTipoCambio: el
//    mismo tope ($5.000/USD) que rige el modo manual.
//  - Ante cualquier fallo (red caída, API cambiada, valor absurdo) se
//    CONSERVA el último dólar guardado: la plataforma nunca pierde el
//    tipo de cambio por una caída de la fuente.
// ============================================================
import { query as dbQuery } from '../lib/db.js';
import { validarTipoCambio } from './compensacion.js';

export const URL_DOLAR = 'https://mindicador.cl/api/dolar';
export const INTERVALO_MS = 6 * 60 * 60 * 1000; // 6 horas
const TIMEOUT_MS = 10_000;

// Obtiene el último dólar observado. `fetcher` es inyectable para tests.
// Lanza si la respuesta no es usable (el llamador decide qué hacer).
export async function obtenerDolarObservado(fetcher = fetch) {
  const res = await fetcher(URL_DOLAR, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`mindicador.cl respondió HTTP ${res.status}`);
  const data = await res.json();
  // La serie viene ordenada del día más reciente al más antiguo.
  const punto = Array.isArray(data?.serie) ? data.serie[0] : null;
  const val = validarTipoCambio(punto?.valor);
  if (!val.ok || val.tipo_cambio == null) {
    throw new Error('mindicador.cl no entregó un dólar observado válido');
  }
  const fecha = typeof punto.fecha === 'string' ? punto.fecha.slice(0, 10) : null;
  return { valor: val.tipo_cambio, fecha };
}

// Si el modo auto está activo, trae el dólar y lo guarda. Nunca lanza por
// fallas de red/fuente: devuelve { actualizado, motivo } y deja el valor
// anterior intacto. `query`/`fetcher` inyectables para tests sin BD.
export async function actualizarDolar({ fetcher = fetch, query = dbQuery } = {}) {
  const { rows } = await query(`SELECT tipo_cambio_auto FROM config_pos WHERE id = 1`);
  if (rows[0]?.tipo_cambio_auto !== true) return { actualizado: false, motivo: 'modo_manual' };
  try {
    const { valor, fecha } = await obtenerDolarObservado(fetcher);
    const fuente = `Dólar observado BCCh (mindicador.cl)${fecha ? ` ${fecha}` : ''}`;
    await query(
      `UPDATE config_pos
       SET tipo_cambio_usd_clp = $1, tipo_cambio_fuente = $2, tipo_cambio_actualizado = now()
       WHERE id = 1`,
      [valor, fuente]
    );
    return { actualizado: true, valor, fuente };
  } catch (e) {
    console.error(`[tipo-cambio] no se pudo actualizar el dólar: ${e.message} — se mantiene el valor anterior`);
    return { actualizado: false, motivo: e.message };
  }
}

// Arranque del ciclo: un intento inmediato (sin bloquear el arranque del
// servidor) y luego cada INTERVALO_MS. Idempotente; unref() para no
// impedir que el proceso termine.
let timer = null;
export function iniciarDolarAutomatico() {
  if (timer) return timer;
  timer = setInterval(() => { actualizarDolar().catch(() => {}); }, INTERVALO_MS);
  timer.unref?.();
  actualizarDolar().catch(() => {});
  return timer;
}
