import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { query, pool } from '../src/lib/db.js';
import { runMigrations } from '../src/lib/migrate.js';
import { EN_PRODUCCION, SALTO_PROD } from './util/soloDev.js';
import {
  verificarConsistencia, nivelConfianza, nivelRespaldo, resumenDato,
  categoriaPotencialDeDato, CATEGORIA_AGUAS_ABAJO, NOMBRE_NIVEL_CONFIANZA,
  TOLERANCIA_CANTIDAD, ETAPAS_AGUAS_ABAJO,
} from '../src/services/expediente.js';

// ============================================================
// El dato trazable (migración 106).
//
// La unidad de registro deja de ser el documento y pasa a ser la
// CANTIDAD: «50 filtros industriales correspondientes a la OC 12345 y
// factura 1234». 50 es el dato; la factura es su respaldo.
//
// Lo que estos casos protegen, en orden:
//
//  1. QUE NINGÚN CAMINO DEVUELVA EL NIVEL 5. «Revisado externamente»
//     necesita un rol de auditor que no existe. Emitirlo sería declarar
//     una revisión que nadie hizo — la mentira más cara que este producto
//     podría contar.
//  2. QUE UN DESACUERDO NO SE CORRIJA SOLO. Si la factura dice 50 y la
//     guía dice 48, elegir uno sería inventar evidencia. El hallazgo ES
//     el producto.
//  3. QUE LA VALIDACIÓN NO TAPE UNA CONTRADICCIÓN. Un dato con documentos
//     que se contradicen no llega a «validado en fuente» por mucho que
//     alguien lo haya contrastado.
//  4. QUE `consistente` TENGA TRES ESTADOS. null («no había con qué
//     comparar») no es false («se comparó y no coinciden»), igual que el
//     gris de la cobertura no es rojo.
// ============================================================

before(async () => { if (!EN_PRODUCCION) await runMigrations(); });
after(async () => { await pool.end(); });

const DATO = { cantidad: 50, unidad: 'unidad', producto: 'Filtros industriales', periodo: '2026-07' };
const FACTURA = {
  rol: 'venta_principal', descripcion: 'Factura 1234', factura_id: 'f1',
  cantidad: 50, unidad: 'unidad', fecha: '2026-07-10', folio: '1234', emisor_rut: '76520943',
};
const GUIA = {
  rol: 'guia', descripcion: 'Guía 4567', dte_proveedor_id: 'd1',
  cantidad: 50, unidad: 'unidad', fecha: '2026-07-09', folio: '4567', emisor_rut: '76520943',
};

// ---------- 1. El nivel 5 no existe ----------

test('ningún camino de nivelConfianza llega a 5', () => {
  const variantes = [
    [DATO, []],
    [DATO, [FACTURA]],
    [DATO, [FACTURA, GUIA]],
    [{ ...DATO, validado_por: 'Jefa', validado_fuente: 'sii', validado_at: new Date() }, [FACTURA, GUIA]],
    [{ ...DATO, validado_por: 'Auditor', validado_fuente: 'certificador', validado_at: new Date() }, [FACTURA, GUIA]],
    // Y el intento directo: pedir 5 a mano no lo concede.
    [{ ...DATO, nivel_confianza: 5 }, [FACTURA, GUIA]],
  ];
  for (const [d, docs] of variantes) {
    const n = nivelConfianza(d, docs);
    assert.ok(n >= 1 && n <= 4, `nivelConfianza devolvió ${n}`);
    assert.notEqual(n, 5);
  }
  // El nombre del 5 existe (para el día que exista el rol de auditor),
  // pero nadie lo emite.
  assert.equal(NOMBRE_NIVEL_CONFIANZA[5], 'Revisado externamente');
});

test('nivelRespaldo de un documento suelto no pasa de 2', () => {
  // LA CORRECCIÓN: antes devolvía 3 con solo tener factura_id. El nivel 3
  // es «los documentos relacionados coinciden» — una propiedad ENTRE
  // documentos. Uno solo no puede coincidir con nadie.
  assert.equal(nivelRespaldo({ rol: 'guia', descripcion: 'x' }), 1);
  assert.equal(nivelRespaldo({ factura_id: 'f1' }), 2);
  assert.equal(nivelRespaldo({ dte_proveedor_id: 'd1' }), 2);
  assert.equal(nivelRespaldo({ factura_id: 'f1', sha256_verificado: true }), 2);
  assert.equal(nivelRespaldo(null), 0);
});

// ---------- 2. El desacuerdo se registra, no se corrige ----------

test('una cantidad distinta entre factura y guía queda como desacuerdo', () => {
  const r = verificarConsistencia(DATO, [FACTURA, { ...GUIA, cantidad: 48 }]);
  assert.equal(r.consistente, false);
  const d = r.desacuerdos.find((x) => x.campo === 'cantidad');
  assert.ok(d, 'el desacuerdo de cantidad tiene que aparecer');
  // Los DOS valores quedan a la vista: no se elige uno.
  const valores = d.valores.map((v) => v.valor);
  assert.ok(valores.includes(50) && valores.includes(48));
  assert.match(d.detalle, /48/);
  assert.match(d.detalle, /50/);
  // Y el nivel baja a 2: documentado, pero no consistente.
  assert.equal(nivelConfianza(DATO, [FACTURA, { ...GUIA, cantidad: 48 }]), 2);
});

test('la tolerancia cubre el redondeo, no una diferencia real', () => {
  assert.equal(TOLERANCIA_CANTIDAD, 0.5);
  // 50 vs 49.9 = 0,2% — redondeo, pasa.
  assert.equal(verificarConsistencia(DATO, [FACTURA, { ...GUIA, cantidad: 49.9 }]).consistente, true);
  // 50 vs 49 = 2% — diferencia real, no pasa.
  assert.equal(verificarConsistencia(DATO, [FACTURA, { ...GUIA, cantidad: 49 }]).consistente, false);
});

test('unidades distintas no se convierten: se reportan como incomparables', () => {
  // 50 unidades contra 48 kilos NO es un desacuerdo de cantidad; es una
  // comparación imposible. Convertir por nuestra cuenta sería inventar un
  // factor que nadie declaró.
  const r = verificarConsistencia(DATO, [FACTURA, { ...GUIA, cantidad: 48, unidad: 'kg' }]);
  assert.equal(r.consistente, false);
  assert.ok(r.desacuerdos.find((x) => x.campo === 'unidad'));
  assert.equal(r.desacuerdos.filter((x) => x.campo === 'cantidad').length, 0);
  assert.match(r.desacuerdos[0].detalle, /factor de conversión/i);
});

test('un documento fuera del período del expediente se advierte', () => {
  const r = verificarConsistencia(DATO, [FACTURA, { ...GUIA, fecha: '2026-01-05' }]);
  assert.equal(r.consistente, false);
  const d = r.desacuerdos.find((x) => x.campo === 'fecha');
  assert.ok(d);
  assert.match(d.detalle, /2026-07/);
});

test('el mismo folio con dos emisores distintos es un hallazgo', () => {
  const r = verificarConsistencia(DATO, [
    FACTURA,
    { ...GUIA, folio: '1234', emisor_rut: '99999999' },
  ]);
  const d = r.desacuerdos.find((x) => x.campo === 'folio');
  assert.ok(d, 'dos emisores para el mismo folio tiene que verse');
  assert.match(d.detalle, /mal identificado/i);
});

// ---------- 3. La validación no tapa la contradicción ----------

test('validar en fuente no sube el nivel de un dato con documentos que se contradicen', () => {
  const validado = { ...DATO, validado_por: 'Jefa de calidad', validado_fuente: 'sii', validado_at: new Date() };
  // Coinciden → 4.
  assert.equal(nivelConfianza(validado, [FACTURA, GUIA]), 4);
  // No coinciden → 2, aunque esté validado. Primero se resuelve el desacuerdo.
  assert.equal(nivelConfianza(validado, [FACTURA, { ...GUIA, cantidad: 48 }]), 2);
});

test('el nivel 4 exige quién, contra qué y cuándo — los tres', () => {
  const base = [FACTURA, GUIA];
  assert.equal(nivelConfianza({ ...DATO, validado_por: 'Jefa' }, base), 3);
  assert.equal(nivelConfianza({ ...DATO, validado_por: 'Jefa', validado_fuente: 'sii' }, base), 3);
  assert.equal(nivelConfianza({ ...DATO, validado_fuente: 'sii', validado_at: new Date() }, base), 3);
  // Una fuente inventada tampoco vale.
  assert.equal(nivelConfianza(
    { ...DATO, validado_por: 'X', validado_fuente: 'un amigo', validado_at: new Date() }, base), 3);
  assert.equal(nivelConfianza(
    { ...DATO, validado_por: 'X', validado_fuente: 'mandante', validado_at: new Date() }, base), 4);
});

// ---------- 4. Los tres estados de `consistente` ----------

test('sin con qué comparar, consistente es null y no true', () => {
  // Un solo documento sin cantidad: nada que contrastar.
  const r = verificarConsistencia(
    { producto: 'Filtros' },
    [{ rol: 'certificado', descripcion: 'Certificado', dte_proveedor_id: 'd' }]
  );
  assert.equal(r.consistente, null);
  assert.equal(r.comparados, false);
  assert.deepEqual(r.desacuerdos, []);
  // null NO es true por ninguna vía.
  assert.notEqual(r.consistente, true);
  assert.notEqual(r.consistente, false);
  // Y el dato queda en 2 (documentado), nunca en 3.
  assert.equal(nivelConfianza({ producto: 'Filtros' },
    [{ rol: 'certificado', descripcion: 'C', dte_proveedor_id: 'd' }]), 2);
});

test('no haber comparado sí deja llegar al 4; contradecirse no', () => {
  // No comparar no es contradecirse: un dato validado contra el SII con un
  // solo documento llega a 4.
  const solo = [{ rol: 'venta_principal', descripcion: 'F', factura_id: 'f' }];
  assert.equal(nivelConfianza(
    { producto: 'X', validado_por: 'Jefa', validado_fuente: 'sii', validado_at: new Date() }, solo), 4);
});

test('un dato sin ningún documento respaldado se queda en 1', () => {
  assert.equal(nivelConfianza(DATO, []), 1);
  assert.equal(nivelConfianza(DATO, [{ rol: 'guia', descripcion: 'Guía que dice tener' }]), 1);
});

// ---------- 5. Aguas abajo ----------

test('la cadena aguas abajo cae en 9-12, no en la 1', () => {
  assert.deepEqual(CATEGORIA_AGUAS_ABAJO, {
    transporte_posterior: 9, procesamiento: 10, uso: 11, fin_de_vida: 12,
  });
  // La cadena del cátodo: factura → guía → transporte → cliente → procesamiento.
  assert.equal(categoriaPotencialDeDato(
    { direccion: 'abajo', etapa: 'transporte_posterior' }, { tipo: 'suministro' }), 9);
  assert.equal(categoriaPotencialDeDato(
    { direccion: 'abajo', etapa: 'procesamiento' }, { tipo: 'suministro' }), 10);
  assert.equal(categoriaPotencialDeDato({ direccion: 'abajo', etapa: 'uso' }, {}), 11);
  assert.equal(categoriaPotencialDeDato({ direccion: 'abajo', etapa: 'fin_de_vida' }, {}), 12);
  // Ninguna de ellas es la 1.
  for (const etapa of ETAPAS_AGUAS_ABAJO) {
    assert.notEqual(categoriaPotencialDeDato({ direccion: 'abajo', etapa }, { tipo: 'suministro' }), 1);
  }
});

test('aguas abajo sin etapa devuelve null, no cae a la categoría 1', () => {
  // La 1 es «bienes y servicios adquiridos»: aguas abajo sería sencillamente
  // falsa. Mejor no opinar.
  assert.equal(categoriaPotencialDeDato({ direccion: 'abajo' }, { tipo: 'suministro' }), null);
  assert.equal(categoriaPotencialDeDato({ direccion: 'abajo', etapa: 'inventada' }, {}), null);
});

test('aguas arriba sigue clasificando por el tipo de la venta', () => {
  assert.equal(categoriaPotencialDeDato({ direccion: 'arriba' }, { tipo: 'suministro' }), 1);
  assert.equal(categoriaPotencialDeDato({ direccion: 'arriba' }, { tipo: 'transporte' }), 4);
  assert.equal(categoriaPotencialDeDato({ direccion: 'arriba' }, { tipo: 'arriendo' }), 8);
});

// ---------- 6. El resumen ----------

test('resumenDato entrega las cuatro dimensiones por separado', () => {
  const r = resumenDato(DATO, [FACTURA, GUIA], { tipo: 'suministro', periodo: '2026-07' });
  assert.equal(r.nivel_confianza, 3);
  assert.equal(r.nombre_nivel, 'Consistente');
  assert.equal(r.procedencia, 'documento_en_sicr3p');
  assert.equal(r.integridad, 1);              // una factura con archivo en sicr3p
  assert.equal(r.consistente, true);
  assert.equal(r.validado_fuente, null);
  assert.equal(r.categoria_scope_potencial, 1);
  assert.ok(r.no_acredita.length >= 6);
  // Las cuatro no se colapsan en un solo número.
  assert.notEqual(r.procedencia, r.consistente);
});

test('resumenDato toma el período del expediente sin que el llamador lo componga', () => {
  // El período vive en el expediente, no en el dato. Si no se inyectara,
  // el chequeo de fechas nunca correría y un documento de otro período
  // pasaría inadvertido.
  const sinPeriodo = { cantidad: 50, unidad: 'unidad', producto: 'Filtros' };
  const r = resumenDato(sinPeriodo, [FACTURA, { ...GUIA, fecha: '2025-02-01' }],
    { tipo: 'suministro', periodo: '2026-07' });
  assert.ok(r.desacuerdos.find((d) => d.campo === 'fecha'));
  assert.equal(r.consistente, false);
});

// ---------- 7. El esquema ----------

test('el CHECK del nivel 4 y el de la etapa existen en la base', { skip: SALTO_PROD }, async () => {
  const { rows: prov } = await query(
    `INSERT INTO proveedores (nombre_empresa, rut) VALUES ('Dato SpA', $1) RETURNING id`,
    [`82${Date.now().toString().slice(-7)}K`]
  );
  const { rows: exp } = await query(
    `INSERT INTO expedientes (proveedor_id, cliente_nombre, tipo, periodo)
     VALUES ($1, 'Minera de Ejemplo', 'suministro', '2026-07') RETURNING id`,
    [prov[0].id]
  );
  const E = exp[0].id;

  // Nivel 4 sin quién/contra qué/cuándo: imposible a nivel de esquema, no
  // solo de aplicación.
  await assert.rejects(
    () => query(
      `INSERT INTO datos_trazables (expediente_id, direccion, producto, cantidad, unidad, nivel_confianza)
       VALUES ($1, 'arriba', 'Filtros', 50, 'unidad', 4)`, [E]),
    (err) => err.code === '23514'
  );
  // Con los tres, entra.
  const { rows: ok } = await query(
    `INSERT INTO datos_trazables
       (expediente_id, direccion, producto, cantidad, unidad, nivel_confianza,
        validado_por, validado_fuente, validado_at)
     VALUES ($1, 'arriba', 'Filtros', 50, 'unidad', 4, 'Jefa de calidad', 'sii', now())
     RETURNING id, consistente, desacuerdos`, [E]);
  assert.equal(ok[0].consistente, null, 'un dato nuevo nace sin opinión de consistencia');
  assert.deepEqual(ok[0].desacuerdos, []);

  // Una etapa aguas abajo en un dato de aguas arriba no significa nada.
  await assert.rejects(
    () => query(
      `INSERT INTO datos_trazables (expediente_id, direccion, etapa, producto, cantidad, unidad)
       VALUES ($1, 'arriba', 'procesamiento', 'X', 1, 'kg')`, [E]),
    (err) => err.code === '23514'
  );
  // Cantidad cero tampoco: un dato de cantidad 0 no es un dato.
  await assert.rejects(
    () => query(
      `INSERT INTO datos_trazables (expediente_id, direccion, producto, cantidad, unidad)
       VALUES ($1, 'arriba', 'X', 0, 'kg')`, [E]),
    (err) => err.code === '23514'
  );

  await query(`DELETE FROM proveedores WHERE id = $1`, [prov[0].id]);
});

test('borrar un dato suelta sus documentos, no los borra', { skip: SALTO_PROD }, async () => {
  const { rows: prov } = await query(
    `INSERT INTO proveedores (nombre_empresa, rut) VALUES ('Suelta SpA', $1) RETURNING id`,
    [`83${Date.now().toString().slice(-7)}K`]
  );
  const { rows: exp } = await query(
    `INSERT INTO expedientes (proveedor_id, cliente_nombre) VALUES ($1, 'C') RETURNING id`,
    [prov[0].id]
  );
  const { rows: dato } = await query(
    `INSERT INTO datos_trazables (expediente_id, direccion, producto, cantidad, unidad)
     VALUES ($1, 'arriba', 'Filtros', 50, 'unidad') RETURNING id`, [exp[0].id]);
  const { rows: doc } = await query(
    `INSERT INTO expediente_documentos (expediente_id, rol, descripcion, dato_id, cantidad, unidad)
     VALUES ($1, 'guia', 'Guía 4567', $2, 50, 'unidad') RETURNING id`,
    [exp[0].id, dato[0].id]);

  await query(`DELETE FROM datos_trazables WHERE id = $1`, [dato[0].id]);
  const { rows: sigue } = await query(
    `SELECT id, dato_id FROM expediente_documentos WHERE id = $1`, [doc[0].id]);
  assert.equal(sigue.length, 1, 'el documento sigue en el expediente');
  assert.equal(sigue[0].dato_id, null, 'y quedó suelto, no borrado');

  await query(`DELETE FROM proveedores WHERE id = $1`, [prov[0].id]);
});
