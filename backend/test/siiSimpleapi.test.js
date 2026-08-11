import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarCredencialesSii, descargarComprasVentas } from '../src/services/siiSimpleapi.js';

// Config inyectada: nunca una key real, nunca red real.
const CFG = { enabled: true, key: 'apikey-simpleapi-no-real', base: 'https://simpleapi.invalido/api', timeoutMs: 2000 };
const RUT = '78345120-4'; // RUT sintético válido (módulo 11)
const CLAVE = 'clave_sii_secreta_del_contribuyente';

const FILA = {
  'Tipo Doc': '33', 'RUT Proveedor': '77.000.000-0', 'Razon Social': 'INVERSIONES ALPHA SPA',
  'Folio': '100', 'Fecha Docto': '15/01/2025', 'Monto Neto': '350000', 'Monto IVA': '66500', 'Monto total': '416500',
};

function fakeFetch(porUrl, { capturas = [] } = {}) {
  return async (url, opts) => {
    capturas.push({ url, headers: opts.headers, body: opts.body });
    const { status = 200, json = { data: [] } } = porUrl(url) || {};
    return { ok: status >= 200 && status < 300, status, json: async () => json };
  };
}

test('SimpleAPI: la clave va en el cuerpo (PasswordSII) y la API Key en Authorization', async () => {
  const capturas = [];
  const fetcher = fakeFetch(() => ({ json: { data: [FILA] } }), { capturas });
  await descargarComprasVentas({ rut: RUT, password: CLAVE, periodo: '2025-01' }, { fetcher, cfg: CFG });
  const enviado = JSON.parse(capturas[0].body);
  assert.equal(enviado.PasswordSII, CLAVE);
  assert.equal(enviado.RutUsuario, RUT);
  assert.equal(capturas[0].headers.Authorization, CFG.key);
  assert.equal(capturas[0].headers['X-API-Key'], undefined); // no es BaseAPI
});

test('SimpleAPI: normaliza compras y ventas con las mismas claves que BaseAPI', async () => {
  const fetcher = fakeFetch((url) => ({ json: { data: [FILA] } }));
  const r = await descargarComprasVentas({ rut: RUT, password: CLAVE, periodo: '2025-01' }, { fetcher, cfg: CFG });
  assert.equal(r.compra.length, 1);
  assert.equal(r.venta.length, 1);
  assert.equal(r.compra[0].folio, '100');
  assert.equal(r.compra[0].total, 416500);
  assert.equal(r.compra[0].origen_calculo, 'texto'); // sin XML => método por gasto
  assert.equal(r.compra[0].items.length, 1);
});

test('SimpleAPI: suma la fila-resumen de boletas (resumenPorTipo)', async () => {
  const fetcher = fakeFetch((url) => ({
    json: {
      data: /venta/.test(url) ? [] : [FILA],
      resumenPorTipo: /venta/.test(url)
        ? [{ tipoDocumento: 'Boleta Electrónica', codigoTipoDoc: 39, totalDocumentos: 500, montoNeto: 1000000, montoIva: 190000, montoTotal: 1190000 }]
        : [],
    },
  }));
  const r = await descargarComprasVentas({ rut: RUT, password: CLAVE, periodo: '2025-01' }, { fetcher, cfg: CFG });
  const boletas = r.venta.find((f) => f.tipo_dte === '39');
  assert.ok(boletas, 'la venta debe incluir el resumen de boletas');
  assert.equal(boletas.total, 1190000);
});

test('SimpleAPI: 401 se marca como error de credenciales; validar → false', async () => {
  const fetcher = fakeFetch(() => ({ status: 401, json: {} }));
  assert.equal(await validarCredencialesSii({ rut: RUT, password: 'mala' }, { fetcher, cfg: CFG }), false);
  await assert.rejects(
    () => descargarComprasVentas({ rut: RUT, password: 'mala', periodo: '2025-01' }, { fetcher, cfg: CFG }),
    (e) => e.credenciales === true
  );
});

test('SimpleAPI: validar envía un Periodo válido — sin él, toda clave parecía mala', async () => {
  // SimpleAPI responde 400 si falta Periodo en /rcv/compra; como el 400 se
  // interpreta "credenciales malas", el login del admin quedaba imposible.
  const capturas = [];
  const fetcher = fakeFetch(() => ({ json: { data: [] } }), { capturas });
  assert.equal(await validarCredencialesSii({ rut: RUT, password: CLAVE }, { fetcher, cfg: CFG }), true);
  const enviado = JSON.parse(capturas[0].body);
  assert.match(String(enviado.Periodo || ''), /^\d{4}-(0[1-9]|1[0-2])$/, 'la validación debe llevar Periodo AAAA-MM');
});

test('SimpleAPI: 400 en descarga da el mensaje honesto (clave/período/representación)', async () => {
  const fetcher = fakeFetch(() => ({ status: 400, json: {} }));
  await assert.rejects(
    () => descargarComprasVentas({ rut: RUT, password: CLAVE, periodo: '2025-01' }, { fetcher, cfg: CFG }),
    (e) => e.entrada === true && /clave tributaria/.test(e.message) && /período/.test(e.message)
  );
});

test('SimpleAPI: 429 explica la cuota del proveedor y pide esperar', async () => {
  const fetcher = fakeFetch(() => ({ status: 429, json: {} }));
  await assert.rejects(
    () => descargarComprasVentas({ rut: RUT, password: CLAVE, periodo: '2025-01' }, { fetcher, cfg: CFG }),
    (e) => e.fuente === true && e.status === 429 && /cuota/.test(e.message)
  );
});

test('SimpleAPI: un error de la fuente nunca revela la clave', async () => {
  const fetcher = fakeFetch(() => ({ status: 500, json: {} }));
  try {
    await descargarComprasVentas({ rut: RUT, password: CLAVE, periodo: '2025-01' }, { fetcher, cfg: CFG });
    assert.fail('debió lanzar');
  } catch (e) {
    assert.ok(!e.message.includes(CLAVE));
    assert.equal(e.fuente, true);
  }
});

test('SimpleAPI: sin SIMPLEAPI_KEY el adaptador queda apagado', async () => {
  const fetcher = fakeFetch(() => ({ json: { data: [] } }));
  await assert.rejects(
    () => descargarComprasVentas({ rut: RUT, password: CLAVE, periodo: '2025-01' }, { fetcher, cfg: { ...CFG, enabled: false, key: '' } }),
    /no está configurada/
  );
});
