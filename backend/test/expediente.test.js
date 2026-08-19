import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { query, pool } from '../src/lib/db.js';
import { runMigrations } from '../src/lib/migrate.js';
import { EN_PRODUCCION, SALTO_PROD } from './util/soloDev.js';
import {
  coberturaDocumental, semaforoExpediente, estadoCobertura, brechasDe, scopePotencial,
  resumenExpediente, validarDocumento, pesoAsociacion, nivelRespaldo, estaRespaldado,
  ROLES_ESPERADOS_POR_TIPO, NO_ACREDITA, NOTA_SCOPE,
} from '../src/services/expediente.js';

// ============================================================
// El expediente de evidencia (migración 105).
//
// Lo que estos casos cuidan, en orden de importancia:
//
//  1. QUE EL GRIS NUNCA SE CONFUNDA CON VERDE. Un expediente sin
//     documentos esperados definidos NO tiene 0% ni 100%: no tiene
//     cobertura, y eso se dice con null. La tentación de devolver un
//     número cómodo ahí es exactamente el error que el semáforo de
//     pasaporteOrigen.js ya resolvió con el color gris.
//  2. QUE UN PRORRATEO NO SE CUENTE ENTERO. Una compra asociada al 15%
//     respalda 0,15 de su eje. Contarla como 1 infla la cobertura y es la
//     forma más fácil de que el producto prometa de más.
//  3. QUE LO QUE NO SE ACREDITA VIAJE SIEMPRE. Es la línea entre ordenar
//     evidencia y certificar.
// ============================================================

before(async () => { if (!EN_PRODUCCION) await runMigrations(); });
after(async () => { await pool.end(); });

const EXP_SUMINISTRO = {
  id: 'e1', tipo: 'suministro', cliente_nombre: 'Minera de Ejemplo',
  orden_compra: 'OC 12345', faena: 'Escondida', periodo: '2026-07', estado: 'abierto',
};

// Los 5 roles esperados de 'suministro', todos presentes y directos.
const DOCS_COMPLETOS = [
  { rol: 'venta_principal', asociacion: 'directa', porcentaje: 100, factura_id: 'f1', descripcion: 'Factura 1234' },
  { rol: 'orden_compra', asociacion: 'directa', porcentaje: 100, dte_proveedor_id: 'd0', descripcion: 'OC 12345' },
  { rol: 'guia', asociacion: 'directa', porcentaje: 100, dte_proveedor_id: 'd1', descripcion: 'Guía 88' },
  { rol: 'compra_relacionada', asociacion: 'directa', porcentaje: 100, dte_proveedor_id: 'd2', descripcion: 'Diésel' },
  { rol: 'ficha_tecnica', asociacion: 'directa', porcentaje: 100, dte_proveedor_id: 'd3', descripcion: 'Ficha' },
];

// ---------- 1. El gris ----------

test('sin roles esperados la cobertura es null, no 0 ni 100', () => {
  assert.equal(ROLES_ESPERADOS_POR_TIPO.otro.length, 0);
  assert.equal(coberturaDocumental('otro', DOCS_COMPLETOS), null);
  assert.equal(coberturaDocumental('otro', []), null);
});

test('el gris no se confunde con verde ni con rojo', () => {
  assert.equal(semaforoExpediente(null), 'gris');
  assert.equal(semaforoExpediente(undefined), 'gris');
  assert.equal(semaforoExpediente(100), 'verde');
  assert.equal(semaforoExpediente(0), 'rojo');
  assert.equal(semaforoExpediente(1), 'amarillo');
  // La afirmación que importa: gris NO es verde por ninguna vía.
  assert.notEqual(semaforoExpediente(null), semaforoExpediente(100));
  assert.equal(estadoCobertura(null), 'Sin evaluar');
  assert.notEqual(estadoCobertura(null), estadoCobertura(100));
});

test('un expediente tipo "otro" con todo cargado sigue diciendo "no se opina"', () => {
  const r = resumenExpediente({ ...EXP_SUMINISTRO, tipo: 'otro' }, DOCS_COMPLETOS);
  assert.equal(r.cobertura_documental, null);
  assert.equal(r.semaforo, 'gris');
  assert.equal(r.estado_cobertura, 'Sin evaluar');
  assert.equal(r.documentos_total, 5);   // los documentos SÍ se ven
});

// ---------- 2. La cobertura y los prorrateos ----------

test('todos los esperados presentes y directos = 100%', () => {
  assert.equal(coberturaDocumental('suministro', DOCS_COMPLETOS), 100);
  assert.equal(semaforoExpediente(100), 'verde');
});

test('un prorrateo aporta su proporción, no el eje entero', () => {
  assert.equal(pesoAsociacion({ asociacion: 'directa', porcentaje: 100 }), 1);
  assert.equal(pesoAsociacion({ asociacion: 'confirmada', porcentaje: 70 }), 0.7);
  assert.equal(pesoAsociacion({ asociacion: 'compartida', porcentaje: 15 }), 0.15);

  // Los 5 esperados presentes, pero dos parciales: 1+1+1+0,70+0,15 = 3,85
  // sobre 5 = 77%. Si un prorrateo se contara entero daría 100% y el
  // expediente diría "completo" apoyado en un 15%.
  const docs = DOCS_COMPLETOS.map((d, i) => (
    i === 3 ? { ...d, asociacion: 'confirmada', porcentaje: 70 }
      : i === 4 ? { ...d, asociacion: 'compartida', porcentaje: 15 } : d
  ));
  assert.equal(coberturaDocumental('suministro', docs), 77);
  assert.equal(semaforoExpediente(77), 'amarillo');
  assert.equal(estadoCobertura(77), 'Parcial');
});

test('un rol faltante baja la cobertura y aparece como brecha', () => {
  const docs = DOCS_COMPLETOS.filter((d) => d.rol !== 'guia');
  assert.equal(coberturaDocumental('suministro', docs), 80);   // 4 de 5
  const brechas = brechasDe(EXP_SUMINISTRO, docs);
  const falta = brechas.find((b) => b.codigo === 'falta_guia');
  assert.ok(falta, 'la guía faltante tiene que aparecer como brecha');
  assert.match(falta.detalle, /guía de despacho/i);
});

test('sin ningún documento la cobertura es 0 y el semáforo rojo', () => {
  assert.equal(coberturaDocumental('suministro', []), 0);
  assert.equal(semaforoExpediente(0), 'rojo');
  assert.equal(estadoCobertura(0), 'Sin respaldo');
});

test('el mejor documento de un rol manda, no el último ni el peor', () => {
  const docs = [
    { rol: 'venta_principal', asociacion: 'directa', porcentaje: 100, factura_id: 'f1', descripcion: 'v' },
    { rol: 'compra_relacionada', asociacion: 'compartida', porcentaje: 10, dte_proveedor_id: 'a', descripcion: 'a' },
    { rol: 'compra_relacionada', asociacion: 'directa', porcentaje: 100, dte_proveedor_id: 'b', descripcion: 'b' },
  ];
  // orden_compra, guia y ficha_tecnica faltan: 1 + 1 = 2 sobre 5 = 40%.
  assert.equal(coberturaDocumental('suministro', docs), 40);
});

// ---------- 3. Las brechas ----------

test('un documento declarado se registra, pero queda como brecha de nivel 1', () => {
  const docs = [
    ...DOCS_COMPLETOS.slice(0, 4),
    { rol: 'ficha_tecnica', asociacion: 'directa', porcentaje: 100, descripcion: 'Ficha del filtro' },
  ];
  assert.equal(estaRespaldado(docs[4]), false);
  assert.equal(nivelRespaldo(docs[4]), 1);
  const brechas = brechasDe(EXP_SUMINISTRO, docs);
  const declarado = brechas.find((b) => b.codigo === 'documento_declarado');
  assert.ok(declarado);
  assert.match(declarado.detalle, /nivel 1/);
  // Y aun así cuenta para la cobertura: existe, solo que sin respaldo.
  assert.equal(coberturaDocumental('suministro', docs), 100);
  const r = resumenExpediente(EXP_SUMINISTRO, docs);
  assert.equal(r.documentos_declarados, 1);
  assert.equal(r.documentos_respaldados, 4);
});

test('un prorrateo sin base declarada es una brecha', () => {
  const conBase = [{ ...DOCS_COMPLETOS[3], asociacion: 'compartida', porcentaje: 20, base_prorrateo: 'por horas máquina' }];
  const sinBase = [{ ...DOCS_COMPLETOS[3], asociacion: 'compartida', porcentaje: 20 }];
  assert.equal(brechasDe(EXP_SUMINISTRO, conBase).filter((b) => b.codigo === 'prorrateo_sin_base').length, 0);
  const b = brechasDe(EXP_SUMINISTRO, sinBase).find((x) => x.codigo === 'prorrateo_sin_base');
  assert.ok(b);
  assert.match(b.detalle, /20%/);
});

test('sin faena y sin orden de compra hay brechas propias', () => {
  const brechas = brechasDe({ tipo: 'servicio' }, []);
  assert.ok(brechas.find((b) => b.codigo === 'sin_faena'));
  assert.ok(brechas.find((b) => b.codigo === 'sin_orden_compra'));
  // Y ninguna de las dos con el expediente completo.
  const ok = brechasDe(EXP_SUMINISTRO, DOCS_COMPLETOS);
  assert.equal(ok.filter((b) => b.codigo === 'sin_faena').length, 0);
  assert.equal(ok.filter((b) => b.codigo === 'sin_orden_compra').length, 0);
});

// ---------- 4. El alcance es POTENCIAL, y la palabra está en el dato ----------

test('la clasificación de alcance se llama potencial en el nombre del campo', () => {
  const s = scopePotencial(EXP_SUMINISTRO);
  assert.equal(s.cliente.alcance_potencial, 3);
  assert.equal(s.cliente.categoria_potencial, 1);
  assert.match(s.cliente.nombre_categoria, /Bienes y servicios adquiridos/);
  // No existe un campo "alcance" a secas que se pueda leer como definitivo.
  assert.equal(s.cliente.alcance, undefined);
  assert.equal(s.cliente.categoria, undefined);
});

test('el transporte contratado cae en Categoría 4, no en la 1', () => {
  assert.equal(scopePotencial({ tipo: 'transporte' }).cliente.categoria_potencial, 4);
  assert.equal(scopePotencial({ tipo: 'arriendo' }).cliente.categoria_potencial, 8);
});

test('el alcance del proveedor NO se resuelve a nivel de expediente', () => {
  const s = scopePotencial(EXP_SUMINISTRO);
  assert.equal(s.proveedor.alcance_potencial, undefined);
  assert.match(s.proveedor.nota, /No se resuelve a nivel de expediente/i);
});

// ---------- 5. Lo que NO se acredita ----------

test('el resumen siempre lleva el bloque de no-afirmaciones', () => {
  for (const tipo of ['suministro', 'servicio', 'transporte', 'arriendo', 'otro']) {
    const r = resumenExpediente({ ...EXP_SUMINISTRO, tipo }, DOCS_COMPLETOS);
    assert.deepEqual(r.no_acredita, NO_ACREDITA);
    assert.equal(r.nota_scope, NOTA_SCOPE);
  }
});

test('las seis frases que el producto no promete están todas', () => {
  const junto = NO_ACREDITA.join(' ');
  assert.match(junto, /utilizado en la faena/i);
  assert.match(junto, /toda declaración del proveedor sea verdadera/i);
  assert.match(junto, /servicio se haya ejecutado correctamente/i);
  assert.match(junto, /cumplimiento ambiental/i);
  assert.match(junto, /No es una certificación/i);
  assert.match(junto, /no demuestra por sí sola entrega, uso ni desempeño/i);
  assert.match(NOTA_SCOPE, /no calcula las tCO₂e del cliente/i);
});

// ---------- 6. Validación ----------

test('una asociación directa con porcentaje distinto de 100 se rechaza', () => {
  const v = validarDocumento({ rol: 'guia', asociacion: 'directa', porcentaje: 60, descripcion: 'x' });
  assert.equal(v.ok, false);
  assert.match(v.error, /100% por definición/);
});

test('un prorrateo sin porcentaje se rechaza', () => {
  assert.equal(validarDocumento({ rol: 'guia', asociacion: 'compartida', descripcion: 'x' }).ok, false);
  assert.equal(validarDocumento({ rol: 'guia', asociacion: 'compartida', porcentaje: 0, descripcion: 'x' }).ok, false);
  assert.equal(validarDocumento({ rol: 'guia', asociacion: 'compartida', porcentaje: 120, descripcion: 'x' }).ok, false);
  assert.equal(validarDocumento({ rol: 'guia', asociacion: 'compartida', porcentaje: 15, descripcion: 'x' }).ok, true);
});

test('un documento no puede venir de una factura Y del RCV a la vez', () => {
  const v = validarDocumento({
    rol: 'guia', descripcion: 'x', factura_id: 'f1', dte_proveedor_id: 'd1',
  });
  assert.equal(v.ok, false);
  assert.match(v.error, /no de ambas/);
});

test('sin descripción legible no entra: un vínculo roto dejaría una fila muda', () => {
  assert.equal(validarDocumento({ rol: 'guia', descripcion: '   ' }).ok, false);
  assert.equal(validarDocumento({ rol: 'inventado', descripcion: 'x' }).ok, false);
});

// ---------- 7. El esquema que todo lo anterior asume ----------

test('las tablas y los índices de la migración 105 existen', { skip: SALTO_PROD }, async () => {
  const { rows: cols } = await query(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_name IN ('expedientes','expediente_documentos')`
  );
  const nombres = new Set(cols.map((c) => `${c.table_name}.${c.column_name}`));
  for (const c of ['expedientes.proveedor_id', 'expedientes.orden_compra', 'expedientes.faena',
    'expedientes.tipo', 'expediente_documentos.rol', 'expediente_documentos.asociacion',
    'expediente_documentos.porcentaje', 'expediente_documentos.base_prorrateo',
    'expediente_documentos.factura_id', 'expediente_documentos.dte_proveedor_id']) {
    assert.ok(nombres.has(c), `falta ${c}`);
  }
  const { rows: idx } = await query(
    `SELECT indexname FROM pg_indexes WHERE tablename = 'expediente_documentos'`
  );
  const nombresIdx = idx.map((i) => i.indexname);
  assert.ok(nombresIdx.includes('uq_expediente_venta_principal'));
});

test('un expediente no admite dos facturas de venta', { skip: SALTO_PROD }, async () => {
  // INSERT a secas, SIN ON CONFLICT DO UPDATE: si el RUT sintético
  // chocara con uno real en una base de desarrollo, el UPSERT lo
  // renombraría y el DELETE del final lo borraría en cascada con todo lo
  // suyo. Fallar ruidosamente es mucho mejor que eso.
  const { rows: prov } = await query(
    `INSERT INTO proveedores (nombre_empresa, rut) VALUES ('Expediente SpA', $1) RETURNING id`,
    [`77${Date.now().toString().slice(-7)}K`]
  );
  const { rows: exp } = await query(
    `INSERT INTO expedientes (proveedor_id, cliente_nombre, tipo)
     VALUES ($1, 'Minera de Ejemplo', 'suministro') RETURNING id`,
    [prov[0].id]
  );
  const insertarVenta = () => query(
    `INSERT INTO expediente_documentos (expediente_id, rol, descripcion)
     VALUES ($1, 'venta_principal', 'Factura 1234')`,
    [exp[0].id]
  );
  await insertarVenta();
  await assert.rejects(insertarVenta, (err) => err.code === '23505');

  // Pero varias compras relacionadas sí: la restricción es de la venta.
  await query(
    `INSERT INTO expediente_documentos (expediente_id, rol, descripcion)
     VALUES ($1, 'compra_relacionada', 'Diésel'), ($1, 'compra_relacionada', 'Peajes')`,
    [exp[0].id]
  );
  await query(`DELETE FROM proveedores WHERE id = $1`, [prov[0].id]);
});

test('el CHECK impide guardar "directa" con un porcentaje parcial', { skip: SALTO_PROD }, async () => {
  const { rows: prov } = await query(
    `INSERT INTO proveedores (nombre_empresa, rut) VALUES ('Check SpA', $1) RETURNING id`,
    [`78${Date.now().toString().slice(-7)}K`]
  );
  const { rows: exp } = await query(
    `INSERT INTO expedientes (proveedor_id, cliente_nombre) VALUES ($1, 'Cliente') RETURNING id`,
    [prov[0].id]
  );
  await assert.rejects(
    () => query(
      `INSERT INTO expediente_documentos (expediente_id, rol, asociacion, porcentaje, descripcion)
       VALUES ($1, 'guia', 'directa', 60, 'Guía')`,
      [exp[0].id]
    ),
    (err) => err.code === '23514'
  );
  await query(`DELETE FROM proveedores WHERE id = $1`, [prov[0].id]);
});
