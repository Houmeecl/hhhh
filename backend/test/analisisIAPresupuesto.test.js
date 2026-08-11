import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from '../src/config.js';
import { query, pool } from '../src/lib/db.js';
import { runMigrations } from '../src/lib/migrate.js';
import { analisisIA, presupuestoIA } from '../src/services/analisisIA.js';
import { leerDocumento } from '../src/services/lecturaDocumento.js';
import { EN_PRODUCCION, SALTO_PROD } from './util/soloDev.js';

// ============================================================
// Tope de gasto diario de la API de IA.
//
// Un envío a POST /api/sesiones puede gatillar hasta tres llamadas a la IA
// por archivo. Lo que se prueba acá es que el tope existe y que la lectura
// cae al parser de reglas en vez de fallar. OJO con el alcance de esa
// promesa: el documento que el parser SÍ sabe leer se procesa igual (es el
// caso que cubre el fixture); el que solo la IA sabía leer termina
// rechazado, con un mensaje que dice que puede no ser culpa del documento
// (routes/public.js), o se va al motor externo si está encendido.
//
// La API real de Anthropic no se toca: `fetch` se reemplaza por un espía que
// falla si alguien lo llama. Que el espía quede sin usar ES el resultado que
// se está verificando.
// ============================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PDF = path.join(__dirname, 'fixtures', 'factura-texto.pdf');

const original = { ...config.analisisIA };
let fetchOriginal;
let llamadasFetch = 0;

before(async () => {
  if (EN_PRODUCCION && SALTO_PROD) return;
  await runMigrations();
  fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (url) => {
    llamadasFetch += 1;
    throw new Error(`la IA no debía llamarse: ${url}`);
  };
});

after(async () => {
  if (fetchOriginal) globalThis.fetch = fetchOriginal;
  Object.assign(config.analisisIA, original);
  presupuestoIA.reiniciar();
  // La guarda de producción va también en el `after()`, no solo en el
  // `before()`: la suite corre en el VPS como compuerta del deploy
  // (deploy/actualizar.sh) con el .env apuntando a la BD REAL. Un DELETE sin
  // guarda acá borraría filas de producción en cada actualización — y con
  // `.catch(() => {})`, en silencio. El filtro por `modelo` también acota:
  // solo se borra lo que este archivo escribió.
  if (!EN_PRODUCCION) {
    await query(`DELETE FROM analisis_ia_uso WHERE modelo = $1`, ['modelo-de-prueba']).catch(() => {});
  }
  await pool.end();
});

// Deja registrado en la bitácora un gasto de hoy por encima del tope, que es
// de donde `presupuestoAgotado()` saca la verdad (la memoria del proceso es
// solo un acumulador entre lecturas).
async function gastarHoy(clp) {
  await query(
    `INSERT INTO analisis_ia_uso (modelo, exito, tokens_entrada, tokens_salida, costo_estimado_clp, latencia_ms)
     VALUES ($1, true, 1000, 500, $2, 100)`,
    ['modelo-de-prueba', clp]
  );
  presupuestoIA.reiniciar(); // fuerza la relectura de la BD en la próxima consulta
}

test('presupuesto en 0 = la IA no se llama (un despliegue sin configurar queda acotado)', async () => {
  config.analisisIA.presupuestoDiarioClp = 0;
  presupuestoIA.reiniciar();
  assert.equal(await presupuestoIA.agotado(), true);
  config.analisisIA.presupuestoDiarioClp = original.presupuestoDiarioClp;
});

test('config: sin variable de entorno el tope no queda infinito', () => {
  // El valor exacto puede cambiar; lo que no puede cambiar es que exista un
  // número finito y positivo por defecto.
  assert.equal(Number.isFinite(original.presupuestoDiarioClp), true);
  assert.equal(original.presupuestoDiarioClp > 0, true);
});

// Los tres casos que `Number(v) || def` confunde, y que apagaban la IA en
// silencio: dotenv entrega '' (no undefined) para una línea `VAR=`, y un
// monto pegado en formato es-CL ('20.000') se leía como veinte pesos.
test('config: el tope se lee bien vacío, en es-CL y con basura', async () => {
  const { montoClp } = await import('../src/config.js');
  assert.equal(montoClp(undefined, 20000, 'X'), 20000, 'sin definir → default');
  assert.equal(montoClp('', 20000, 'X'), 20000, 'vacío → default, no 0');
  assert.equal(montoClp('   ', 20000, 'X'), 20000);
  assert.equal(montoClp('20.000', 20000, 'X'), 20000, 'es-CL: veinte mil, no veinte');
  assert.equal(montoClp('1.234.567', 0, 'X'), 1234567);
  assert.equal(montoClp('5000', 20000, 'X'), 5000);
  assert.equal(montoClp('20.5', 20000, 'X'), 20.5, 'un decimal de verdad no es separador de miles');
  assert.equal(montoClp('0', 20000, 'X'), 0, 'cero explícito SÍ se respeta: apaga la IA a propósito');
  assert.equal(montoClp('mucho', 20000, 'X'), 20000, 'basura → default, con aviso');
  assert.equal(montoClp('-5', 20000, 'X'), 20000, 'negativo → default');
});

test('gasto del día por sobre el tope → analizarTexto devuelve null sin llamar a la API', { skip: EN_PRODUCCION && SALTO_PROD }, async () => {
  config.analisisIA.enabled = true; // como si hubiera ANTHROPIC_API_KEY
  config.analisisIA.presupuestoDiarioClp = 100;
  await gastarHoy(500);

  llamadasFetch = 0;
  const r = await analisisIA.analizarTexto('FACTURA ELECTRONICA N° 1\nSuministro electrico $ 10.000');
  assert.equal(r, null, 'la IA se salta cuando se acabó el presupuesto');
  assert.equal(llamadasFetch, 0, 'no se gastó ni una llamada más');

  Object.assign(config.analisisIA, original);
});

test('con el presupuesto agotado el documento se lee igual, con el parser de reglas', { skip: EN_PRODUCCION && SALTO_PROD }, async () => {
  config.analisisIA.enabled = true;
  config.analisisIA.presupuestoDiarioClp = 100;
  await gastarHoy(500);

  llamadasFetch = 0;
  const r = await leerDocumento(fs.readFileSync(FIXTURE_PDF), 'factura.pdf');
  assert.equal(llamadasFetch, 0);
  assert.equal(r.tipo, 'texto', 'degradación, no rechazo: el documento se lee igual');
  assert.equal(r.motor, 'propio_texto', 'lo leyó el parser de reglas, no la IA');

  Object.assign(config.analisisIA, original);
});

// `analisis_ia_uso` es la bitácora de LLAMADAS a la API. Una llamada que no
// se hizo no puede aparecer ahí: contaría en `llamadas_30d` del panel, bajaría
// el porcentaje de éxito y arrastraría el promedio de latencia.
test('saltarse la IA no escribe una llamada que nunca ocurrió', { skip: EN_PRODUCCION && SALTO_PROD }, async () => {
  config.analisisIA.enabled = true;
  config.analisisIA.presupuestoDiarioClp = 100;
  await gastarHoy(500);

  const antes = await contarFilas();
  for (let i = 0; i < 3; i += 1) await analisisIA.analizarTexto('FACTURA N° 1\nServicio $ 10.000');
  assert.equal(await contarFilas(), antes, 'ni una fila nueva por los documentos saltados');

  Object.assign(config.analisisIA, original);
});

async function contarFilas() {
  const { rows } = await query(`SELECT count(*)::int AS n FROM analisis_ia_uso`);
  return rows[0].n;
}

// Un solo NaN en la columna hace que SUM() del día sea NaN, y `NaN >= tope`
// es FALSO: el tope desaparecería hasta el otro día, con el panel mostrando
// $0 tan tranquilo. Pasa de verdad si la respuesta viene sin `usage`.
test('un costo no numérico no se acumula ni destapa el tope', { skip: EN_PRODUCCION && SALTO_PROD }, async () => {
  presupuestoIA.reiniciar();
  presupuestoIA.anotarGasto(50);
  presupuestoIA.anotarGasto(Number('no es un número')); // NaN: se ignora
  assert.equal(presupuestoIA.gastoEnMemoria(), 50);
  presupuestoIA.reiniciar();
});

// Con el proceso ya andando y la BD caída, la bitácora deja de escribirse
// pero el acumulador sigue contando. (Arrancar con la BD caída es otra cosa:
// ahí el acumulador parte en cero y esto no lo cubre — está dicho en el
// encabezado del servicio.)
test('el gasto se sigue contando en memoria aunque la bitácora no se pueda escribir', () => {
  presupuestoIA.reiniciar();
  presupuestoIA.anotarGasto(120.5);
  presupuestoIA.anotarGasto(30);
  assert.equal(presupuestoIA.gastoEnMemoria(), 150.5);
  presupuestoIA.reiniciar();
});
