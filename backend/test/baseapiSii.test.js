import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizarFilaRcv, descargarRcv, descargarComprasVentas, validarCredencialesSii, PERIODO_RE,
} from '../src/services/baseapiSii.js';

// Config inyectada: nunca la key real, nunca red real.
const CFG = { enabled: true, key: 'clave_api_servidor_no_real', base: 'https://baseapi.invalido', timeoutMs: 2000 };
const RUT = '78345120-4'; // RUT sintético válido (módulo 11)
const CLAVE = 'clave_sii_secreta_del_contribuyente';

// Fila cruda del RCV tal como la entrega BaseAPI (compra).
const FILA_COMPRA = {
  'Nro': '1', 'Tipo Doc': '33', 'RUT Proveedor': '77.000.000-0', 'Razon Social': 'INVERSIONES ALPHA SPA',
  'Folio': '100', 'Fecha Docto': '15/01/2025', 'Monto Neto': '350000', 'Monto IVA': '66500', 'Monto total': '416500',
};

test('PERIODO_RE acepta AAAA-MM y rechaza el resto', () => {
  assert.ok(PERIODO_RE.test('2025-01'));
  assert.ok(PERIODO_RE.test('2026-12'));
  assert.ok(!PERIODO_RE.test('2025-13'));
  assert.ok(!PERIODO_RE.test('202501'));
  assert.ok(!PERIODO_RE.test('enero'));
});

test('normalizarFilaRcv reduce la fila y normaliza RUT/montos/fecha', () => {
  const n = normalizarFilaRcv(FILA_COMPRA);
  assert.equal(n.tipo_dte, '33');
  assert.equal(n.folio, '100');
  assert.equal(n.rut_contraparte, '770000000'); // sin puntos ni guión
  assert.equal(n.razon_social, 'INVERSIONES ALPHA SPA');
  assert.equal(n.neto, 350000);
  assert.equal(n.iva, 66500);
  assert.equal(n.total, 416500);
  assert.equal(n.fecha, '2025-01-15'); // DD/MM/YYYY -> ISO
});

test('normalizarFilaRcv lee la columna de venta (RUT Cliente) y descarta filas sin folio', () => {
  const venta = normalizarFilaRcv({ 'Tipo Doc': '33', 'RUT Cliente': '76543210-3', 'Razon Social': 'CLIENTE LTDA', 'Folio': '5', 'Monto total': '119000' });
  assert.equal(venta.rut_contraparte, '765432103');
  assert.equal(normalizarFilaRcv({ 'Monto total': '1000' }), null); // sin folio
});

// fetcher falso: registra lo que se envía para poder auditar que la clave
// va SOLO al SII (BaseAPI) y a ningún otro lado.
function fakeFetch(respuesta, { status = 200, capturas = [] } = {}) {
  return async (url, opts) => {
    capturas.push({ url, body: opts.body });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => respuesta,
    };
  };
}

test('descargarRcv envía la clave en el cuerpo hacia BaseAPI y normaliza la respuesta', async () => {
  const capturas = [];
  const fetcher = fakeFetch({ success: true, data: { datos: [FILA_COMPRA] } }, { capturas });
  const filas = await descargarRcv(
    { rut: RUT, password: CLAVE, periodo: '2025-01', tipo: 'compra' },
    { fetcher, cfg: CFG }
  );
  assert.equal(filas.length, 1);
  assert.equal(filas[0].folio, '100');
  // La clave va en el cuerpo del request al SII (esto es correcto y necesario).
  const enviado = JSON.parse(capturas[0].body);
  assert.equal(enviado.password, CLAVE);
  assert.equal(enviado.rut, RUT);
  assert.match(capturas[0].url, /\/sii\/rcv\/2025-01\/compra$/);
});

test('descargarRcv rechaza período y tipo inválidos antes de tocar la red', async () => {
  const capturas = [];
  const fetcher = fakeFetch({}, { capturas });
  await assert.rejects(() => descargarRcv({ rut: RUT, password: CLAVE, periodo: 'mal', tipo: 'compra' }, { fetcher, cfg: CFG }), /Período/);
  await assert.rejects(() => descargarRcv({ rut: RUT, password: CLAVE, periodo: '2025-01', tipo: 'otro' }, { fetcher, cfg: CFG }), /Tipo/);
  assert.equal(capturas.length, 0);
});

test('un error de la fuente nunca revela la clave en el mensaje', async () => {
  const fetcher = fakeFetch({}, { status: 500 });
  try {
    await descargarRcv({ rut: RUT, password: CLAVE, periodo: '2025-01', tipo: 'compra' }, { fetcher, cfg: CFG });
    assert.fail('debió lanzar');
  } catch (e) {
    assert.ok(!e.message.includes(CLAVE), 'el mensaje de error no puede contener la clave');
  }
});

test('credenciales malas (401/403) se marcan como error de credenciales', async () => {
  const fetcher = fakeFetch({}, { status: 401 });
  assert.equal(await validarCredencialesSii({ rut: RUT, password: 'mala' }, { fetcher, cfg: CFG }), false);
  await assert.rejects(
    () => descargarComprasVentas({ rut: RUT, password: 'mala', periodo: '2025-01' }, { fetcher, cfg: CFG }),
    (e) => e.credenciales === true
  );
});

test('descargarComprasVentas valida primero y luego trae compra y venta', async () => {
  const capturas = [];
  const fetcher = fakeFetch({ success: true, data: { datos: [FILA_COMPRA] } }, { capturas });
  const r = await descargarComprasVentas({ rut: RUT, password: CLAVE, periodo: '2025-01' }, { fetcher, cfg: CFG });
  assert.equal(r.compra.length, 1);
  assert.equal(r.venta.length, 1);
  // 3 llamadas: validar + compra + venta.
  assert.equal(capturas.length, 3);
  assert.match(capturas[0].url, /\/sii\/auth\/validar$/);
  assert.match(capturas[1].url, /\/rcv\/2025-01\/compra$/);
  assert.match(capturas[2].url, /\/rcv\/2025-01\/venta$/);
});

test('sin BASEAPI_API_KEY el módulo queda apagado', async () => {
  const fetcher = fakeFetch({});
  await assert.rejects(
    () => descargarRcv({ rut: RUT, password: CLAVE, periodo: '2025-01', tipo: 'compra' }, { fetcher, cfg: { ...CFG, enabled: false, key: '' } }),
    /no está configurada/
  );
});
