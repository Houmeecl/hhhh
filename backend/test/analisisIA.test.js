import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarRespuestaIA, analisisIA } from '../src/services/analisisIA.js';

// ============================================================
// Validación de la respuesta de la IA — SIN red: analisisIA.analizarTexto
// llama a la API real de Anthropic, que este entorno de pruebas no puede
// alcanzar (ni debe: la suite no depende de una clave ni de conectividad).
// Lo que SÍ se puede y se DEBE testear sin red:
//  1) el validador puro (validarRespuestaIA) contra respuestas hechas a
//     mano, válidas e inválidas — es la barrera que decide si se confía
//     o no en lo que devolvió el modelo;
//  2) que analizarTexto() se apaga solo (devuelve null) cuando no hay
//     ANTHROPIC_API_KEY — el estado real de este entorno y de cualquier
//     despliegue que no la configure — para que lecturaDocumento.js caiga
//     al parser de reglas exactamente como si la IA no existiera.
// La integración completa (IA disponible → lecturaDocumento la usa) se
// prueba con un stub inyectado en lecturaDocumento.test.js, no aquí.
// ============================================================

test('validarRespuestaIA acepta una respuesta bien formada (factura)', () => {
  const r = validarRespuestaIA({
    tipo_documento: 'factura',
    folio: '4521',
    rut_emisor: '76123456-0',
    rut_receptor: '11111111-1',
    fecha: '2026-06-15',
    monto_total: 450000,
    items: [{ nombre: 'Suministro eléctrico', cantidad: 500, unidad: 'kWh', monto: 450000 }],
  });
  assert.equal(r.tipo_documento, 'factura');
  assert.equal(r.monto_total, 450000);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].nombre, 'Suministro eléctrico');
});

test('validarRespuestaIA acepta un tipo no calculable (orden de compra)', () => {
  const r = validarRespuestaIA({ tipo_documento: 'orden_compra', monto_total: 0, items: [] });
  assert.equal(r.tipo_documento, 'orden_compra');
});

test('validarRespuestaIA rechaza un tipo_documento fuera del enum (nunca se confía en un valor inventado)', () => {
  assert.equal(validarRespuestaIA({ tipo_documento: 'contrato', monto_total: 0, items: [] }), null);
  assert.equal(validarRespuestaIA({ tipo_documento: '', monto_total: 0, items: [] }), null);
});

test('validarRespuestaIA rechaza monto_total no numérico, negativo, o items que no es array', () => {
  assert.equal(validarRespuestaIA({ tipo_documento: 'factura', monto_total: 'mucho', items: [] }), null);
  assert.equal(validarRespuestaIA({ tipo_documento: 'factura', monto_total: -100, items: [] }), null);
  assert.equal(validarRespuestaIA({ tipo_documento: 'factura', monto_total: 100, items: 'no es array' }), null);
});

test('validarRespuestaIA rechaza entradas nulas/no-objeto sin lanzar', () => {
  assert.equal(validarRespuestaIA(null), null);
  assert.equal(validarRespuestaIA(undefined), null);
  assert.equal(validarRespuestaIA('texto'), null);
  assert.equal(validarRespuestaIA(42), null);
});

test('validarRespuestaIA descarta ítems individuales inválidos sin descartar todo el documento', () => {
  const r = validarRespuestaIA({
    tipo_documento: 'factura',
    monto_total: 100000,
    items: [
      { nombre: 'Ítem válido', monto: 100000 },
      { nombre: '', monto: 5000 }, // nombre vacío → descartado
      { monto: 5000 }, // sin nombre → descartado
      { nombre: 'Monto no numérico', monto: 'mucho' }, // descartado
    ],
  });
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].nombre, 'Ítem válido');
});

test('validarRespuestaIA usa cantidad=1 por defecto cuando la IA no la reporta', () => {
  const r = validarRespuestaIA({
    tipo_documento: 'factura',
    monto_total: 50000,
    items: [{ nombre: 'Servicio', monto: 50000 }],
  });
  assert.equal(r.items[0].cantidad, 1);
});

test('analisisIA.analizarTexto() se apaga solo sin ANTHROPIC_API_KEY (estado real de este entorno)', async () => {
  // No se configura la clave en la suite (ni debe) — confirma el default
  // seguro: lecturaDocumento.js cae al parser de reglas sin más.
  assert.equal(analisisIA.enabled, false);
  const r = await analisisIA.analizarTexto('FACTURA ELECTRONICA N° 1\nServicio $ 10.000');
  assert.equal(r, null);
});

test('analisisIA.analizarTexto() devuelve null con texto vacío, sin llamar a nada', async () => {
  assert.equal(await analisisIA.analizarTexto(''), null);
  assert.equal(await analisisIA.analizarTexto(null), null);
});
