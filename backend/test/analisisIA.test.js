import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarRespuestaIA, validarRespuestaEmbalaje, analisisIA } from '../src/services/analisisIA.js';
import { validarComponentes } from '../src/services/rep.js';

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

test('analisisIA.analizarTexto() nunca lanza: sin clave configurada se apaga sola; con una clave sin crédito/ inválida, la llamada real falla y igual devuelve null', async () => {
  // Esta suite NO configura ANTHROPIC_API_KEY (ni debe: nunca hay secretos
  // reales en CI) — el caso normal es enabled=false. Si alguien corre la
  // suite localmente con una clave real en backend/.env (ej. para probar
  // en vivo), el comportamiento observable que de verdad importa sigue
  // sosteniéndose: la llamada nunca lanza y analizarTexto() cae a null de
  // forma segura — lecturaDocumento.js cae al parser de reglas sin más.
  if (!analisisIA.enabled) {
    const r = await analisisIA.analizarTexto('FACTURA ELECTRONICA N° 1\nServicio $ 10.000');
    assert.equal(r, null);
  } else {
    await assert.doesNotReject(analisisIA.analizarTexto('FACTURA ELECTRONICA N° 1\nServicio $ 10.000'));
  }
});

test('analisisIA.analizarTexto() devuelve null con texto vacío, sin llamar a nada', async () => {
  assert.equal(await analisisIA.analizarTexto(''), null);
  assert.equal(await analisisIA.analizarTexto(null), null);
});

// ---------- Estimación de embalaje REP por foto ----------

test('validarRespuestaEmbalaje: propuesta válida queda lista para el formulario Y pasa validarComponentes de rep.js', () => {
  const r = validarRespuestaEmbalaje({
    foto_valida: true,
    componentes: [
      { material: 'vidrio', peso_gr: 300.55, cantidad: 1, reciclable: true },
      { material: 'metales', peso_gr: 2, cantidad: 1, reciclable: true },
      { material: 'papel_carton', peso_gr: 5, cantidad: 1, reciclable: true },
    ],
  });
  assert.equal(r.fotoValida, true);
  assert.equal(r.componentes.length, 3);
  assert.equal(r.componentes[0].peso_gr, 300.6); // redondeado a 1 decimal
  // La propuesta debe ser directamente guardable: misma barrera del servidor.
  assert.equal(validarComponentes(r.componentes).ok, true);
});

test('validarRespuestaEmbalaje: descarta materiales fuera de la taxonomía REP, pesos/cantidades inválidos', () => {
  const r = validarRespuestaEmbalaje({
    foto_valida: true,
    componentes: [
      { material: 'pet', peso_gr: 25, cantidad: 1, reciclable: true },       // taxonomía del JUEGO, no REP → fuera
      { material: 'plasticos', peso_gr: 0, cantidad: 1, reciclable: true },  // peso 0 → fuera
      { material: 'plasticos', peso_gr: -5, cantidad: 1, reciclable: true }, // negativo → fuera
      { material: 'vidrio', peso_gr: 300, cantidad: 0, reciclable: true },   // cantidad 0 → fuera
      { material: 'vidrio', peso_gr: 300, cantidad: 1.5, reciclable: true }, // no entero → fuera
      { material: 'compuestos', peso_gr: 30, cantidad: 2, reciclable: false }, // válido
    ],
  });
  assert.equal(r.componentes.length, 1);
  assert.equal(r.componentes[0].material, 'compuestos');
  assert.equal(r.componentes[0].reciclable, false);
});

test('validarRespuestaEmbalaje: esquema inválido devuelve null; foto_valida=false conserva el aviso', () => {
  assert.equal(validarRespuestaEmbalaje(null), null);
  assert.equal(validarRespuestaEmbalaje({ componentes: [] }), null);
  assert.equal(validarRespuestaEmbalaje({ foto_valida: 'si', componentes: [] }), null);
  const r = validarRespuestaEmbalaje({ foto_valida: false, componentes: [] });
  assert.equal(r.fotoValida, false);
  assert.equal(r.componentes.length, 0);
});

test('analisisIA.estimarEmbalaje: sin IA configurada devuelve null (el formulario manual sigue); media type raro también', async () => {
  if (!analisisIA.enabled) {
    assert.equal(await analisisIA.estimarEmbalaje({ imagenBase64: 'x', mediaType: 'image/jpeg' }), null);
  }
  assert.equal(await analisisIA.estimarEmbalaje({ imagenBase64: 'x', mediaType: 'image/gif' }), null);
  assert.equal(await analisisIA.estimarEmbalaje({ imagenBase64: '', mediaType: 'image/jpeg' }), null);
});
