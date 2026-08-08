import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { descargarYCalcular, analizarPeriodo } from '../src/services/analisisSiiProveedor.js';
import { proveedorSiiActivo } from '../src/services/siiProveedor.js';
import { query, pool, withTx } from '../src/lib/db.js';
import { runMigrations } from '../src/lib/migrate.js';
import { EN_PRODUCCION, SALTO_PROD } from './util/soloDev.js';

// Descarga + cálculo + UPSERT contra la BD real de test, con la red al SII
// completamente simulada (fetcher inyectado). Verifica el camino completo
// que usan el panel del proveedor y la sección admin "SII".

const CFG = { enabled: true, key: 'clave_api_servidor_no_real', base: 'https://baseapi.invalido', timeoutMs: 2000 };
const RUT_SII = '78345120-4';      // persona que se autentica (módulo 11 ok)
const RUT_EMPRESA = '783451204';   // proveedores.rut va normalizado
const CLAVE = 'clave_sii_de_prueba_no_real';
const PERIODO = '2025-03';

const DTE_RECIBIDO = {
  tipo_dte: 33, folio: 501, fecha: '2025-03-10', rut_emisor: '77.000.000-0',
  razon_social_emisor: 'COMBUSTIBLES BETA SPA', monto_total: 595000,
};
const FILA_VENTA = {
  'Tipo Doc': '33', 'RUT Cliente': '76.543.210-3', 'Razon Social': 'CLIENTE GAMA LTDA',
  'Folio': '900', 'Fecha Docto': '12/03/2025', 'Monto Neto': '1000000', 'Monto IVA': '190000', 'Monto total': '1190000',
};

// Fetcher según URL: validar → ok; DTE recibidos → 1 compra; RCV venta → 1 venta.
const fetcher = async (url) => {
  let body = { success: true };
  if (/\/dte\/recibidos\//.test(url)) body = { success: true, data: { documentos: [DTE_RECIBIDO] } };
  else if (/\/rcv\//.test(url)) body = { success: true, data: { datos: [FILA_VENTA] } };
  return { ok: true, status: 200, json: async () => body };
};

test('descargarYCalcular: descarga simulada, calcula y persiste idempotente', { skip: EN_PRODUCCION && SALTO_PROD }, async () => {
  await runMigrations();
  await query(`DELETE FROM proveedores WHERE rut = $1`, [RUT_EMPRESA]);
  const { rows } = await query(
    `INSERT INTO proveedores (nombre_empresa, rut) VALUES ('Empresa Test SII', $1) RETURNING id`,
    [RUT_EMPRESA]
  );
  const proveedorId = rows[0].id;

  const r1 = await descargarYCalcular(
    { query, withTx, proveedorId, rutEmpresa: RUT_EMPRESA, rutSii: RUT_SII, password: CLAVE, periodo: PERIODO },
    { fetcher, cfg: CFG }
  );
  assert.equal(r1.documentos, 2); // 1 compra + 1 venta
  assert.equal(r1.analisis.resumen.compra.n, 1);
  assert.equal(r1.analisis.resumen.venta.n, 1);
  assert.equal(r1.analisis.resumen.venta.total, 1190000);
  // La compra sin XML cae a método por gasto; si el motor está sembrado, hay co2e.
  const compra = r1.analisis.documentos.find((d) => d.tipo === 'compra');
  assert.equal(compra.folio, '501');
  assert.ok(compra.co2e === null || Number(compra.co2e) >= 0);

  // Re-descargar el mismo período NO duplica (UPSERT idempotente).
  const r2 = await descargarYCalcular(
    { query, withTx, proveedorId, rutEmpresa: RUT_EMPRESA, rutSii: RUT_SII, password: CLAVE, periodo: PERIODO },
    { fetcher, cfg: CFG }
  );
  assert.equal(r2.analisis.documentos.length, 2);

  // La clave JAMÁS queda en lo persistido.
  const { rows: crudos } = await query(`SELECT * FROM dte_proveedor WHERE proveedor_id = $1`, [proveedorId]);
  assert.ok(!JSON.stringify(crudos).includes(CLAVE), 'la clave no puede aparecer en dte_proveedor');

  // analizarPeriodo directo devuelve lo mismo que el análisis embebido.
  const a = await analizarPeriodo(query, proveedorId, PERIODO);
  assert.equal(a.documentos.length, 2);

  await query(`DELETE FROM proveedores WHERE id = $1`, [proveedorId]); // CASCADE limpia dte_proveedor
});

// Conciliación entre dos empresas sicr3p: A compró a B, ambas descargaron
// su propio RCV. La compra de A debe confirmarse contra la venta de B
// (mismo folio + tipo_dte, RUT contraparte cruzado, tipo opuesto) — dos
// fuentes SII independientes de acuerdo. Nunca expone el monto de B.
test('analizarPeriodo: concilia contra el RCV de otro proveedor sicr3p (monto igual)', { skip: EN_PRODUCCION && SALTO_PROD }, async () => {
  await runMigrations();
  await query(`DELETE FROM proveedores WHERE rut IN ('900000001','900000002')`);
  const { rows: rA } = await query(
    `INSERT INTO proveedores (nombre_empresa, rut) VALUES ('Empresa A Conciliación', '900000001') RETURNING id`
  );
  const { rows: rB } = await query(
    `INSERT INTO proveedores (nombre_empresa, rut) VALUES ('Empresa B Conciliación', '900000002') RETURNING id`
  );
  const [A, B] = [rA[0].id, rB[0].id];

  // A: compra a B, folio 700, $119.000.
  await query(
    `INSERT INTO dte_proveedor (proveedor_id, periodo, tipo, tipo_dte, folio, rut_contraparte, razon_social, neto, iva, total)
     VALUES ($1, '2025-05', 'compra', '33', '700', '900000002', 'Empresa B Conciliación', 100000, 19000, 119000)`,
    [A]
  );
  // B: venta a A, mismo folio/tipo_dte, mismo monto (declara el mismo documento).
  await query(
    `INSERT INTO dte_proveedor (proveedor_id, periodo, tipo, tipo_dte, folio, rut_contraparte, razon_social, neto, iva, total)
     VALUES ($1, '2025-06', 'venta', '33', '700', '900000001', 'Empresa A Conciliación', 100000, 19000, 119000)`,
    [B]
  );

  const a = await analizarPeriodo(query, A, '2025-05');
  const doc = a.documentos.find((d) => d.folio === '700');
  assert.equal(doc.conciliado, true, 'debe encontrar el espejo aunque B lo haya descargado en otro período');
  assert.equal(doc.monto_coincide, true);
  assert.equal(doc.espejo_empresa, 'Empresa B Conciliación');
  const fila = a.concentracion.compra.find((c) => c.rut === '900000002');
  assert.equal(fila.conciliados, 1);
  assert.equal(fila.en_sicr3p, true);

  await query(`DELETE FROM proveedores WHERE id IN ($1, $2)`, [A, B]);
});

test('analizarPeriodo: concilia pero marca el monto distinto sin exponer la cifra de la otra empresa', { skip: EN_PRODUCCION && SALTO_PROD }, async () => {
  await runMigrations();
  await query(`DELETE FROM proveedores WHERE rut IN ('900000003','900000004')`);
  const { rows: rC } = await query(
    `INSERT INTO proveedores (nombre_empresa, rut) VALUES ('Empresa C Conciliación', '900000003') RETURNING id`
  );
  const { rows: rD } = await query(
    `INSERT INTO proveedores (nombre_empresa, rut) VALUES ('Empresa D Conciliación', '900000004') RETURNING id`
  );
  const [C, D] = [rC[0].id, rD[0].id];

  await query(
    `INSERT INTO dte_proveedor (proveedor_id, periodo, tipo, tipo_dte, folio, rut_contraparte, razon_social, neto, iva, total)
     VALUES ($1, '2025-05', 'compra', '33', '800', '900000004', 'Empresa D Conciliación', 100000, 19000, 119000)`,
    [C]
  );
  // D declaró un monto distinto para el mismo folio — discrepancia real.
  await query(
    `INSERT INTO dte_proveedor (proveedor_id, periodo, tipo, tipo_dte, folio, rut_contraparte, razon_social, neto, iva, total)
     VALUES ($1, '2025-05', 'venta', '33', '800', '900000003', 'Empresa C Conciliación', 80000, 15200, 95200)`,
    [D]
  );

  const a = await analizarPeriodo(query, C, '2025-05');
  const doc = a.documentos.find((d) => d.folio === '800');
  assert.equal(doc.conciliado, true);
  assert.equal(doc.monto_coincide, false);
  assert.ok(!JSON.stringify(a).includes('95200'), 'el monto que declaró D nunca debe aparecer en el análisis de C');

  await query(`DELETE FROM proveedores WHERE id IN ($1, $2)`, [C, D]);
});

test('analizarPeriodo: sin contraparte en sicr3p, no rompe nada (sin conciliado)', { skip: EN_PRODUCCION && SALTO_PROD }, async () => {
  await runMigrations();
  await query(`DELETE FROM proveedores WHERE rut = '900000005'`);
  const { rows } = await query(
    `INSERT INTO proveedores (nombre_empresa, rut) VALUES ('Empresa E Sola', '900000005') RETURNING id`
  );
  const E = rows[0].id;
  await query(
    `INSERT INTO dte_proveedor (proveedor_id, periodo, tipo, tipo_dte, folio, rut_contraparte, razon_social, neto, iva, total)
     VALUES ($1, '2025-05', 'compra', '33', '900', '111111111', 'Proveedor externo', 50000, 9500, 59500)`,
    [E]
  );

  const a = await analizarPeriodo(query, E, '2025-05');
  const doc = a.documentos.find((d) => d.folio === '900');
  assert.equal(doc.conciliado, undefined);
  assert.equal(a.concentracion.compra[0].conciliados, 0);

  await query(`DELETE FROM proveedores WHERE id = $1`, [E]);
});

// Los folios NO son globales — son correlativos por RUT emisor (comentario
// de la migración 071), así que dos empresas SIN relación entre sí pueden
// compartir folio+tipo_dte por pura coincidencia. La conciliación debe
// exigir que la empresa espejo sea EXACTAMENTE la contraparte declarada
// (rut_contraparte), no solo "algún otro proveedor con el mismo folio".
test('analizarPeriodo: NO concilia contra un tercero ajeno que comparte folio por coincidencia', { skip: EN_PRODUCCION && SALTO_PROD }, async () => {
  await runMigrations();
  await query(`DELETE FROM proveedores WHERE rut IN ('900000006','900000007','900000008')`);
  const { rows: rF } = await query(
    `INSERT INTO proveedores (nombre_empresa, rut) VALUES ('Empresa F', '900000006') RETURNING id`
  );
  const { rows: rG } = await query(
    `INSERT INTO proveedores (nombre_empresa, rut) VALUES ('Empresa G (nunca conecta su SII)', '900000007') RETURNING id`
  );
  const { rows: rH } = await query(
    `INSERT INTO proveedores (nombre_empresa, rut) VALUES ('Empresa H (ajena, sin relación con G)', '900000008') RETURNING id`
  );
  const [F, , H] = [rF[0].id, rG[0].id, rH[0].id];

  // F compra a G, folio 55 — G JAMÁS descarga su propio SII (sin fila espejo real).
  await query(
    `INSERT INTO dte_proveedor (proveedor_id, periodo, tipo, tipo_dte, folio, rut_contraparte, razon_social, neto, iva, total)
     VALUES ($1, '2025-05', 'compra', '33', '55', '900000007', 'Empresa G (nunca conecta su SII)', 100000, 19000, 119000)`,
    [F]
  );
  // H, un tercero SIN ninguna relación con G, declara una venta a F con el
  // MISMO folio+tipo_dte por pura coincidencia (folios son correlativos por
  // emisor, no globales — este cruce sería un falso positivo).
  await query(
    `INSERT INTO dte_proveedor (proveedor_id, periodo, tipo, tipo_dte, folio, rut_contraparte, razon_social, neto, iva, total)
     VALUES ($1, '2025-05', 'venta', '33', '55', '900000006', 'Empresa F', 100000, 19000, 119000)`,
    [H]
  );

  const a = await analizarPeriodo(query, F, '2025-05');
  const doc = a.documentos.find((d) => d.folio === '55');
  assert.equal(doc.conciliado, undefined, 'no debe conciliar contra H — no es la contraparte declarada (G)');

  await query(`DELETE FROM proveedores WHERE id IN ($1, $2, $3)`, [F, rG[0].id, H]);
});

// ============================================================
// Alcances GHG 1/2/3 (migración 076). El motor YA calculaba la categoría de
// cada documento y `descargarYCalcular` la botaba; ahora la persiste junto
// con la versión del motor que la produjo.
// ============================================================

test('descargarYCalcular estampa categoría y versión del motor en cada documento calculado',
  { skip: EN_PRODUCCION && SALTO_PROD }, async () => {
    await runMigrations();
    await query(`DELETE FROM proveedores WHERE rut = $1`, [RUT_EMPRESA]);
    const { rows } = await query(
      `INSERT INTO proveedores (nombre_empresa, rut) VALUES ('Empresa Test Alcance', $1) RETURNING id`,
      [RUT_EMPRESA]
    );
    const proveedorId = rows[0].id;

    await descargarYCalcular(
      { query, withTx, proveedorId, rutEmpresa: RUT_EMPRESA, rutSii: RUT_SII, password: CLAVE, periodo: PERIODO },
      { fetcher, cfg: CFG }
    );

    const { rows: compras } = await query(
      `SELECT co2e, categoria, motor_version_id FROM dte_proveedor WHERE proveedor_id = $1 AND tipo = 'compra'`,
      [proveedorId]
    );
    assert.equal(compras.length, 1);
    const c = compras[0];
    if (c.co2e == null) {
      // Motor sin sembrar: no se inventa clasificación. Es el caso que la
      // vista rotula "sin clasificar", no un alcance adivinado.
      assert.equal(c.categoria, null);
      assert.equal(c.motor_version_id, null);
    } else {
      assert.ok(c.categoria, 'un documento con co2e tiene que traer su código de categoría');
      assert.ok(c.motor_version_id != null, 'un documento con co2e tiene que traer la versión con que se calculó');
      const { rows: existe } = await query(`SELECT 1 FROM motor_categorias WHERE codigo = $1`, [c.categoria]);
      assert.equal(existe.length, 1, `la categoría estampada (${c.categoria}) debe existir en el catálogo`);
    }

    await query(`DELETE FROM proveedores WHERE id = $1`, [proveedorId]);
  });

test('analizarPeriodo: agrupa por alcance y los documentos sin categoría van a sin_clasificar, no al Alcance 3',
  { skip: EN_PRODUCCION && SALTO_PROD }, async () => {
    await runMigrations();
    await query(`DELETE FROM proveedores WHERE rut = '900000101'`);
    const { rows: rP } = await query(
      `INSERT INTO proveedores (nombre_empresa, rut) VALUES ('Empresa Alcances', '900000101') RETURNING id`
    );
    const P = rP[0].id;
    // Una versión del motor para estampar (no hay que crear categorías: las
    // siembra la migración 017 y las congela la 056 por versión).
    const { rows: rV } = await query(
      `INSERT INTO motor_versiones (nota, origen) VALUES ('test alcances', 'edicion_manual') RETURNING id`
    );
    const V = rV[0].id;

    // `categoria_origen` decide si el documento recibe alcance: solo 'xml'
    // (la categoría salió de la glosa real de los ítems) lo habilita.
    // [folio, categoria, co2e, categoria_origen, motor_version_id]
    const filas = [
      ['101', 'combustible', 3.0, 'xml', V],           // Alcance 1
      ['102', 'electricidad', 2.0, 'xml', V],          // Alcance 2
      ['103', 'materiales', 4.0, 'xml', V],            // Alcance 3 · Cat. 1
      ['104', 'servicios', 1.0, 'xml', V],             // Alcance 3 · Cat. 1 (otra descripción, mismo alcance)
      ['105', 'materiales', 5.0, null, null],          // descargado antes de la columna `categoria_origen`
      ['106', 'combustible', 6.0, 'razon_social', V],  // deducido del nombre del proveedor: sin alcance
    ];
    for (const [folio, categoria, co2e, origen, version] of filas) {
      await query(
        `INSERT INTO dte_proveedor
           (proveedor_id, periodo, tipo, tipo_dte, folio, rut_contraparte, razon_social, neto, iva, total, co2e, metodo, categoria, categoria_origen, motor_version_id)
         VALUES ($1,'2025-07','compra','33',$2,'900000102','Proveedor X',100000,19000,119000,$3,'gasto',$4,$5,$6)`,
        [P, folio, co2e, categoria, origen, version]
      );
    }

    const a = await analizarPeriodo(query, P, '2025-07');
    const em = a.emisiones;
    assert.equal(em.total_co2e_tref, 21, 'el total incluye lo que no recibe alcance');
    assert.equal(em.referencial, true);

    const porAlcance = Object.fromEntries(em.por_alcance.alcances.map((x) => [x.alcance, x]));
    assert.equal(porAlcance[1].tco2e, 3);
    assert.equal(porAlcance[2].tco2e, 2);
    assert.equal(porAlcance[3].tco2e, 5, 'materiales + servicios caen ambos en Alcance 3');
    assert.equal(porAlcance[3].n_documentos, 2);
    assert.equal(porAlcance[3].categorias.length, 2, 'dentro del alcance, cada categoría del motor se muestra aparte');

    // Lo que no recibe alcance NO se reparte ni se esconde, y cada motivo se
    // cuenta aparte porque la salida del usuario es distinta en cada caso.
    const sin = em.por_alcance.sin_clasificar;
    assert.equal(sin.n_documentos, 2);
    assert.equal(sin.tco2e, 11);
    assert.equal(sin.descarga_antigua, 1, 'con categoría pero sin procedencia: solo esta se arregla volviendo a descargar');
    assert.equal(sin.inferido_por_nombre, 1, 'la compra clasificada por el nombre del proveedor no entra a Alcance 1');
    assert.equal(porAlcance[1].tco2e, 3, 'Alcance 1 solo lleva lo que salió del detalle del documento');
    assert.equal(em.documentos_sin_version, 1);

    // INVARIANTE del informe: alcances + sin clasificar = total del período.
    const suma = em.por_alcance.alcances.reduce((s, x) => s + x.tco2e, 0) + em.por_alcance.sin_clasificar.tco2e;
    assert.equal(Math.round(suma * 10000) / 10000, em.total_co2e_tref);

    await query(`DELETE FROM proveedores WHERE id = $1`, [P]);
    await query(`DELETE FROM motor_versiones WHERE id = $1`, [V]);
  });

// Antes, el análisis citaba versionVigente() — la última versión existente al
// LEER. Si alguien editaba el motor después del cálculo, el informe citaba una
// versión con la que ese número nunca se calculó.
test('analizarPeriodo cita la versión ESTAMPADA al calcular, no la vigente al leer',
  { skip: EN_PRODUCCION && SALTO_PROD }, async () => {
    await runMigrations();
    await query(`DELETE FROM proveedores WHERE rut = '900000103'`);
    const { rows: rP } = await query(
      `INSERT INTO proveedores (nombre_empresa, rut) VALUES ('Empresa Sello Versión', '900000103') RETURNING id`
    );
    const P = rP[0].id;
    const { rows: rVieja } = await query(
      `INSERT INTO motor_versiones (nota, origen) VALUES ('versión con la que se calculó', 'edicion_manual') RETURNING id`
    );
    const vieja = rVieja[0].id;

    await query(
      `INSERT INTO dte_proveedor
         (proveedor_id, periodo, tipo, tipo_dte, folio, rut_contraparte, razon_social, neto, iva, total, co2e, metodo, categoria, categoria_origen, motor_version_id)
       VALUES ($1,'2025-08','compra','33','201','900000104','Proveedor Y',100000,19000,119000,7,'gasto','electricidad','xml',$2)`,
      [P, vieja]
    );

    // Alguien edita el motor DESPUÉS del cálculo: nace una versión más nueva.
    const { rows: rNueva } = await query(
      `INSERT INTO motor_versiones (nota, origen) VALUES ('edición posterior', 'edicion_manual') RETURNING id`
    );
    const nueva = rNueva[0].id;
    assert.ok(nueva > vieja);

    const a = await analizarPeriodo(query, P, '2025-08');
    assert.deepEqual(a.emisiones.motor_versiones, [vieja]);
    assert.equal(a.emisiones.motor_version_id, vieja);
    assert.notEqual(a.emisiones.motor_version_id, nueva);

    await query(`DELETE FROM proveedores WHERE id = $1`, [P]);
    await query(`DELETE FROM motor_versiones WHERE id IN ($1, $2)`, [vieja, nueva]);
  });

after(async () => { await pool.end(); });

// ============================================================
// Capacidad del adaptador SII activo. La interfaz la usa para NO ofrecer
// "Clasificar N documentos" (que vuelve a descargar el período) en un
// despliegue donde volver a descargar no puede clasificar nada: simpleapi y
// apigateway fabrican UN ítem sintético cuya glosa es la razón social de la
// contraparte, así que el contador bajaba a cero, el alcance seguía sin
// existir, y el usuario quedaba creyendo que lo había arreglado.
// ============================================================
test('proveedorSiiActivo: solo baseapi declara que puede traer el detalle', () => {
  assert.equal(proveedorSiiActivo({ proveedor: 'baseapi' }).puede_traer_detalle, true);
  assert.equal(proveedorSiiActivo({ proveedor: 'simpleapi' }).puede_traer_detalle, false);
  assert.equal(proveedorSiiActivo({ proveedor: 'apigateway' }).puede_traer_detalle, false);
});

test('proveedorSiiActivo: un nombre desconocido cae a baseapi, igual que el despacho', () => {
  // Mismo comportamiento que `adaptador()`: si SII_PROVEEDOR trae basura se
  // usa baseapi, así que la capacidad reportada tiene que ser la de baseapi
  // — la que de verdad va a correr.
  assert.deepEqual(proveedorSiiActivo({ proveedor: 'inventado' }), { puede_traer_detalle: true });
  assert.deepEqual(proveedorSiiActivo({ proveedor: '' }), { puede_traer_detalle: true });
});

// Contrato del payload: sin este campo el botón desaparece en silencio (falla
// hacia el lado seguro, pero se pierde la función sin que nada avise).
test('analizarPeriodo expone la capacidad del proveedor SII en el análisis', { skip: EN_PRODUCCION && SALTO_PROD }, async () => {
  await runMigrations();
  const rut = `99${Math.floor(Math.random() * 900000 + 100000)}`;
  const { rows } = await query(
    `INSERT INTO proveedores (nombre_empresa, rut) VALUES ('Empresa Capacidad SII', $1) RETURNING id`,
    [rut]
  );
  try {
    // Período sin documentos: el campo tiene que venir igual, porque de él
    // depende que la interfaz decida si ofrece el reintento.
    const a = await analizarPeriodo(query, rows[0].id, '2099-01');
    assert.equal(typeof a.proveedor_sii?.puede_traer_detalle, 'boolean');
  } finally {
    await query(`DELETE FROM proveedores WHERE id = $1`, [rows[0].id]);
  }
});
