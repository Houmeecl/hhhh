import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarCredencialesSii, descargarComprasVentas } from '../src/services/siiApigateway.js';

// Config inyectada: nunca una key real, nunca red real.
const CFG = { enabled: true, key: 'apikey-apigateway-no-real', base: 'https://apigateway.invalido/api/v2', timeoutMs: 2000 };
const RUT = '78345120-4'; // RUT sintético válido (módulo 11)
const CLAVE = 'clave_sii_secreta_del_contribuyente';

const FILA_DETALLE = {
  detTipoDoc: 33, detRutDoc: 77000000, detDvDoc: '0', detRznSoc: 'INVERSIONES ALPHA SPA',
  detNroDoc: 100, detFchDoc: '15/01/2025', detMntNeto: 350000, detMntIVA: 66500, detMntTotal: 416500,
};

function fakeFetch(porUrl, { capturas = [] } = {}) {
  return async (url, opts) => {
    capturas.push({ url, headers: opts.headers, body: opts.body });
    const { status = 200, json = { data: [] } } = porUrl(url) || {};
    return { ok: status >= 200 && status < 300, status, json: async () => json };
  };
}

// Respuestas por defecto para las 5 llamadas de un descargarComprasVentas
// completo: validar + detalle/resumen de compras y ventas.
function porUrlCompleto(url) {
  if (url.includes('/misii/contribuyente/datos')) return { json: { data: { datos: { codigoError: 0 } } } };
  if (url.includes('/resumen/')) return { json: { data: { respEstado: { codRespuesta: 0 }, data: [] } } };
  if (url.includes('/compras/detalle/')) return { json: { data: [FILA_DETALLE] } };
  if (url.includes('/ventas/detalle/')) return { json: { data: [FILA_DETALLE] } };
  return { json: { data: [] } };
}

test('apigateway.cl: la clave va en auth.pass.clave y la API Key en Authorization con prefijo Token', async () => {
  const capturas = [];
  const fetcher = fakeFetch(porUrlCompleto, { capturas });
  await descargarComprasVentas({ rut: RUT, password: CLAVE, periodo: '2025-01' }, { fetcher, cfg: CFG });
  const primera = JSON.parse(capturas[0].body);
  assert.equal(primera.auth.pass.clave, CLAVE);
  assert.equal(primera.auth.pass.rut, RUT);
  assert.equal(capturas[0].headers.Authorization, `Token ${CFG.key}`);
  assert.equal(capturas[0].headers['X-API-Key'], undefined); // no es BaseAPI
});

test('apigateway.cl: valida primero (barato) antes de gastar en el RCV', async () => {
  const capturas = [];
  const fetcher = fakeFetch(porUrlCompleto, { capturas });
  await descargarComprasVentas({ rut: RUT, password: CLAVE, periodo: '2025-01' }, { fetcher, cfg: CFG });
  assert.ok(capturas[0].url.includes('/misii/contribuyente/datos'), 'la primera llamada debe ser la de validación');
});

test('apigateway.cl: normaliza el detalle det* a las mismas claves que BaseAPI/SimpleAPI', async () => {
  const fetcher = fakeFetch(porUrlCompleto);
  const r = await descargarComprasVentas({ rut: RUT, password: CLAVE, periodo: '2025-01' }, { fetcher, cfg: CFG });
  assert.equal(r.compra.length, 1);
  assert.equal(r.venta.length, 1);
  assert.equal(r.compra[0].folio, '100');
  assert.equal(r.compra[0].rut_contraparte, '770000000'); // 77.000.000-0 normalizado
  assert.equal(r.compra[0].total, 416500);
  assert.equal(r.compra[0].fecha, '2025-01-15'); // detFchDoc DD/MM/YYYY → ISO
  assert.equal(r.compra[0].origen_calculo, 'texto'); // sin detalle de ítems => método por gasto
  assert.equal(r.compra[0].items.length, 1);
});

test('apigateway.cl: fechas con guiones o en ISO también quedan en ISO (no NULL en silencio)', async () => {
  const fetcher = fakeFetch((url) => {
    if (url.includes('/misii/contribuyente/datos')) return { json: { data: { datos: { codigoError: 0 } } } };
    if (url.includes('/resumen/')) return { json: { data: { respEstado: { codRespuesta: 0 }, data: [] } } };
    if (url.includes('/compras/detalle/')) return { json: { data: [{ ...FILA_DETALLE, detFchDoc: '15-01-2025' }] } };
    if (url.includes('/ventas/detalle/')) return { json: { data: [{ ...FILA_DETALLE, detFchDoc: '2025-01-15' }] } };
    return { json: { data: [] } };
  });
  const r = await descargarComprasVentas({ rut: RUT, password: CLAVE, periodo: '2025-01' }, { fetcher, cfg: CFG });
  assert.equal(r.compra[0].fecha, '2025-01-15');
  assert.equal(r.venta[0].fecha, '2025-01-15');
});

test('apigateway.cl: suma la fila-resumen de boletas (tipos sin detalle)', async () => {
  const fetcher = fakeFetch((url) => {
    if (url.includes('/misii/contribuyente/datos')) return { json: { data: { datos: { codigoError: 0 } } } };
    if (url.includes('/ventas/resumen/')) {
      return {
        json: {
          data: {
            respEstado: { codRespuesta: 0 },
            data: [{ dcvNombreTipoDoc: 'Boleta Electrónica', rsmnTipoDocInteger: 39, rsmnTotDoc: 500, rsmnMntNeto: 1000000, rsmnMntIVA: 190000, rsmnMntTotal: 1190000 }],
          },
        },
      };
    }
    if (url.includes('/resumen/')) return { json: { data: { respEstado: { codRespuesta: 0 }, data: [] } } };
    return { json: { data: [] } }; // detalle vacío en este caso
  });
  const r = await descargarComprasVentas({ rut: RUT, password: CLAVE, periodo: '2025-01' }, { fetcher, cfg: CFG });
  const boletas = r.venta.find((f) => f.tipo_dte === '39');
  assert.ok(boletas, 'la venta debe incluir el resumen de boletas');
  assert.equal(boletas.total, 1190000);
});

test('apigateway.cl: 401 en la validación se marca como error de credenciales', async () => {
  const fetcher = fakeFetch(() => ({ status: 401, json: {} }));
  assert.equal(await validarCredencialesSii({ rut: RUT, password: 'mala' }, { fetcher, cfg: CFG }), false);
  await assert.rejects(
    () => descargarComprasVentas({ rut: RUT, password: 'mala', periodo: '2025-01' }, { fetcher, cfg: CFG }),
    (e) => e.credenciales === true
  );
});

test('apigateway.cl: codigoError != 0 con HTTP 200 también se trata como credenciales inválidas', async () => {
  const fetcher = fakeFetch(() => ({ json: { data: { datos: { codigoError: 7 } } } }));
  assert.equal(await validarCredencialesSii({ rut: RUT, password: 'mala' }, { fetcher, cfg: CFG }), false);
});

test('apigateway.cl: 400 en descarga da el mensaje honesto (clave/período/representación)', async () => {
  const fetcher = fakeFetch((url) => {
    if (url.includes('/misii/contribuyente/datos')) return { json: { data: { datos: { codigoError: 0 } } } };
    return { status: 400, json: {} };
  });
  await assert.rejects(
    () => descargarComprasVentas({ rut: RUT, password: CLAVE, periodo: '2025-01' }, { fetcher, cfg: CFG }),
    (e) => e.entrada === true && /clave tributaria/.test(e.message) && /período/.test(e.message)
  );
});

test('apigateway.cl: 429 explica la cuota del proveedor y pide esperar', async () => {
  const fetcher = fakeFetch(() => ({ status: 429, json: {} }));
  await assert.rejects(
    () => descargarComprasVentas({ rut: RUT, password: CLAVE, periodo: '2025-01' }, { fetcher, cfg: CFG }),
    (e) => e.fuente === true && e.status === 429 && /cuota/.test(e.message)
  );
});

test('apigateway.cl: un error de la fuente nunca revela la clave', async () => {
  const fetcher = fakeFetch(() => ({ status: 500, json: {} }));
  try {
    await descargarComprasVentas({ rut: RUT, password: CLAVE, periodo: '2025-01' }, { fetcher, cfg: CFG });
    assert.fail('debió lanzar');
  } catch (e) {
    assert.ok(!e.message.includes(CLAVE));
    assert.equal(e.fuente, true);
  }
});

test('apigateway.cl: sin APIGATEWAY_API_KEY el adaptador queda apagado', async () => {
  const fetcher = fakeFetch(porUrlCompleto);
  await assert.rejects(
    () => descargarComprasVentas({ rut: RUT, password: CLAVE, periodo: '2025-01' }, { fetcher, cfg: { ...CFG, enabled: false, key: '' } }),
    /no está configurado/
  );
});
