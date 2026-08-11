import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarCredencialesSii, descargarComprasVentas, proveedorSiiActivo } from '../src/services/siiProveedor.js';

// El selector debe despachar al adaptador PEDIDO — el bug real fue una ruta
// que importaba baseapiSii.js directo: con SII_PROVEEDOR=simpleapi el
// guardado de credenciales validaba contra el proveedor equivocado.
// Cada adaptador se distingue por la forma del request que emite:
//   baseapi    → header X-API-Key, body { rut, password }
//   simpleapi  → header Authorization (a secas), body { RutUsuario, PasswordSII }
//   apigateway → header Authorization 'Token …', body { auth: { pass: … } }
const RUT = '78345120-4'; // RUT sintético válido (módulo 11)
const CLAVE = 'clave_sii_secreta_del_contribuyente';

function fetcherCapturador(capturas) {
  return async (url, opts) => {
    capturas.push({ url, headers: opts.headers, body: opts.body });
    // Respuesta 200 mínima que todos los adaptadores aceptan como "válido".
    return { ok: true, status: 200, json: async () => ({ success: true, data: { datos: { codigoError: 0 } } }) };
  };
}

const CFG = { enabled: true, key: 'apikey-de-prueba', base: 'https://sii.invalido', timeoutMs: 2000 };

test('sin proveedor indicado despacha a baseapi (el default)', async () => {
  const capturas = [];
  await validarCredencialesSii({ rut: RUT, password: CLAVE }, { fetcher: fetcherCapturador(capturas), cfg: CFG });
  assert.equal(capturas.length, 1);
  assert.equal(capturas[0].headers['X-API-Key'], CFG.key);
  const body = JSON.parse(capturas[0].body);
  assert.equal(body.password, CLAVE);
  assert.match(capturas[0].url, /\/sii\/auth\/validar$/);
});

test('proveedor=simpleapi despacha a SimpleAPI (RutUsuario/PasswordSII)', async () => {
  const capturas = [];
  await validarCredencialesSii({ rut: RUT, password: CLAVE }, { proveedor: 'simpleapi', fetcher: fetcherCapturador(capturas), cfg: CFG });
  assert.equal(capturas.length, 1);
  assert.equal(capturas[0].headers.Authorization, CFG.key);
  const body = JSON.parse(capturas[0].body);
  assert.equal(body.PasswordSII, CLAVE);
  assert.equal(body.RutUsuario, RUT);
  assert.match(capturas[0].url, /\/rcv\/compra$/);
});

test('proveedor=apigateway despacha a apigateway.cl (auth.pass + Token)', async () => {
  const capturas = [];
  await validarCredencialesSii({ rut: RUT, password: CLAVE }, { proveedor: 'apigateway', fetcher: fetcherCapturador(capturas), cfg: CFG });
  assert.equal(capturas.length, 1);
  assert.equal(capturas[0].headers.Authorization, `Token ${CFG.key}`);
  const body = JSON.parse(capturas[0].body);
  assert.equal(body.auth.pass.clave, CLAVE);
  assert.match(capturas[0].url, /\/misii\/contribuyente\/datos$/);
});

test('descargarComprasVentas también respeta el proveedor pedido', async () => {
  const capturas = [];
  await descargarComprasVentas(
    { rut: RUT, password: CLAVE, periodo: '2025-01' },
    { proveedor: 'simpleapi', fetcher: fetcherCapturador(capturas), cfg: CFG }
  );
  // SimpleAPI hace 2 llamadas (/rcv/compra y /rcv/venta), todas con su forma.
  assert.ok(capturas.length >= 2);
  for (const c of capturas) {
    assert.equal(c.headers.Authorization, CFG.key);
    assert.ok(JSON.parse(c.body).PasswordSII, 'el body debe ser el de SimpleAPI');
  }
});

test('proveedorSiiActivo informa la capacidad de detalle según el proveedor', () => {
  assert.equal(proveedorSiiActivo().puede_traer_detalle, true); // baseapi default
  assert.equal(proveedorSiiActivo({ proveedor: 'simpleapi' }).puede_traer_detalle, false);
  assert.equal(proveedorSiiActivo({ proveedor: 'apigateway' }).puede_traer_detalle, false);
});
