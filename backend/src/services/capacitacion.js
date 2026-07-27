import crypto from 'crypto';

// ============================================================
// Capacitación interna — helpers puros (sin BD). Calcula el puntaje
// de un intento de quiz y genera el serial/hash de una constancia.
// No se integra a la cadena de hash global (services/cadenaHash.js):
// esa cadena es para documentos de contabilidad de carbono/trazabilidad
// de origen, no para constancias de capacitación de personal interno.
// ============================================================

// Umbral de aprobación del quiz: 70% de las preguntas correctas.
export const NOTA_APROBACION = 0.7;

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Calcula el puntaje de un intento dado el banco de preguntas (con sus
// opciones, incluida cuál es correcta) y las respuestas del usuario
// ([{ pregunta_id, opcion_id }]). Puro y determinista — sin acceso a BD.
// Devuelve { puntaje_pct, aprobado, n_correctas, n_preguntas }.
// Preguntas sin respuesta, o con una opción que no le pertenece, cuentan
// como incorrectas (no se lanza error: un quiz a medio responder
// simplemente no aprueba).
export function calcularPuntaje(preguntas, respuestas) {
  const lista = Array.isArray(preguntas) ? preguntas : [];
  const mapaRespuestas = new Map(
    (Array.isArray(respuestas) ? respuestas : []).map((r) => [String(r?.pregunta_id), String(r?.opcion_id)])
  );

  let correctas = 0;
  for (const p of lista) {
    const opcionElegida = mapaRespuestas.get(String(p.id));
    if (!opcionElegida) continue;
    const opciones = Array.isArray(p.opciones) ? p.opciones : [];
    const esCorrecta = opciones.some((o) => String(o.id) === opcionElegida && o.correcta);
    if (esCorrecta) correctas += 1;
  }

  const total = lista.length;
  const puntaje_pct = total > 0 ? Math.round((correctas / total) * 1000) / 10 : 0;
  return {
    puntaje_pct,
    aprobado: total > 0 && correctas / total >= NOTA_APROBACION,
    n_correctas: correctas,
    n_preguntas: total,
  };
}

// Serial legible de constancia: CAP- + 6 hex mayúsculas (ej: CAP-3F0A9B).
// La unicidad la garantiza el UNIQUE de la tabla constancias; la ruta
// que la crea reintenta si colisiona (mismo patrón que generarSerial de
// services/posTerminal.js).
export function generarSerialConstancia() {
  return `CAP-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

// Hash determinista del contenido verificable de una constancia — solo
// para evidencia de que no se alteró después de emitida (no forma parte
// de ninguna cadena encadenada; es un sello propio, como
// hashDocumento en cadenaHash.js pero desacoplado de esa cadena).
export function hashConstancia({ serial, usuario_nombre, curso_titulo, puntaje_pct, emitida_at }) {
  const canonico = [
    serial || '', usuario_nombre || '', curso_titulo || '',
    Number(puntaje_pct || 0).toFixed(1), emitida_at ? new Date(emitida_at).toISOString() : '',
  ].join('|');
  return sha256(canonico);
}
