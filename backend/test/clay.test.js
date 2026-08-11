import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIMITE_POR_HORA, MAX_LIMITE, TIPOS_SII,
  rutCompania, desenvolver, limitesDe, mensajeDeError, construirQuery,
  identidad, empresa, dtes, productosPorDocumento,
} from '../src/services/clay.js';

// Cabeceras falsas con la misma interfaz que las de fetch.
const cabeceras = (o) => ({ get: (k) => (k in o ? String(o[k]) : null) });

// ---------- RUT ----------

test('rutCompania deja el RUT sin puntos, sin guión y sin dígito verificador', () => {
  // La especificación de Clay se contradice: la convención general dice
  // "cualquier formato", pero /v2/obligations/* exige la forma estricta.
  // Se normaliza siempre a la estricta, que sirve para ambas.
  for (const entrada of ['76.570.751-K', '76570751-K', '76570751k', '76.570.751-k']) {
    assert.equal(rutCompania(entrada), '76570751', `falló con ${entrada}`);
  }
  assert.equal(rutCompania('9.876.543-2'), '9876543');
});

test('rutCompania rechaza lo que no es un RUT', () => {
  assert.throws(() => rutCompania(''), /RUT inválido/);
  assert.throws(() => rutCompania('.-'), /RUT inválido/);
  assert.throws(() => rutCompania(null), /RUT inválido/);
});

// ---------- envoltorio ----------

test('desenvolver tolera las dos formas que trae la especificación', () => {
  // Varios listados declaran su esquema de respuesta VACÍO, o sea sin
  // contrato: no se puede asumir el sobre { status, data }.
  assert.deepEqual(desenvolver({ status: true, data: [1, 2] }), [1, 2]);
  assert.deepEqual(desenvolver([1, 2]), [1, 2]);
  assert.deepEqual(desenvolver({ name: 'ACME' }), { name: 'ACME' });
  assert.equal(desenvolver(null), null);
});

test('desenvolver no confunde un data nulo con ausencia de sobre', () => {
  assert.equal(desenvolver({ status: true, data: null }), null);
});

// ---------- límites ----------

test('limitesDe lee las cabeceras de cuota y el id de request', () => {
  const l = limitesDe(cabeceras({
    'X-RateLimit-Limit': '1000', 'X-RateLimit-Remaining': '997',
    'X-RateLimit-Reset': '1785220000', 'X-Request-Id': 'req-abc',
  }));
  assert.deepEqual(l, { limite: 1000, restantes: 997, reinicia: 1785220000, requestId: 'req-abc' });
  assert.equal(LIMITE_POR_HORA, 1000);
});

test('limitesDe devuelve null en vez de NaN cuando falta una cabecera', () => {
  const l = limitesDe(cabeceras({}));
  assert.deepEqual(l, { limite: null, restantes: null, reinicia: null, requestId: null });
  // Cero restantes es un dato válido, no un vacío.
  assert.equal(limitesDe(cabeceras({ 'X-RateLimit-Remaining': '0' })).restantes, 0);
});

// ---------- errores ----------

test('los errores se traducen a algo accionable para el operador', () => {
  assert.match(mensajeDeError(401, {}), /token/i);
  assert.match(mensajeDeError(403, {}), /token/i);
  assert.match(mensajeDeError(404, {}), /no encontró/i);
  assert.match(mensajeDeError(429, {}), /1000|1\.000/);
  assert.match(mensajeDeError(500, { detail: 'boom' }), /500.*boom/);
});

test('un 422 explica qué parámetro rechazó Clay', () => {
  const msg = mensajeDeError(422, { detail: [{ loc: ['query', 'date_from'], msg: 'field required', type: 'x' }] });
  assert.match(msg, /field required/);
  assert.match(mensajeDeError(422, {}), /parámetros/);
});

// ---------- query ----------

test('construirQuery descarta lo que no se mandó', () => {
  // Sin esto un `undefined` viaja como el string "undefined" y la API
  // responde 422.
  const q = construirQuery({ company_rut: '76570751', is_received: undefined, date_to: null, search: '', limit: 100 });
  assert.equal(q, 'company_rut=76570751&limit=100');
});

test('construirQuery conserva false y cero, que son valores reales', () => {
  const q = construirQuery({ is_received: false, offset: 0 });
  assert.equal(q, 'is_received=false&offset=0');
});

// ---------- llamadas ----------

test('ninguna llamada sale a la red con la integración apagada', async () => {
  const explota = () => { throw new Error('no debió llamarse'); };
  for (const fn of [
    () => identidad({ fetchImpl: explota }),
    () => empresa('76570751-K', { fetchImpl: explota }),
    () => dtes({ rut: '76570751-K' }, { fetchImpl: explota }),
  ]) {
    await assert.rejects(fn, /apagado/);
  }
});

test('productosPorDocumento exige date_from antes de intentar nada', () => {
  // Es obligatorio en esa ruta: mejor fallar acá que gastar una de las
  // 1.000 solicitudes por hora en un 422 seguro.
  assert.throws(() => productosPorDocumento({ rut: '76570751-K' }), /desde/);
});

test('los códigos SII documentados están completos', () => {
  assert.equal(TIPOS_SII[33], 'Factura Electrónica');
  assert.equal(TIPOS_SII[61], 'Nota de Crédito Electrónica');
  assert.equal(TIPOS_SII[52], 'Guía de Despacho Electrónica');
  assert.equal(MAX_LIMITE, 500);
});
