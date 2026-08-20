import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CUALQUIER_PAIS, puntosDelTramo, crucesDelTramo, exigenciasDelTramo,
  estadoDocumentalTramo, semaforoTramo, glosaTramo, etiquetaDocumento,
} from '../src/services/corredorTramo.js';

// ============================================================
// El tramo como primera clase. Antes el semáforo documental usaba UNA
// lista para toda carga: le decía a todos que les faltaba lo mismo, y
// por lo tanto no le decía nada a nadie.
// ============================================================

const PUNTOS = [
  { id: 'campo-grande', pais: 'BR', orden: 0 },
  { id: 'ponta-pora', pais: 'BR', orden: 1, es_frontera: true },
  { id: 'loma-plata', pais: 'PY', orden: 2 },
  { id: 'pozo-hondo', pais: 'PY', orden: 4, es_frontera: true },
  { id: 'tartagal', pais: 'AR', orden: 5 },
  { id: 'paso-de-jama', pais: 'AR', orden: 8, es_frontera: true },
  { id: 'calama', pais: 'CL', orden: 10 },
  { id: 'puerto-antofagasta', pais: 'CL', orden: 12 },
];

const REGLAS = [
  { pais_desde: '*', pais_hasta: '*', tipo_documento: 'factura_comercial', obligatorio: true, nota: 'a' },
  { pais_desde: '*', pais_hasta: '*', tipo_documento: 'packing_list', obligatorio: false, nota: 'b' },
  { pais_desde: 'BR', pais_hasta: 'PY', tipo_documento: 'certificado_fitosanitario', obligatorio: true, nota: 'c' },
  { pais_desde: 'AR', pais_hasta: 'CL', tipo_documento: 'certificado_fitosanitario', obligatorio: false, nota: 'd' },
  { pais_desde: 'AR', pais_hasta: 'CL', tipo_documento: 'declaracion_jurada_origen', obligatorio: true, nota: 'e' },
];

test('el tramo son los puntos entre origen y destino, en orden', () => {
  const t = puntosDelTramo(PUNTOS, 'loma-plata', 'calama');
  assert.deepEqual(t.map((p) => p.id), ['loma-plata', 'pozo-hondo', 'tartagal', 'paso-de-jama', 'calama']);
});

test('un tramo al revés se devuelve al revés', () => {
  // El orden del catálogo es el del corredor, no el de esta carga: hay
  // cargas que van de Chile hacia el Atlántico.
  const t = puntosDelTramo(PUNTOS, 'calama', 'loma-plata');
  assert.deepEqual(t.map((p) => p.id), ['calama', 'paso-de-jama', 'tartagal', 'pozo-hondo', 'loma-plata']);
  assert.deepEqual(crucesDelTramo(t).map((c) => `${c.pais_desde}${c.pais_hasta}`), ['CLAR', 'ARPY']);
});

test('un punto que no está en el catálogo no arma medio tramo', () => {
  assert.deepEqual(puntosDelTramo(PUNTOS, 'campo-grande', 'inventado'), []);
  assert.deepEqual(puntosDelTramo(PUNTOS, null, 'calama'), []);
  assert.deepEqual(puntosDelTramo([], 'campo-grande', 'calama'), []);
});

test('los cruces son los cambios de país, sin repetir', () => {
  const cruces = crucesDelTramo(puntosDelTramo(PUNTOS, 'campo-grande', 'puerto-antofagasta'));
  assert.deepEqual(cruces.map((c) => `${c.pais_desde}→${c.pais_hasta}`), ['BR→PY', 'PY→AR', 'AR→CL']);
});

test('un tramo dentro de un mismo país no tiene cruces, y eso no es un error', () => {
  assert.deepEqual(crucesDelTramo(puntosDelTramo(PUNTOS, 'calama', 'puerto-antofagasta')), []);
});

test('cada cruce suma sus documentos; el comodín aplica siempre', () => {
  const cruces = crucesDelTramo(puntosDelTramo(PUNTOS, 'campo-grande', 'puerto-antofagasta'));
  const ex = exigenciasDelTramo(cruces, REGLAS);
  assert.deepEqual(
    ex.map((e) => e.tipo_documento).sort(),
    ['certificado_fitosanitario', 'declaracion_jurada_origen', 'factura_comercial', 'packing_list']
  );
  // Los obligatorios van primero: la pantalla imprime esta lista tal cual.
  assert.ok(ex.slice(0, 3).every((e) => e.obligatorio));
  assert.equal(ex.at(-1).tipo_documento, 'packing_list');
});

test('si un cruce lo exige y otro no, queda exigido', () => {
  // El fitosanitario es obligatorio en BR→PY y opcional en AR→CL. Rebajarlo
  // porque el último cruce lo pide suelto sería quedarse con la exigencia
  // más floja de las dos.
  const cruces = crucesDelTramo(puntosDelTramo(PUNTOS, 'campo-grande', 'puerto-antofagasta'));
  const fito = exigenciasDelTramo(cruces, REGLAS).find((e) => e.tipo_documento === 'certificado_fitosanitario');
  assert.equal(fito.obligatorio, true);
  assert.deepEqual(fito.por, ['BR→PY', 'AR→CL']);
});

test('lo que se pide por exportar NO se le atribuye a un cruce', () => {
  // La factura comercial no la exige el paso BR→PY. Decir que sí confunde
  // a quien la tenga que conseguir.
  const cruces = crucesDelTramo(puntosDelTramo(PUNTOS, 'campo-grande', 'puerto-antofagasta'));
  const factura = exigenciasDelTramo(cruces, REGLAS).find((e) => e.tipo_documento === 'factura_comercial');
  assert.deepEqual(factura.por, ['exportación']);
});

test('un tramo nacional igual pide lo que se pide por exportar', () => {
  const ex = exigenciasDelTramo([], REGLAS);
  assert.deepEqual(ex.map((e) => e.tipo_documento), ['factura_comercial', 'packing_list']);
  assert.deepEqual(ex[0].por, ['exportación']);
});

test('el comodín es literalmente ese', () => {
  assert.equal(CUALQUIER_PAIS, '*');
});

// ---------- Estado documental ----------

const exigenciasCompletas = () =>
  exigenciasDelTramo(crucesDelTramo(puntosDelTramo(PUNTOS, 'campo-grande', 'puerto-antofagasta')), REGLAS);

test('sin tramo definido no se opina: gris y listo null', () => {
  const e = estadoDocumentalTramo({ tramoDefinido: false, exigencias: [], documentos: [] });
  assert.equal(e.listo, null);
  assert.equal(semaforoTramo(e), 'gris');
  assert.match(glosaTramo(e), /Falta definir el tramo/);
});

test('con tramo y sin ningún documento: rojo', () => {
  const e = estadoDocumentalTramo({ tramoDefinido: true, exigencias: exigenciasCompletas(), documentos: [] });
  assert.equal(e.listo, false);
  assert.equal(e.cumplidos, 0);
  assert.equal(semaforoTramo(e), 'rojo');
  assert.match(glosaTramo(e), /Faltan 3 documentos obligatorios/);
});

test('con parte de los obligatorios: amarillo', () => {
  const e = estadoDocumentalTramo({
    tramoDefinido: true, exigencias: exigenciasCompletas(),
    documentos: [{ tipo_documento: 'factura_comercial', estado: 'leido' }],
  });
  assert.equal(semaforoTramo(e), 'amarillo');
  assert.equal(e.cumplidos, 1);
  assert.deepEqual(e.faltantes.sort(), ['certificado_fitosanitario', 'declaracion_jurada_origen']);
});

test('con todos los obligatorios: verde, y el opcional se declara aparte', () => {
  const e = estadoDocumentalTramo({
    tramoDefinido: true, exigencias: exigenciasCompletas(),
    documentos: [
      { tipo_documento: 'factura_comercial' },
      { tipo_documento: 'certificado_fitosanitario' },
      { tipo_documento: 'declaracion_jurada_origen' },
    ],
  });
  assert.equal(e.listo, true);
  assert.equal(semaforoTramo(e), 'verde');
  assert.deepEqual(e.opcionales_faltantes, ['packing_list']);
  assert.match(glosaTramo(e), /Quedan 1 opcionales/);
});

test('un documento rechazado no cuenta como entregado', () => {
  const e = estadoDocumentalTramo({
    tramoDefinido: true, exigencias: exigenciasCompletas(),
    documentos: [{ tipo_documento: 'factura_comercial', estado: 'rechazado' }],
  });
  assert.equal(e.cumplidos, 0);
  assert.ok(e.faltantes.includes('factura_comercial'));
});

// El nombre legible vive en el backend, no en el frontend: el PDF y la
// pantalla tienen que llamarle igual al mismo papel, y dos mapas se
// separan solos.
test('cada exigencia trae su nombre legible', () => {
  const ex = exigenciasDelTramo([], REGLAS);
  assert.equal(ex.find((e) => e.tipo_documento === 'factura_comercial').etiqueta, 'Factura comercial');
});

test('un tipo que no está en el mapa se muestra legible, no vacío', () => {
  // `documentos_por_tramo` se puede editar: un tipo nuevo no puede quedar
  // sin nombre en la pantalla hasta que alguien toque el código.
  assert.equal(etiquetaDocumento('certificado_inventado'), 'Certificado inventado');
  assert.equal(etiquetaDocumento(null), '—');
});

// ---------- El orden del catálogo: null no es 0, y puede repetirse ----------

test('un punto sin orden no se cuela en el tramo como si fuera el primero', () => {
  // `Number(null)` es 0, así que un punto sin orden se colaba al comienzo
  // del corredor y, si además está en otro país, INVENTABA un cruce de
  // frontera — y con él documentos que esta carga no tiene por qué
  // conseguir. Mismo error que `Number(null) === 0` con una coordenada:
  // un dato que parece bueno porque se le perdió el contexto.
  const conNulo = [...PUNTOS, { id: 'sin-orden', pais: 'CL', orden: null }];
  const t = puntosDelTramo(conNulo, 'campo-grande', 'loma-plata');
  assert.deepEqual(t.map((p) => p.id), ['campo-grande', 'ponta-pora', 'loma-plata']);
  assert.deepEqual(crucesDelTramo(t).map((c) => `${c.pais_desde}${c.pais_hasta}`), ['BRPY']);
});

test('un punto sin orden tampoco puede ser el origen: no se sabe dónde va', () => {
  const conNulo = [...PUNTOS, { id: 'sin-orden', pais: 'CL', orden: null }];
  assert.deepEqual(puntosDelTramo(conNulo, 'sin-orden', 'calama'), []);
  assert.deepEqual(puntosDelTramo([...PUNTOS, { id: 'raro', pais: 'CL', orden: 'ocho' }], 'raro', 'calama'), []);
});

test('con dos puntos del mismo orden, el tramo igual empieza en el origen', () => {
  // El orden no es único en la tabla. Con un empate, el tramo se ordenaba
  // como viniera la lista y podía devolver el DESTINO primero: los cruces
  // salían al revés y el semáforo pedía los documentos del sentido
  // contrario.
  const dup = [...PUNTOS, { id: 'calama-anexo', pais: 'CL', orden: 10 }];
  const t = puntosDelTramo(dup, 'calama-anexo', 'calama');
  assert.equal(t[0].id, 'calama-anexo');
  assert.equal(t[t.length - 1].id, 'calama');
});

test('un empate de orden no rompe el tramo largo: sigue empezando y terminando donde debe', () => {
  const dup = [...PUNTOS, { id: 'tartagal-anexo', pais: 'AR', orden: 5 }];
  const t = puntosDelTramo(dup, 'campo-grande', 'calama');
  assert.equal(t[0].id, 'campo-grande');
  assert.equal(t[t.length - 1].id, 'calama');
  assert.deepEqual(crucesDelTramo(t).map((c) => `${c.pais_desde}${c.pais_hasta}`), ['BRPY', 'PYAR', 'ARCL']);
});
