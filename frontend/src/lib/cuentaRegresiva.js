// ============================================================
// La cuenta regresiva del lanzamiento.
//
// POR QUÉ ESTO ES UN MÓDULO APARTE Y NO ESTÁ DENTRO DE LA PÁGINA. La
// portada cambia sola cuando el reloj cruza la hora: antes muestra la
// cuenta regresiva, después la landing de siempre. Nadie despliega nada a
// las 16:00. Eso significa que la única pieza que decide qué ve el mundo
// es una comparación de fechas, y una comparación de fechas mal hecha se
// nota tarde y en público. Acá es pura y tiene tests.
//
// LA HORA ESTÁ ESCRITA CON SU HUSO, a propósito:
//
//     2026-08-21T16:00:00-04:00
//
// y no como UTC ni como hora local del navegador. En agosto Chile está en
// horario estándar (UTC-4); en septiembre entra el de verano y pasa a
// UTC-3. Si algún día se corre la fecha al otro lado de ese cambio, el
// offset explícito la mantiene correcta sin que nadie recuerde ajustar
// nada. Guardar "20:00Z" habría funcionado hoy y mentido en octubre.
// ============================================================

// Momento del lanzamiento, en hora de Chile.
export const LANZAMIENTO = '2026-08-21T16:00:00-04:00';

const MINUTO = 60 * 1000;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;

// Milisegundos que faltan. Negativo si ya pasó — no se recorta a cero acá
// a propósito: quien llama decide qué hacer con el pasado, y `yaLanzo`
// necesita distinguirlo.
export function msHasta(ahora, iso = LANZAMIENTO) {
  const destino = new Date(iso).getTime();
  const desde = ahora instanceof Date ? ahora.getTime() : Number(ahora);
  if (!Number.isFinite(destino) || !Number.isFinite(desde)) return NaN;
  return destino - desde;
}

// ¿Ya lanzamos? Exactamente a la hora en punto la respuesta es SÍ: a las
// 16:00:00 la portada ya es la landing, no le queda un último segundo de
// cuenta regresiva.
//
// Ante una fecha ilegible responde `false`, o sea "todavía no". Es la
// respuesta conservadora: deja la cuenta regresiva puesta en vez de
// destapar el sitio por un error de formato.
export function yaLanzo(ahora, iso = LANZAMIENTO) {
  const ms = msHasta(ahora, iso);
  if (!Number.isFinite(ms)) return false;
  return ms <= 0;
}

// Días, horas, minutos y segundos que faltan. Ya pasada la hora, todo en
// cero: un reloj no muestra números negativos.
export function desglose(ms) {
  const t = Number.isFinite(ms) && ms > 0 ? ms : 0;
  return {
    dias: Math.floor(t / DIA),
    horas: Math.floor((t % DIA) / HORA),
    minutos: Math.floor((t % HORA) / MINUTO),
    segundos: Math.floor((t % MINUTO) / 1000),
  };
}

export function dosDigitos(n) {
  return String(Math.max(0, Math.floor(Number(n) || 0))).padStart(2, '0');
}

// La fecha y la hora, por separado, en español de Chile y siempre en hora
// de Santiago — no en la del visitante. Van separadas porque juntas el
// formateador mete una coma ("21 de agosto, 16:00") que en una frase se
// lee mal.
function enSantiago(iso, opciones) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', ...opciones }).format(d);
}

export function fechaLegible(iso = LANZAMIENTO) {
  return enSantiago(iso, { day: 'numeric', month: 'long' });
}

export function horaLegible(iso = LANZAMIENTO) {
  return enSantiago(iso, { hour: '2-digit', minute: '2-digit', hour12: false });
}

// El reloj del visitante puede estar corrido —meses, incluso— y de él
// depende si el sitio se destapa o no. Esta función toma la hora del
// SERVIDOR desde la cabecera `Date`, que toda respuesta HTTP trae, y
// devuelve la diferencia con el reloj local para corregirla.
//
// Cualquier problema devuelve 0: sin red, la página sigue funcionando con
// el reloj del navegador. Vale más una cuenta regresiva aproximada que una
// portada en blanco.
export async function desfaseConServidor(buscar = fetch) {
  try {
    const res = await buscar(`${window.location.origin}/`, { method: 'HEAD', cache: 'no-store' });
    const cabecera = res?.headers?.get?.('date');
    if (!cabecera) return 0;
    const servidor = new Date(cabecera).getTime();
    if (!Number.isFinite(servidor)) return 0;
    return servidor - Date.now();
  } catch {
    return 0;
  }
}
