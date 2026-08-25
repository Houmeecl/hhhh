// ============================================================
// Programa SICR3P Norte 2026-2030 — lógica pura de la portada.
//
// LA REGLA. La propuesta de patrocinio la escribe así:
//
//   «Sólo se presentarán como integrantes confirmados quienes hayan
//    aceptado formalmente participar.»
//
// No es una preferencia de diseño: es una promesa hecha a quien todavía
// está decidiendo. Una empresa que aparece como patrocinadora antes de
// firmar queda expuesta a que le pregunten por algo que no aceptó, y el
// programa queda exhibiendo un respaldo que no tiene.
//
// Por eso `participantesPublicos()` filtra por aceptación y por vigencia,
// y `soloDatosPublicos()` recorta a lo mínimo: el nombre. Ni RUT, ni
// correo, ni teléfono — no hacen falta para mostrar quién acompaña, y
// publicarlos filtraría por la portada lo que el resto del sistema
// protege.
//
// Todo acá es puro: recibe filas y devuelve filas. Las consultas viven en
// las rutas.
// ============================================================

// Lo ÚNICO que sale a la calle de cada participante.
//
// Se construye por lista blanca y no por descarte. Con `delete fila.rut`
// bastaría con que mañana alguien agregue una columna al SELECT para que
// se publique sola; así, lo que no está nombrado acá no sale nunca.
export function soloDatosPublicos(fila = {}) {
  return {
    nombre: String(fila.nombre_empresa || fila.nombre || '').trim(),
    rol: fila.rol || null,
  };
}

// ¿Está vigente hoy? Un patrocinio con fecha de término pasada dejó de
// serlo, y seguir mostrándolo es afirmar un vínculo que ya no existe.
//
// Sin fechas se considera vigente: es el caso normal de un auspicio que no
// declaró plazo, y tratarlo como vencido lo borraría de la página sin que
// nadie lo haya decidido.
export function vigente(fila = {}, ahora = new Date()) {
  const t = ahora instanceof Date ? ahora.getTime() : Number(ahora);
  if (!Number.isFinite(t)) return false;
  const desde = fila.fecha_inicio ? new Date(fila.fecha_inicio).getTime() : null;
  const hasta = fila.fecha_fin ? new Date(fila.fecha_fin).getTime() : null;
  if (Number.isFinite(desde) && t < desde) return false;
  if (Number.isFinite(hasta) && t > hasta) return false;
  return true;
}

// Los que se pueden mostrar. `activo` es la baja manual; las fechas son la
// vigencia declarada; el nombre vacío descarta la fila porque una tarjeta
// sin nombre no comunica nada.
export function participantesPublicos(filas = [], ahora = new Date()) {
  return filas
    .filter((f) => f && f.activo !== false && vigente(f, ahora))
    .map((f) => soloDatosPublicos(f))
    .filter((p) => p.nombre.length > 0);
}

// ---------- Cupos de formación ----------

// Estado de los cupos, para que la página no tenga que calcularlo ni
// adivinarlo.
//
// `cupo` en null significa sin límite declarado: NO se inventa uno. En ese
// caso `quedan` es null —gris, no cero— y el formulario sigue abierto,
// que es la doctrina del semáforo de todo el producto: lo que no se sabe
// no se pinta de un color.
export function estadoCupos(cupo, inscritos = 0) {
  const total = Number.isFinite(Number(cupo)) && Number(cupo) > 0 ? Math.floor(Number(cupo)) : null;
  const tomados = Math.max(0, Math.floor(Number(inscritos) || 0));
  if (total === null) return { total: null, inscritos: tomados, quedan: null, abierto: true, lleno: false };
  const quedan = Math.max(0, total - tomados);
  return { total, inscritos: tomados, quedan, abierto: quedan > 0, lleno: quedan === 0 };
}

// ---------- Eventos ----------

// Los que la portada muestra: publicados y que todavía no ocurren.
//
// El corte es por hora de inicio, no por día: una charla que empezó hace
// dos horas ya no es algo a lo que alguien pueda llegar.
export function eventosProximos(filas = [], ahora = new Date()) {
  const t = ahora instanceof Date ? ahora.getTime() : Number(ahora);
  if (!Number.isFinite(t)) return [];
  return filas
    .filter((e) => e && e.publicado === true)
    .filter((e) => {
      const cuando = new Date(e.inicia_at).getTime();
      return Number.isFinite(cuando) && cuando >= t;
    })
    .sort((a, b) => new Date(a.inicia_at) - new Date(b.inicia_at));
}
