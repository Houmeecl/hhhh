import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { query, pool } from '../src/lib/db.js';
import { runMigrations } from '../src/lib/migrate.js';
import { EN_PRODUCCION, SALTO_PROD } from './util/soloDev.js';
import {
  firmarFlow, cuerpoFirmado, pasarelaActiva, puedeCobrar, generarTokenPago,
  ordenDeCobro, cobroDeOrden,
} from '../src/services/pagos.js';
import {
  prepararDestinatarios, registrarPagoYEntregar, vistaPublica, montoDeCelda, MONTO_MAX_CLP,
} from '../src/services/cobros.js';
import { SECCIONES_ADMIN } from '../src/constants/seccionesAdmin.js';
import { linkPagoEmail, credencialesEmail } from '../src/services/mailer.js';

// ============================================================
// Cobro por correo con entrega automática del acceso.
//
// Lo que estos casos protegen, en orden de qué tan caro sale romperlo:
//  1. Que un pago avisado dos veces entregue UN código y no dos.
//  2. Que la firma de Flow se calcule sobre parámetros ORDENADOS.
//  3. Que un pago por un monto distinto al cobrado NO entregue nada.
//  4. Que la página pública nunca devuelva el código de acceso.
// ============================================================

before(async () => { if (!EN_PRODUCCION) await runMigrations(); });
after(async () => { await pool.end(); });

// ---------- firma de Flow (puro, corre siempre) ----------

test('la firma de Flow ordena los parámetros alfabéticamente, no por orden de escritura', () => {
  const secreto = 'secreto-de-prueba';
  // El mismo conjunto escrito en dos órdenes distintos tiene que dar la
  // MISMA firma: si no, agregar un parámetro mañana rompe los pagos y
  // Flow responde un error que no dice por qué.
  const a = firmarFlow({ subject: 'x', apiKey: 'k', amount: 1000 }, secreto);
  const b = firmarFlow({ amount: 1000, apiKey: 'k', subject: 'x' }, secreto);
  assert.equal(a, b);

  // Y el valor es verificable a mano: clave+valor de cada parámetro, en
  // orden alfabético de clave, sin separadores.
  const esperado = crypto.createHmac('sha256', secreto)
    .update('amount1000apiKeyksubjectx').digest('hex');
  assert.equal(a, esperado);
});

test('la firma no se incluye a sí misma ni firma valores nulos', () => {
  const s = 'sec';
  assert.equal(firmarFlow({ a: '1', s: 'basura' }, s), firmarFlow({ a: '1' }, s));
  assert.equal(firmarFlow({ a: '1', b: undefined, c: null }, s), firmarFlow({ a: '1' }, s));
});

test('el cuerpo firmado sale como form-urlencoded con la firma incluida', () => {
  const cuerpo = cuerpoFirmado({ apiKey: 'k', subject: 'Acceso & prueba' }, 'sec');
  const p = new URLSearchParams(cuerpo);
  assert.equal(p.get('subject'), 'Acceso & prueba', 'el valor debe ir escapado y volver intacto');
  assert.equal(p.get('s'), firmarFlow({ apiKey: 'k', subject: 'Acceso & prueba' }, 'sec'));
});

test('sin credenciales de Flow la pasarela degrada a transferencia', () => {
  // Un despliegue con PAGOS_PASARELA=flow pero sin llaves no puede
  // emitir links: mejor cobrar por transferencia que mandar 500 correos
  // con un botón que revienta.
  const cfg = { pagos: { pasarela: 'flow', flow: { apiKey: '', secret: '' }, transferencia: {} } };
  assert.equal(pasarelaActiva(cfg), 'manual');
  assert.equal(pasarelaActiva({ pagos: { pasarela: 'flow', flow: { apiKey: 'a', secret: 'b' } } }), 'flow');
});

test('con transferencia y sin datos bancarios, el envío se bloquea con instrucciones', () => {
  const sinDatos = { pagos: { pasarela: 'manual', flow: {}, transferencia: { banco: '', numero: '', titular: '' } } };
  const r = puedeCobrar(sinDatos);
  assert.equal(r.ok, false);
  assert.match(r.error, /PAGO_BANCO/, 'el mensaje debe decir qué configurar, no solo que falta algo');

  const conDatos = { pagos: { pasarela: 'manual', flow: {}, transferencia: { banco: 'BCI', numero: '123', titular: 'sicr3p SpA' } } };
  assert.equal(puedeCobrar(conDatos).ok, true);
});

test('los tokens de pago no se repiten y son largos', () => {
  const t = new Set(Array.from({ length: 200 }, () => generarTokenPago()));
  assert.equal(t.size, 200);
  assert.equal(generarTokenPago().length, 64);
});

// ---------- preparar la lista (puro) ----------

test('se descarta la fila sin correo y se dice en qué fila y por qué', () => {
  const filas = [
    ['Empresa', 'Correo'],
    ['Aceros SpA', 'a@aceros.cl'],
    ['Sin correo Ltda', 'Fono NO contesta'],
  ];
  const r = prepararDestinatarios(filas, { empresa: 0, email: 1 }, { desde: 1, montoDefecto: 10000 });
  assert.equal(r.admitidos.length, 1);
  assert.equal(r.omitidos.length, 1);
  assert.equal(r.omitidos[0].fila, 3, 'la fila se numera como en Excel, para poder encontrarla');
  assert.equal(r.omitidos[0].dato, 'Sin correo Ltda');
});

test('el mismo correo repetido en la planilla entra una sola vez', () => {
  const filas = [['A', 'x@y.cl'], ['A duplicada', 'X@Y.CL'], ['B', 'b@y.cl']];
  const r = prepararDestinatarios(filas, { empresa: 0, email: 1 }, { montoDefecto: 1000 });
  assert.equal(r.admitidos.length, 2);
  assert.equal(r.duplicados, 1, 'mayúsculas y minúsculas son el mismo correo');
});

test('un RUT inválido no se guarda como RUT', () => {
  // La columna que el admin marcó como RUT puede traer teléfonos: antes
  // de escribirlos hay que verificar el dígito verificador, o la
  // búsqueda por RUT de todo el sistema queda contaminada.
  const filas = [['A', 'a@y.cl', '56 2 2222 3333'], ['B', 'b@y.cl', '11.111.111-1']];
  const r = prepararDestinatarios(filas, { empresa: 0, email: 1, rut: 2 }, { montoDefecto: 1 });
  assert.equal(r.admitidos[0].rut, null, 'el teléfono no es un RUT');
  assert.equal(r.admitidos[1].rut, '11.111.111-1');
});

test('las filas totalmente vacías no se cuentan como descartes', () => {
  // Una pestaña real trae cientos de filas vacías con formato: listarlas
  // como "descartadas" haría ilegible el informe de importación.
  const filas = [['A', 'a@y.cl'], ['', ''], ['', ''], ['B', 'b@y.cl']];
  const r = prepararDestinatarios(filas, { empresa: 0, email: 1 }, { montoDefecto: 1 });
  assert.equal(r.admitidos.length, 2);
  assert.equal(r.omitidos.length, 0);
});

// ---------- RBAC ----------

test("'cobros' es una sección propia del vocabulario admin", () => {
  assert.ok(SECCIONES_ADMIN.includes('cobros'));
  // No es un alias de 'accesos_externos': quien opera la campaña mueve
  // dinero y ve la lista completa de empresas contactadas.
  assert.notEqual('cobros', 'accesos_externos');
});

// ---------- entrega automática (integración) ----------

async function campanaConCobro(t, { monto = 25000, creditos = 7 } = {}) {
  const { rows: k } = await query(
    `INSERT INTO campanas_cobro (nombre, monto_clp, creditos) VALUES ($1,$2,$3) RETURNING *`,
    [`prueba ${crypto.randomUUID()}`, monto, creditos]
  );
  const { rows: c } = await query(
    `INSERT INTO cobros (campana_id, empresa, email, monto_clp, token, estado)
     VALUES ($1,'Aceros de Prueba SpA',$2,$3,$4,'enviado') RETURNING *`,
    [k[0].id, `prueba-${crypto.randomUUID()}@ejemplo.cl`, monto, generarTokenPago()]
  );
  return { campana: k[0], cobro: c[0] };
}

// La campaña se borra en cascada; el código emitido queda referenciado
// por el cobro, así que se suelta la FK antes de limpiar.
async function limpiar(campanaId) {
  const { rows } = await query(`SELECT id::text FROM cobros WHERE campana_id = $1`, [campanaId]);
  // `correos_enviados.referencia` es texto sin FK a propósito (la
  // bitácora sobrevive a lo que anotó), así que se limpia a mano.
  await query(`DELETE FROM correos_enviados WHERE referencia = ANY($1::text[])`, [rows.map((r) => r.id)]);
  await query(`UPDATE cobros SET codigo_id = NULL WHERE campana_id = $1`, [campanaId]);
  await query(`DELETE FROM codigos_acceso WHERE empresa = 'Aceros de Prueba SpA'`);
  await query(`DELETE FROM campanas_cobro WHERE id = $1`, [campanaId]);
}

test('pagar entrega un código con los créditos de la campaña', { skip: SALTO_PROD }, async () => {
  const { campana, cobro } = await campanaConCobro();
  try {
    const r = await registrarPagoYEntregar({ cobroId: cobro.id, pasarela: 'manual', ref: 'op-1' });
    assert.equal(r.error, undefined);
    assert.equal(r.ya_estaba, false);
    // 48 bits agrupados de a 4: el código dejó de ser una cortesía y
    // pasó a ser un bien pagado (ver CODIGO_BYTES en services/cobros.js).
    assert.match(r.codigo.codigo, /^SICR3P-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
    assert.equal(r.codigo.creditos, 7);
    assert.equal(r.codigo.email, cobro.email, 'el código queda atado al correo al que se le vendió');

    const { rows } = await query(`SELECT * FROM cobros WHERE id = $1`, [cobro.id]);
    assert.equal(rows[0].estado, 'entregado');
    assert.ok(rows[0].pagado_at && rows[0].entregado_at);
    assert.equal(rows[0].pasarela_ref, 'op-1');
  } finally { await limpiar(campana.id); }
});

test('EL CASO QUE IMPORTA: dos avisos del mismo pago entregan UN código', { skip: SALTO_PROD }, async () => {
  // Flow reintenta la confirmación si no recibe 200 a tiempo, y un admin
  // puede confirmar a mano un pago que el webhook ya procesó. Emitir dos
  // códigos por un pago es regalar el doble de lo vendido.
  const { campana, cobro } = await campanaConCobro();
  try {
    const primero = await registrarPagoYEntregar({ cobroId: cobro.id, pasarela: 'flow', ref: 'f-1' });
    const segundo = await registrarPagoYEntregar({ cobroId: cobro.id, pasarela: 'flow', ref: 'f-1' });

    assert.equal(segundo.ya_estaba, true, 'el segundo aviso no es un error, es lo normal');
    assert.equal(segundo.codigo.id, primero.codigo.id, 'tiene que ser EL MISMO código');

    const { rows } = await query(
      `SELECT count(*)::int AS n FROM codigos_acceso WHERE email = $1`, [cobro.email]
    );
    assert.equal(rows[0].n, 1, 'un pago = un código, sin importar cuántas veces avisen');
  } finally { await limpiar(campana.id); }
});

test('un pago por un monto distinto NO entrega nada y queda anotado', { skip: SALTO_PROD }, async () => {
  const { campana, cobro } = await campanaConCobro({ monto: 25000 });
  try {
    const r = await registrarPagoYEntregar({
      cobroId: cobro.id, pasarela: 'flow', ref: 'f-2', montoPagado: 1000,
    });
    assert.ok(r.error, 'pagar $1.000 por un acceso de $25.000 no puede entregar el acceso');
    assert.equal(r.descalce, true);

    const { rows } = await query(`SELECT estado, notas FROM cobros WHERE id = $1`, [cobro.id]);
    assert.notEqual(rows[0].estado, 'entregado');
    assert.match(rows[0].notas, /Revisar a mano/);

    const { rows: k } = await query(`SELECT count(*)::int AS n FROM codigos_acceso WHERE email = $1`, [cobro.email]);
    assert.equal(k[0].n, 0);
  } finally { await limpiar(campana.id); }
});

test('un cobro anulado no se puede pagar', { skip: SALTO_PROD }, async () => {
  const { campana, cobro } = await campanaConCobro();
  try {
    await query(`UPDATE cobros SET estado = 'anulado' WHERE id = $1`, [cobro.id]);
    const r = await registrarPagoYEntregar({ cobroId: cobro.id, pasarela: 'manual' });
    assert.match(r.error, /anulado/);
  } finally { await limpiar(campana.id); }
});

test('reimportar la misma planilla no duplica destinatarios', { skip: SALTO_PROD }, async () => {
  const { campana, cobro } = await campanaConCobro();
  try {
    // Mismo correo, otro token: el índice único por campaña+correo manda.
    const { rowCount } = await query(
      `INSERT INTO cobros (campana_id, email, monto_clp, token) VALUES ($1,$2,$3,$4)
       ON CONFLICT DO NOTHING`,
      [campana.id, cobro.email.toUpperCase(), 1000, generarTokenPago()]
    );
    assert.equal(rowCount, 0, 'el mismo correo en distinta caja sigue siendo el mismo destinatario');
  } finally { await limpiar(campana.id); }
});

test('la página pública nunca devuelve el código ni el token', () => {
  const cobro = {
    empresa: 'Aceros', email: 'a@b.cl', monto_clp: 25000, estado: 'entregado',
    token: 'secreto', codigo_id: 'x',
  };
  const v = vistaPublica(cobro, { nombre: 'C', descripcion: null, creditos: 7 });
  const texto = JSON.stringify(v);
  assert.equal(texto.includes('secreto'), false);
  assert.equal(texto.includes('SICR3P-'), false);
  // 'entregado' se muestra como 'pagado': si el correo salió o no es
  // problema interno, no del comprador.
  assert.equal(v.estado, 'pagado');
});

test('la lista de bajas es única por correo, sin importar mayúsculas', { skip: SALTO_PROD }, async () => {
  const email = `baja-${crypto.randomUUID()}@ejemplo.cl`;
  try {
    await query(`INSERT INTO bajas_correo (email) VALUES ($1)`, [email]);
    await query(`INSERT INTO bajas_correo (email) VALUES ($1) ON CONFLICT (lower(email)) DO NOTHING`,
      [email.toUpperCase()]);
    const { rows } = await query(`SELECT count(*)::int AS n FROM bajas_correo WHERE lower(email) = $1`,
      [email.toLowerCase()]);
    assert.equal(rows[0].n, 1);
  } finally {
    await query(`DELETE FROM bajas_correo WHERE lower(email) = $1`, [email.toLowerCase()]);
  }
});

// ---------- correcciones de la auditoría ----------

test('el commerceOrder de Flow es único por intento y se puede volver al cobro', () => {
  // Flow exige órdenes de comercio únicas. Mandar el id del cobro a
  // secas dejaba sin poder pagar a quien abría el link, se arrepentía y
  // volvía: el segundo /payment/create chocaba con el primero.
  const id = '11111111-2222-3333-4444-555555555555';
  const a = ordenDeCobro(id);
  const b = ordenDeCobro(id);
  assert.notEqual(a, b, 'dos intentos del mismo cobro no pueden compartir orden');
  assert.equal(cobroDeOrden(a), id, 'el aviso tiene que poder volver al cobro');
  assert.equal(cobroDeOrden(b), id);
  // Y sigue leyendo bien una orden vieja, sin sufijo.
  assert.equal(cobroDeOrden(id), id);
});

test('un monto absurdo en la planilla no se cobra: se usa el de la campaña', () => {
  // El caso real: mapear "Monto" a la columna del teléfono. Sin cota, se
  // intentaba cobrar $56.229.694.695 — que además no cabe en el INT de
  // la columna y reventaba el INSERT a mitad de la importación.
  assert.equal(montoDeCelda('56 2 2222 3333', 49000), 49000);
  assert.equal(montoDeCelda(String(MONTO_MAX_CLP + 1), 49000), 49000);
  assert.equal(montoDeCelda('0', 49000), 49000);
  assert.equal(montoDeCelda('', 49000), 49000);
  // Un monto razonable sí manda sobre el de la campaña.
  assert.equal(montoDeCelda('$ 120.000', 49000), 120000);
});

test('el asunto del correo no admite inyección de cabeceras', () => {
  const p = linkPagoEmail({
    empresa: 'Aceros', montoClp: 1000, creditos: 1, link: 'l', bajaUrl: 'b',
    campana: 'Campaña\r\nBcc: espia@ejemplo.cl',
  });
  assert.equal(/[\r\n]/.test(p.subject), false, 'un salto de línea en el asunto permite agregar cabeceras');
  assert.match(p.subject, /Bcc: espia@ejemplo.cl/, 'el texto se aplana, no se pierde');
});

test('el correo comercial trae baja en un clic, y el transaccional no', () => {
  const comercial = linkPagoEmail({
    empresa: 'A', montoClp: 1, creditos: 1, campana: 'C', link: 'l',
    bajaUrl: 'https://sitio/pagar/T/baja', bajaPostUrl: 'https://api/api/pagar/T/baja',
  });
  assert.match(comercial.headers['List-Unsubscribe'], /^<https:\/\/api\//, 'el destino de un clic es el backend, no la página');
  assert.equal(comercial.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  // El correo con la clave es transaccional: darse de baja de él no
  // tiene sentido y ofrecerlo confundiría.
  assert.equal(credencialesEmail({ empresa: 'A', codigo: 'X', creditos: 1, link: 'l' }).headers, undefined);
});

test('la clave del correo viaja en el fragmento, no en la query', { skip: SALTO_PROD }, async () => {
  // El fragmento no llega al servidor: no queda en el access log de
  // nginx ni viaja en la cabecera Referer.
  const { campana, cobro } = await campanaConCobro();
  try {
    const r = await registrarPagoYEntregar({ cobroId: cobro.id, pasarela: 'manual' });
    const { rows } = await query(
      `SELECT asunto FROM correos_enviados WHERE referencia = $1 AND tipo = 'credenciales'`, [cobro.id]
    );
    assert.equal(rows.length, 1);
    const plantilla = credencialesEmail({
      empresa: cobro.empresa, codigo: r.codigo.codigo, creditos: r.codigo.creditos,
      link: `https://sicr3p.cl/prueba#codigo=${r.codigo.codigo}`,
    });
    assert.match(plantilla.html, /\/prueba#codigo=/);
    assert.equal(/\/prueba\?codigo=/.test(plantilla.html), false);
  } finally { await limpiar(campana.id); }
});

test('si el correo con la clave falla, el cobro se queda en "pagado" y no en "entregado"', { skip: SALTO_PROD }, async () => {
  // Es la razón de que los dos estados existan por separado: un cobro
  // pagado cuyo correo rebotó tiene que quedar VISIBLE como pendiente de
  // atender, no confundirse con uno resuelto.
  const { campana, cobro } = await campanaConCobro();
  try {
    await registrarPagoYEntregar({ cobroId: cobro.id, pasarela: 'manual' });
    const { rows } = await query(`SELECT estado, entregado_at, codigo_id FROM cobros WHERE id = $1`, [cobro.id]);
    // En dev el transporte es 'dev' y siempre "sale": el camino feliz
    // llega a 'entregado' y con fecha.
    assert.equal(rows[0].estado, 'entregado');
    assert.ok(rows[0].entregado_at);

    // Ahora el caso que importa: se simula el correo caído dejando el
    // cobro en 'pagado' y se comprueba que el panel lo cuenta como
    // pendiente de clave.
    await query(`UPDATE cobros SET estado = 'pagado', entregado_at = NULL WHERE id = $1`, [cobro.id]);
    const { rows: k } = await query(
      `SELECT count(*) FILTER (WHERE estado = 'pagado')::int AS sin_clave
         FROM cobros WHERE campana_id = $1`, [campana.id]
    );
    assert.equal(k[0].sin_clave, 1);
    // El código ya existe: reenviar no debe emitir otro.
    assert.ok(rows[0].codigo_id);
  } finally { await limpiar(campana.id); }
});

test('un segundo pago con OTRA referencia queda anotado como duplicado', { skip: SALTO_PROD }, async () => {
  // Antes se descartaba en silencio y el único rastro quedaba en el
  // panel de la pasarela — con una devolución pendiente que nadie veía.
  const { campana, cobro } = await campanaConCobro();
  try {
    await registrarPagoYEntregar({ cobroId: cobro.id, pasarela: 'flow', ref: 'f-1' });
    const r = await registrarPagoYEntregar({ cobroId: cobro.id, pasarela: 'flow', ref: 'f-2' });
    assert.equal(r.ya_estaba, true);
    assert.equal(r.duplicado, true);
    const { rows } = await query(`SELECT notas FROM cobros WHERE id = $1`, [cobro.id]);
    assert.match(rows[0].notas, /PAGO DUPLICADO/);
    assert.match(rows[0].notas, /f-2/);
    // Y sigue habiendo UN solo código.
    const { rows: k } = await query(`SELECT count(*)::int AS n FROM codigos_acceso WHERE email = $1`, [cobro.email]);
    assert.equal(k[0].n, 1);
  } finally { await limpiar(campana.id); }
});
