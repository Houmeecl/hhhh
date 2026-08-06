import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizarSituacion, consultarSituacionTributaria, consultarRut, CACHE_DIAS,
} from '../src/services/baseapi.js';
import { query, pool } from '../src/lib/db.js';
import { runMigrations } from '../src/lib/migrate.js';
import { EN_PRODUCCION, SALTO_PROD } from './util/soloDev.js';

// Configuración inyectada: nunca la key real, nunca red real.
const CFG = { enabled: true, key: 'clave_de_prueba_no_real', base: 'https://baseapi.invalido', timeoutMs: 2000 };

// RUT sintético válido (módulo 11), mismo criterio que apl.test.js.
const RUT_TEST = '78.345.120-4';
const RUT_NORM = '783451204';

// Respuesta remota tal como la envuelve BaseAPI ({ data: ... }).
const REMOTA = {
  data: {
    rut: '78345120-4',
    nombre: 'EMPRESA DE PRUEBA SPA',
    inicioActividades: true,
    fechaInicioActividades: '2019-03-01',
    empresaMenorTamano: true,
    actividadesEconomicas: [
      { codigo: '461001', descripcion: 'Venta al por mayor de prueba', afectaIva: true },
      { codigo: null, descripcion: 'Actividad secundaria', afectaIva: false },
    ],
    documentosAutorizados: [{ codigo: '33', descripcion: 'Factura electrónica' }],
  },
};

const fetcherOk = async () => ({ ok: true, status: 200, json: async () => REMOTA });
const fetcherHttp = (status) => async () => ({ ok: false, status, json: async () => ({}) });

// ---------- normalizarSituacion (puro) ----------

test('normalizarSituacion: reduce al shape propio y descarta el resto', () => {
  const s = normalizarSituacion(REMOTA.data);
  assert.equal(s.razonSocial, 'EMPRESA DE PRUEBA SPA');
  assert.equal(s.inicioActividades, true);
  assert.equal(s.empresaMenorTamano, true);
  assert.equal(s.actividades.length, 2);
  assert.deepEqual(s.actividades[0], { codigo: '461001', descripcion: 'Venta al por mayor de prueba', afectaIva: true });
  assert.equal('documentosAutorizados' in s, false); // no se guarda lo que no se usa
});

test('normalizarSituacion: rechaza shapes sin nombre', () => {
  assert.equal(normalizarSituacion(null), null);
  assert.equal(normalizarSituacion({}), null);
  assert.equal(normalizarSituacion({ nombre: '   ' }), null);
  assert.equal(normalizarSituacion('texto'), null);
});

// ---------- consultarSituacionTributaria (fetcher inyectado) ----------

test('consulta feliz: manda X-API-Key y RUT con guion, devuelve shape normalizado', async () => {
  let capturada;
  const fetcher = async (url, opts) => { capturada = { url, opts }; return fetcherOk(); };
  const s = await consultarSituacionTributaria(RUT_TEST, { fetcher, cfg: CFG });
  assert.equal(s.razonSocial, 'EMPRESA DE PRUEBA SPA');
  assert.ok(capturada.url.endsWith('/sii/contribuyente/situacion-tributaria'));
  assert.equal(capturada.opts.headers['X-API-Key'], CFG.key);
  assert.deepEqual(JSON.parse(capturada.opts.body), { rut: '78345120-4' });
});

test('RUT inválido y módulo apagado se rechazan antes de tocar la red', async () => {
  await assert.rejects(() => consultarSituacionTributaria('12', { fetcher: fetcherOk, cfg: CFG }), /RUT inválido/);
  await assert.rejects(
    () => consultarSituacionTributaria(RUT_TEST, { fetcher: fetcherOk, cfg: { ...CFG, enabled: false } }),
    /BASEAPI_API_KEY/
  );
});

test('404 remoto se marca sinRegistro; 5xx y shape inválido lanzan sin filtrar la key', async () => {
  await assert.rejects(
    () => consultarSituacionTributaria(RUT_TEST, { fetcher: fetcherHttp(404), cfg: CFG }),
    (e) => e.sinRegistro === true
  );
  for (const fetcher of [fetcherHttp(500), fetcherHttp(429), async () => ({ ok: true, status: 200, json: async () => ({ data: { basura: true } }) })]) {
    await assert.rejects(
      () => consultarSituacionTributaria(RUT_TEST, { fetcher, cfg: CFG }),
      (e) => {
        assert.ok(!e.message.includes(CFG.key), 'el mensaje de error jamás incluye la API key');
        return true;
      }
    );
  }
});

// ============================================================
// consultarRut con caché en BD real (migración 067).
// ============================================================

after(async () => {
  if (!EN_PRODUCCION) {
    await query('DELETE FROM sii_consultas WHERE rut_norm = $1', [RUT_NORM]);
  }
  await pool.end(); // SIEMPRE: sin esto node:test se cuelga con el pool abierto
});

test('caché: la primera consulta guarda y la segunda no toca la red', { skip: SALTO_PROD }, async () => {
  await runMigrations();
  await query('DELETE FROM sii_consultas WHERE rut_norm = $1', [RUT_NORM]);

  let llamadas = 0;
  const fetcher = async () => { llamadas++; return fetcherOk(); };

  const s1 = await consultarRut(RUT_TEST, { fetcher, cfg: CFG });
  assert.equal(s1.razonSocial, 'EMPRESA DE PRUEBA SPA');
  assert.equal(s1.desactualizado, false);
  assert.equal(llamadas, 1);

  const s2 = await consultarRut(RUT_TEST, { fetcher, cfg: CFG });
  assert.equal(s2.razonSocial, 'EMPRESA DE PRUEBA SPA');
  assert.equal(llamadas, 1, 'la segunda consulta sale de la caché');
});

test('caché vencida + fuente caída: sirve lo guardado marcado desactualizado', { skip: SALTO_PROD }, async () => {
  // Envejece la fila más allá de la ventana de frescura.
  await query(
    `UPDATE sii_consultas SET consultado_at = now() - ($1 || ' days')::interval WHERE rut_norm = $2`,
    [String(CACHE_DIAS + 5), RUT_NORM]
  );
  const s = await consultarRut(RUT_TEST, { fetcher: fetcherHttp(503), cfg: CFG });
  assert.equal(s.razonSocial, 'EMPRESA DE PRUEBA SPA');
  assert.equal(s.desactualizado, true);
});

test('caché vencida + RUT que dejó de existir en el SII: propaga sinRegistro sin pisar nada', { skip: SALTO_PROD }, async () => {
  await assert.rejects(
    () => consultarRut(RUT_TEST, { fetcher: fetcherHttp(404), cfg: CFG }),
    (e) => e.sinRegistro === true
  );
  const { rows } = await query('SELECT respuesta FROM sii_consultas WHERE rut_norm = $1', [RUT_NORM]);
  assert.equal(rows[0].respuesta.razonSocial, 'EMPRESA DE PRUEBA SPA', 'la caché anterior sigue intacta');
});

test('sin caché y fuente caída: el error se propaga', { skip: SALTO_PROD }, async () => {
  await query('DELETE FROM sii_consultas WHERE rut_norm = $1', [RUT_NORM]);
  await assert.rejects(() => consultarRut(RUT_TEST, { fetcher: fetcherHttp(502), cfg: CFG }), /HTTP 502/);
});
