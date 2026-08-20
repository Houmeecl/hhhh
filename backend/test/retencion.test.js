import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PLAZOS, plazoVencido, resumirPurga, nombresDeTareas } from '../src/services/retencion.js';
import { INVENTARIO, INVENTARIO_CORREDOR, CADENA, PERSONAL } from '../src/services/inventarioDatos.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVICIO = readFileSync(join(RAIZ, 'src/services/retencion.js'), 'utf8');

// ---------- plazoVencido ----------

const HOY = new Date('2026-07-28T12:00:00Z');
const haceDias = (n) => new Date(HOY.getTime() - n * 24 * 60 * 60 * 1000);

test('plazoVencido compara contra el plazo, no contra el calendario', () => {
  assert.equal(plazoVencido(haceDias(400), 365, HOY), true);
  assert.equal(plazoVencido(haceDias(300), 365, HOY), false);
});

test('plazoVencido en el borde exacto: cumplido el plazo, vence', () => {
  assert.equal(plazoVencido(haceDias(365), 365, HOY), true);
  // Un instante antes todavía no.
  const casi = new Date(HOY.getTime() - 365 * 24 * 60 * 60 * 1000 + 1000);
  assert.equal(plazoVencido(casi, 365, HOY), false);
});

test('sin fecha o con fecha basura no se purga nada', () => {
  // No se borra lo que no se sabe cuándo entró: ante la duda, se conserva.
  for (const f of [null, undefined, '', 'ayer', NaN]) {
    assert.equal(plazoVencido(f, 30, HOY), false, `${f} no debería vencer`);
  }
});

test('un plazo inválido o cero nunca vence', () => {
  // Una variable de entorno mal puesta no puede convertirse en un borrado masivo.
  for (const p of [0, -5, NaN, undefined]) {
    assert.equal(plazoVencido(haceDias(9999), p, HOY), false);
  }
});

test('acepta Date y texto ISO por igual', () => {
  assert.equal(plazoVencido(haceDias(400), 365, HOY), true);
  assert.equal(plazoVencido(haceDias(400).toISOString(), 365, HOY), true);
});

// ---------- plazos ----------

test('todos los plazos son enteros positivos de días', () => {
  for (const [k, v] of Object.entries(PLAZOS)) {
    assert.ok(Number.isInteger(v) && v > 0, `${k} = ${v} no es un plazo válido`);
  }
});

test('los plazos quedan declarados como pendientes de confirmación legal', () => {
  // No son cifras del texto de la ley y el código tiene que decirlo.
  assert.match(SERVICIO, /CONFIRMACIÓN LEGAL/i);
});

// ---------- resumen ----------

test('resumirPurga suma las filas y conserva la acción de cada tarea', () => {
  const r = resumirPurga([
    { nombre: 'actividad_log.ip', accion: 'anonimizar', filas: 120 },
    { nombre: 'tokens_magic', accion: 'borrar', filas: 3 },
  ]);
  assert.equal(r.filas, 123);
  assert.equal(r.tareas, 2);
  assert.equal(r.resultado['actividad_log.ip'].accion, 'anonimizar');
  assert.equal(r.resultado.tokens_magic.filas, 3);
});

test('una purga sin nada que hacer resume en cero, no revienta', () => {
  assert.deepEqual(resumirPurga([]), { filas: 0, resultado: {}, tareas: 0 });
  assert.deepEqual(resumirPurga(), { filas: 0, resultado: {}, tareas: 0 });
});

// ---------- la garantía que más importa ----------

test('ninguna tarea de purga toca una tabla encadenada', () => {
  // Borrar o editar una fila encadenada invalida todos los eslabones
  // posteriores. Este test lee las tareas reales, no una lista aparte.
  const encadenadas = Object.entries(INVENTARIO)
    .filter(([, e]) => e.cadena !== CADENA.NINGUNA)
    .map(([t]) => t);
  assert.ok(encadenadas.includes('facturas'), 'el inventario debería marcar facturas como encadenada');

  for (const tabla of encadenadas) {
    for (const tarea of nombresDeTareas()) {
      assert.ok(!tarea.nombre.startsWith(`${tabla}.`) && tarea.nombre !== tabla,
        `la tarea "${tarea.nombre}" toca ${tabla}, que está encadenada`);
    }
  }
});

test('el SQL de la purga no menciona ninguna tabla encadenada', () => {
  // Cinturón y tirantes: aunque alguien nombre la tarea de otra forma,
  // el SQL tampoco puede nombrar la tabla.
  for (const [tabla, e] of Object.entries(INVENTARIO)) {
    if (e.cadena === CADENA.NINGUNA) continue;
    const patron = new RegExp(`(UPDATE|DELETE FROM|INSERT INTO)\\s+${tabla}\\b`, 'i');
    assert.ok(!patron.test(SERVICIO), `retencion.js escribe sobre ${tabla}, que está encadenada`);
  }
});

test('sesiones tampoco se toca: arrastraría facturas por CASCADE', () => {
  assert.ok(!/(UPDATE|DELETE FROM)\s+sesiones\b/i.test(SERVICIO));
});

// ---------- coherencia con el inventario ----------

test('cada tarea corresponde a una tabla del inventario que declara purga', () => {
  for (const tarea of nombresDeTareas()) {
    const tabla = tarea.nombre.split('.')[0];
    // Cada tarea se contrasta contra el inventario de SU base. Buscarlas
    // todas en INVENTARIO daba por inexistente cualquier tabla del
    // Corredor, que es la misma confusión que dejó al Corredor fuera del
    // derecho de acceso.
    const entrada = (tarea.bd === 'corredor' ? INVENTARIO_CORREDOR : INVENTARIO)[tabla];
    assert.ok(entrada, `la tarea ${tarea.nombre} purga ${tabla}, que no está en el inventario de ${tarea.bd}`);
    assert.ok(entrada.retencion, `${tabla} se purga pero el inventario dice que no tiene política de retención`);
  }
});

test('toda tabla personal con política de retención tiene quien la purgue', () => {
  // Evita el caso inverso: el inventario promete una purga que nadie hace.
  const conPolitica = Object.entries(INVENTARIO)
    .filter(([, e]) => e.clasificacion === PERSONAL && e.retencion && /pasado el plazo/i.test(e.retencion))
    .map(([t]) => t);
  const purgadas = new Set(nombresDeTareas().map((t) => t.nombre.split('.')[0]));
  for (const tabla of conPolitica) {
    assert.ok(purgadas.has(tabla), `${tabla} promete purgarse "pasado el plazo" pero ninguna tarea lo hace`);
  }
});

test('cada tarea declara si anonimiza o borra, y su plazo', () => {
  for (const t of nombresDeTareas()) {
    assert.ok(['anonimizar', 'borrar'].includes(t.accion), `${t.nombre}: acción ${t.accion}`);
    assert.ok(Number.isInteger(t.dias) && t.dias > 0, `${t.nombre}: plazo inválido`);
  }
});

test('el log de actividad se anonimiza, no se borra', () => {
  // Su valor probatorio es justamente lo que la ley pide poder mostrar:
  // se le quita la IP y se conserva quién hizo qué y cuándo.
  const tarea = nombresDeTareas().find((t) => t.nombre.startsWith('actividad_log'));
  assert.equal(tarea.accion, 'anonimizar');
  assert.ok(!/DELETE FROM actividad_log/i.test(SERVICIO), 'el log no se borra, se anonimiza');
});

// ============================================================
// La purga alcanza las DOS bases.
//
// EL HALLAZGO. El inventario declaraba para `tokens_password_corredor`
// que "el token caduca en 48 h" y para `actividad_corredor` que "se purga
// con el mismo criterio que la bitácora de sicr3p", y no existía ninguna
// tarea que lo hiciera: TAREAS corría entera con el pool de la base
// principal, donde esas tablas no existen. Una política de retención
// escrita que nadie ejecuta es peor que no tenerla, porque se cita al
// responder una fiscalización.
// ============================================================

test('las tablas del Corredor que declaran purga tienen una tarea que la haga', async () => {
  const { nombresDeTareas } = await import('../src/services/retencion.js');
  const { INVENTARIO_CORREDOR } = await import('../src/services/inventarioDatos.js');
  const tareas = nombresDeTareas();

  // Una tarea puede llamarse `tabla` o `tabla.columna` (anonimizar una
  // columna es purgar esa tabla en lo que a esta comprobación respecta).
  const cubiertas = new Set(tareas.map((t) => t.nombre.split('.')[0]));

  // Solo se exige tarea donde el inventario PROMETE un plazo. `retencion:
  // null` es "no se purga" y ya tiene que explicar su motivoSinPurga; una
  // retención atada al ciclo de vida de otra fila ("Igual que la carga")
  // la resuelve el ON DELETE CASCADE, no una tarea periódica.
  const prometePlazo = (e) => typeof e.retencion === 'string' && /\b\d+\s*(h|día|dias|días|mes|año)/i.test(e.retencion);

  const sinTarea = Object.entries(INVENTARIO_CORREDOR)
    .filter(([tabla, e]) => prometePlazo(e) && !cubiertas.has(tabla))
    .map(([tabla, e]) => `${tabla} ("${e.retencion}")`);

  assert.deepEqual(sinTarea, [],
    'El inventario del Corredor promete un plazo de retención para estas tablas y no hay '
    + 'ninguna tarea en services/retencion.js que lo cumpla. O se escribe la tarea, o se '
    + 'corrige lo que el inventario declara: lo que no puede quedar es la promesa sin el hecho.');
});

test('cada tarea declara en qué base corre', async () => {
  const { nombresDeTareas } = await import('../src/services/retencion.js');
  for (const t of nombresDeTareas()) {
    assert.ok(['principal', 'corredor'].includes(t.bd), `${t.nombre}: base "${t.bd}" desconocida`);
  }
});

test('la purga del Corredor existe y apunta a sus dos tablas', async () => {
  const { nombresDeTareas } = await import('../src/services/retencion.js');
  const delCorredor = nombresDeTareas().filter((t) => t.bd === 'corredor').map((t) => t.nombre);
  assert.ok(delCorredor.includes('tokens_password_corredor'), 'los tokens del Corredor no se purgan');
  assert.ok(delCorredor.includes('actividad_corredor.ip'), 'la IP de la bitácora del Corredor no se anonimiza');
});
