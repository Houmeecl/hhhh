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
// POST /api/sesiones es público y sin login, y cada archivo puede gatillar
// hasta tres llamadas a la IA. Lo que se prueba acá es que el tope existe y
// que DEGRADA en vez de fallar: al superarse, el documento se sigue leyendo
// con el parser de reglas y nadie recibe un rechazo por haberse acabado el
// presupuesto.
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
  await query(
    `DELETE FROM analisis_ia_uso WHERE modelo = $1 OR motivo_error = 'presupuesto_diario_agotado'`,
    ['modelo-de-prueba']
  ).catch(() => {});
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

test('el aviso de presupuesto agotado se registra una sola vez, no una por documento', { skip: EN_PRODUCCION && SALTO_PROD }, async () => {
  config.analisisIA.enabled = true;
  config.analisisIA.presupuestoDiarioClp = 100;
  await gastarHoy(500);

  const antes = await contarAvisos();
  for (let i = 0; i < 3; i += 1) await analisisIA.analizarTexto('FACTURA N° 1\nServicio $ 10.000');
  const despues = await contarAvisos();
  assert.equal(despues - antes, 1, 'una fila por día y proceso, no una por documento saltado');

  Object.assign(config.analisisIA, original);
});

async function contarAvisos() {
  const { rows } = await query(
    `SELECT count(*)::int AS n FROM analisis_ia_uso WHERE motivo_error = 'presupuesto_diario_agotado'`
  );
  return rows[0].n;
}

test('el gasto se cuenta aunque la bitácora no se pueda escribir (una BD caída no destapa el tope)', () => {
  presupuestoIA.reiniciar();
  presupuestoIA.anotarGasto(120.5);
  presupuestoIA.anotarGasto(30);
  assert.equal(presupuestoIA.gastoEnMemoria(), 150.5);
  presupuestoIA.reiniciar();
});
