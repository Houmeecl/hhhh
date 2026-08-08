import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { query, withTx } from '../src/lib/db.js';
import { eslabonValido, hashDocumento } from '../src/services/cadenaHash.js';
import {
  ESTADOS_REVISABLES, recalcularPorGasto, hashAjuste, anexarAjuste, verificarCadenaAjustes,
} from '../src/services/ajustesClasificacion.js';

// ============================================================
// Reclasificación por un operador (migraciones 078 y 079).
//
// La restricción dura: el documento está SELLADO. Cambiarle la categoría le
// cambia el factor y por lo tanto el CO2e, así que editar la fila rompería la
// cadena — que es lo que verifica el QR público. El ajuste va aparte, con su
// propia cadena, y estos tests existen sobre todo para probar eso.
// ============================================================

// ---------- El recálculo, sin base ----------

test('recalcularPorGasto: cambiar de categoría es cambiar de factor', () => {
  // 3 tCO2e con factor 30 → el mismo gasto con factor 10 son 1 tCO2e.
  assert.equal(recalcularPorGasto({ co2eOriginal: 3, factorOriginal: 30, factorNuevo: 10 }).co2e, 1);
  assert.equal(recalcularPorGasto({ co2eOriginal: 3, factorOriginal: 10, factorNuevo: 30 }).co2e, 9);
});

test('recalcularPorGasto: una nota de crédito vale 0 en cualquier categoría', () => {
  // co2e 0 y sin factor original: no hay proporción que aplicar, y tampoco falta.
  assert.equal(recalcularPorGasto({ co2eOriginal: 0, factorOriginal: null, factorNuevo: 12 }).co2e, 0);
});

test('recalcularPorGasto: sin el factor original NO inventa un número', () => {
  assert.throws(
    () => recalcularPorGasto({ co2eOriginal: 5, factorOriginal: 0, factorNuevo: 12 }),
    /no se puede recalcular/,
    'sin el factor con que se calculó no se puede deducir el monto'
  );
});

test('recalcularPorGasto: una categoría sin factor de gasto se rechaza', () => {
  assert.throws(() => recalcularPorGasto({ co2eOriginal: 5, factorOriginal: 10, factorNuevo: 0 }), /factor de gasto/);
});

test('hashAjuste es determinista y sensible a cada campo firmado', () => {
  const base = {
    factura_id: 'f1', categoria_codigo: 'electricidad', categoria: 'Energía eléctrica',
    co2e_ajustado: 1.5, co2e_original: 3, usuario_id: 'u1', motivo: 'La glosa dice consumo eléctrico',
  };
  assert.equal(hashAjuste(base), hashAjuste({ ...base }));
  for (const campo of Object.keys(base)) {
    const alterado = { ...base, [campo]: typeof base[campo] === 'number' ? base[campo] + 1 : `${base[campo]}x` };
    assert.notEqual(hashAjuste(alterado), hashAjuste(base), `el hash ignora ${campo}`);
  }
});

test('solo dos estados entran a la bandeja', () => {
  assert.deepEqual(ESTADOS_REVISABLES, ['sin_coincidencia', 'sin_categoria']);
  // Una categoría deducida de la glosa NO se corrige documento por documento:
  // eso se arregla en el panel de categorías, que versiona el cambio.
  assert.ok(!ESTADOS_REVISABLES.includes('glosa'));
  // Y un documento sin procedencia registrada no se reinterpreta hacia atrás.
  assert.ok(!ESTADOS_REVISABLES.includes(null));
});

// ---------- Contra la base: el sello no se toca ----------

let sesionId, facturaId, usuarioId, hashOriginal;

before(async () => {
  const { rows: uRows } = await query(
    // Se REUSA entre corridas: `ajustes_clasificacion.usuario_id` es ON DELETE
    // RESTRICT a propósito —borrar la cuenta de un operador no puede dejar un
    // asiento firmado sin firmante—, así que este usuario no se borra al final.
    `INSERT INTO usuarios (nombre, email, password_hash, rol, panel)
     VALUES ('Operador de prueba', 'operador.ajustes.test@ejemplo.cl', 'x', 'operador', 'sicrep')
     ON CONFLICT (email) DO UPDATE SET nombre = EXCLUDED.nombre
     RETURNING id`
  );
  usuarioId = uRows[0].id;
  const { rows: sRows } = await query(
    `INSERT INTO sesiones (nombre_cliente, rut_cliente) VALUES ('Prueba ajustes', '77.777.777-7') RETURNING id`
  );
  sesionId = sRows[0].id;

  // Un documento que el motor NO supo clasificar: cayó al catch-all.
  const hDoc = hashDocumento({
    numero_venta: 'V-AJUSTE', rut_emisor: null, rut_receptor: null,
    total_co2e: 3, categoria: 'Servicios', archivo_original: 'a.pdf',
  });
  const { rows: fRows } = await query(
    `INSERT INTO facturas
       (sesion_id, numero_venta, archivo_original, total_co2e, categoria, categoria_codigo,
        categoria_origen, status, hash_documento, hash_anterior, hash_cadena, eslabon)
     VALUES ($1,'V-AJUSTE','a.pdf',3,'Servicios','servicios','sin_coincidencia','procesada',
             $2, repeat('0',64), encode(sha256((repeat('0',64) || $2)::bytea),'hex'), 1)
     RETURNING *`,
    [sesionId, hDoc]
  );
  facturaId = fRows[0].id;
  hashOriginal = { ...fRows[0] };
});

after(async () => {
  // Los AJUSTES no se borran, ni siquiera acá: son append-only y borrar un
  // eslabón parte la cadena para todos los demás. Quedan huérfanos
  // (factura_id NULL por el ON DELETE SET NULL) y siguen verificando, que es
  // exactamente el comportamiento que la purga por retención necesita.
  await query(`DELETE FROM facturas WHERE id = $1`, [facturaId]);
  await query(`DELETE FROM sesiones WHERE id = $1`, [sesionId]);
  // El usuario NO se borra: firma asientos que sobreviven a esta prueba.
});

test('el hash del documento original NO cambia al registrar un ajuste', async () => {
  await withTx((client) => anexarAjuste(client, {
    factura_id: facturaId, categoria_codigo: 'electricidad', categoria: 'Energía eléctrica',
    co2e_ajustado: 1.5, co2e_original: 3, usuario_id: usuarioId,
    motivo: 'La glosa dice suministro eléctrico',
  }));

  const { rows } = await query(
    `SELECT total_co2e::float AS total_co2e, categoria, categoria_origen,
            hash_documento, hash_anterior, hash_cadena, eslabon
       FROM facturas WHERE id = $1`, [facturaId]
  );
  const f = rows[0];
  assert.equal(f.hash_documento, hashOriginal.hash_documento, 'el sello es el mismo');
  assert.equal(f.hash_cadena, hashOriginal.hash_cadena);
  assert.equal(f.categoria, 'Servicios', 'la fila sellada conserva lo que se firmó');
  assert.equal(f.total_co2e, 3);
  assert.equal(f.categoria_origen, 'sin_coincidencia');
  assert.ok(eslabonValido(f), 'y la verificación sigue dando el mismo resultado que antes');
});

test('la vista `facturas_vigentes` sí muestra la clasificación del operador', async () => {
  const { rows } = await query(
    `SELECT total_co2e::float AS total_co2e, categoria, categoria_codigo, categoria_origen,
            total_co2e_original::float AS total_co2e_original, categoria_original,
            ajuste_motivo, hash_cadena
       FROM facturas_vigentes WHERE id = $1`, [facturaId]
  );
  const v = rows[0];
  assert.equal(v.categoria, 'Energía eléctrica');
  assert.equal(v.categoria_codigo, 'electricidad');
  assert.equal(v.categoria_origen, 'operador', 'y por eso sí gana alcance GHG');
  assert.equal(v.total_co2e, 1.5);
  // Lo anterior sigue disponible: el informe declara el cambio en vez de
  // presentarlo como si siempre hubiera sido así.
  assert.equal(v.total_co2e_original, 3);
  assert.equal(v.categoria_original, 'Servicios');
  assert.match(v.ajuste_motivo, /suministro eléctrico/);
  // Las columnas de hash salen sin tocar: son las del documento firmado.
  assert.equal(v.hash_cadena, hashOriginal.hash_cadena);
});

test('append-only: un segundo ajuste no borra el primero, y manda el último', async () => {
  await withTx((client) => anexarAjuste(client, {
    factura_id: facturaId, categoria_codigo: 'agua', categoria: 'Agua',
    co2e_ajustado: 2, co2e_original: 3, usuario_id: usuarioId, motivo: 'Corrijo: era agua',
  }));
  const { rows: hist } = await query(
    `SELECT categoria, eslabon FROM ajustes_clasificacion WHERE factura_id = $1 ORDER BY eslabon`,
    [facturaId]
  );
  assert.equal(hist.length, 2, 'el ajuste superado NO se borra');
  assert.deepEqual(hist.map((h) => h.categoria), ['Energía eléctrica', 'Agua']);

  const { rows } = await query(`SELECT categoria FROM facturas_vigentes WHERE id = $1`, [facturaId]);
  assert.equal(rows[0].categoria, 'Agua', 'vale el de mayor eslabón');
});

test('la cadena de ajustes verifica por separado', async () => {
  const r = await verificarCadenaAjustes((sql) => query(sql));
  assert.equal(r.valido, true);
  assert.ok(r.total_eslabones >= 2);
});

test('borrar la factura NO parte la cadena de ajustes', async () => {
  // El FK es ON DELETE SET NULL y no CASCADE: con CASCADE, purgar un
  // documento por retención (migración 048) borraba sus eslabones y la
  // verificación pasaba a denunciar una alteración que nunca ocurrió.
  const { rows: sRows } = await query(
    `INSERT INTO sesiones (nombre_cliente, rut_cliente) VALUES ('Purga', '66.666.666-6') RETURNING id`
  );
  const { rows: fRows } = await query(
    `INSERT INTO facturas (sesion_id, archivo_original, total_co2e, categoria, categoria_codigo,
                           categoria_origen, status)
     VALUES ($1, 'purga.pdf', 1, 'Servicios', 'servicios', 'sin_coincidencia', 'procesada')
     RETURNING id`, [sRows[0].id]
  );
  // Por id, no por motivo: esta prueba corre muchas veces sobre la misma base
  // y sus asientos anteriores siguen ahí (append-only, no se limpian).
  const ajuste = await withTx((client) => anexarAjuste(client, {
    factura_id: fRows[0].id, categoria_codigo: 'agua', categoria: 'Agua',
    co2e_ajustado: 1, co2e_original: 1, usuario_id: usuarioId, motivo: 'Se va a purgar',
  }));

  await query(`DELETE FROM facturas WHERE id = $1`, [fRows[0].id]);
  await query(`DELETE FROM sesiones WHERE id = $1`, [sRows[0].id]);

  const { rows } = await query(
    `SELECT factura_id, motivo FROM ajustes_clasificacion WHERE id = $1`, [ajuste.id]
  );
  assert.equal(rows.length, 1, 'el asiento sobrevive a la purga del documento');
  assert.equal(rows[0].factura_id, null, 'huérfano, pero legible');
  assert.equal((await verificarCadenaAjustes((sql) => query(sql))).valido, true);
});

test('alterar un ajuste rompe SU cadena, no la de las facturas', async () => {
  const { rows } = await query(
    `SELECT id, hash_documento FROM ajustes_clasificacion WHERE factura_id = $1 ORDER BY eslabon LIMIT 1`,
    [facturaId]
  );
  const original = rows[0].hash_documento;
  try {
    await query(`UPDATE ajustes_clasificacion SET hash_documento = $2 WHERE id = $1`,
      [rows[0].id, 'f'.repeat(64)]);
    const r = await verificarCadenaAjustes((sql) => query(sql));
    assert.equal(r.valido, false, 'la cadena de ajustes detecta la alteración');

    // Y la factura sellada sigue intacta: son dos cadenas distintas.
    const { rows: fRows } = await query(
      `SELECT hash_anterior, hash_documento, hash_cadena FROM facturas WHERE id = $1`, [facturaId]
    );
    assert.ok(eslabonValido(fRows[0]));
  } finally {
    await query(`UPDATE ajustes_clasificacion SET hash_documento = $2 WHERE id = $1`, [rows[0].id, original]);
  }
});
