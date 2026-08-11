import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  obtenerDolarObservado,
  actualizarDolar,
  URL_DOLAR,
  INTERVALO_MS,
} from '../src/services/tipoCambio.js';

// fetch falso: responde lo que se le pida, sin red.
const respuesta = (json, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  json: async () => json,
});

// BD falsa: registra cada consulta y responde según el modo configurado.
function bdFalsa({ auto }) {
  const llamadas = [];
  return {
    llamadas,
    query: async (sql, params) => {
      llamadas.push({ sql, params });
      if (/SELECT tipo_cambio_auto/.test(sql)) return { rows: [{ tipo_cambio_auto: auto }] };
      return { rows: [] };
    },
  };
}

// ---------- obtenerDolarObservado ----------

test('obtenerDolarObservado toma el primer punto de la serie (el más reciente)', async () => {
  let urlPedida = null;
  const fetcher = async (url) => {
    urlPedida = url;
    return respuesta({
      serie: [
        { fecha: '2026-07-20T04:00:00.000Z', valor: 943.28 },
        { fecha: '2026-07-19T04:00:00.000Z', valor: 940.11 },
      ],
    });
  };
  const r = await obtenerDolarObservado(fetcher);
  assert.equal(urlPedida, URL_DOLAR);
  assert.equal(r.valor, 943.28);
  assert.equal(r.fecha, '2026-07-20');
});

test('obtenerDolarObservado lanza si la respuesta HTTP no es ok', async () => {
  await assert.rejects(
    () => obtenerDolarObservado(async () => respuesta({}, { ok: false, status: 503 })),
    /503/
  );
});

test('obtenerDolarObservado lanza ante serie vacía, ausente o valor basura', async () => {
  for (const cuerpo of [
    {},
    { serie: [] },
    { serie: [{ fecha: '2026-07-20', valor: null }] },
    { serie: [{ fecha: '2026-07-20', valor: 'abc' }] },
    { serie: [{ fecha: '2026-07-20', valor: 0 }] },
    { serie: [{ fecha: '2026-07-20', valor: -5 }] },
  ]) {
    await assert.rejects(
      () => obtenerDolarObservado(async () => respuesta(cuerpo)),
      /válido|mayor que 0|número/,
      `cuerpo ${JSON.stringify(cuerpo)} debió rechazarse`
    );
  }
});

test('obtenerDolarObservado respeta el tope de validarTipoCambio ($5.000/USD)', async () => {
  await assert.rejects(
    () => obtenerDolarObservado(async () => respuesta({ serie: [{ fecha: '2026-07-20', valor: 99999 }] })),
    /válido|máximo/
  );
});

// ---------- actualizarDolar ----------

test('actualizarDolar en modo manual NO consulta la fuente ni escribe nada', async () => {
  const bd = bdFalsa({ auto: false });
  let fetchLlamado = false;
  const r = await actualizarDolar({ query: bd.query, fetcher: async () => { fetchLlamado = true; return respuesta({}); } });
  assert.equal(r.actualizado, false);
  assert.equal(r.motivo, 'modo_manual');
  assert.equal(fetchLlamado, false);
  assert.equal(bd.llamadas.length, 1); // solo el SELECT del modo
});

test('actualizarDolar sin fila de config se comporta como modo manual', async () => {
  const bd = { llamadas: [], query: async (sql) => ({ rows: [] }) };
  const r = await actualizarDolar({ query: bd.query, fetcher: async () => respuesta({}) });
  assert.equal(r.actualizado, false);
  assert.equal(r.motivo, 'modo_manual');
});

test('actualizarDolar en modo auto guarda valor, fuente con fecha y timestamp', async () => {
  const bd = bdFalsa({ auto: true });
  const fetcher = async () => respuesta({ serie: [{ fecha: '2026-07-20T04:00:00.000Z', valor: 943.28 }] });
  const r = await actualizarDolar({ query: bd.query, fetcher });
  assert.equal(r.actualizado, true);
  assert.equal(r.valor, 943.28);
  assert.match(r.fuente, /mindicador\.cl/);
  assert.match(r.fuente, /2026-07-20/);
  const update = bd.llamadas.find((l) => /UPDATE config_pos/.test(l.sql));
  assert.ok(update, 'debió ejecutar el UPDATE');
  assert.equal(update.params[0], 943.28);
  assert.match(update.sql, /tipo_cambio_actualizado = now\(\)/);
});

test('actualizarDolar en modo auto con la fuente caída NO toca el valor anterior', async () => {
  const bd = bdFalsa({ auto: true });
  const r = await actualizarDolar({ query: bd.query, fetcher: async () => { throw new Error('red caída'); } });
  assert.equal(r.actualizado, false);
  assert.match(r.motivo, /red caída/);
  assert.equal(bd.llamadas.some((l) => /UPDATE/.test(l.sql)), false, 'no debió ejecutar ningún UPDATE');
});

test('actualizarDolar con valor fuera de rango tampoco escribe (validación compartida)', async () => {
  const bd = bdFalsa({ auto: true });
  const r = await actualizarDolar({
    query: bd.query,
    fetcher: async () => respuesta({ serie: [{ fecha: '2026-07-20', valor: 6000 }] }),
  });
  assert.equal(r.actualizado, false);
  assert.equal(bd.llamadas.some((l) => /UPDATE/.test(l.sql)), false);
});

// ---------- constantes ----------

test('el intervalo del ciclo automático es de 6 horas', () => {
  assert.equal(INTERVALO_MS, 6 * 60 * 60 * 1000);
});
