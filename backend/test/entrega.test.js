import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { query, pool } from '../src/lib/db.js';
import { runMigrations } from '../src/lib/migrate.js';
import { EN_PRODUCCION, SALTO_PROD } from './util/soloDev.js';
import {
  generarClaveInforme, opcionesCifrado, pdfEstaCifrado, hashArchivo,
  claveDeProveedor, claveDeCodigo, claveDeEntidad, rotarClaveProveedor, registrarEntrega,
} from '../src/services/entrega.js';
import { generateComprobanteTransporte } from '../src/services/transportePdf.js';
import { generateReport } from '../src/services/pdf.js';
import { reporteEmail, credencialesEmail } from '../src/services/mailer.js';
import { descifrar } from '../src/services/cripto.js';

// ============================================================
// Entrega cifrada del activo.
//
// Lo que estos casos protegen:
//  1. Que el PDF salga cifrado DE VERDAD, con AES-256 y no con el RC4
//     que pdfkit usa si falta `pdfVersion` — es la línea que más fácil se
//     borra "limpiando" opciones, y su ausencia no se nota mirando.
//  2. Que la clave de una empresa sea estable: si cambiara en cada envío,
//     los informes del mes pasado dejarían de abrirse.
//  3. Que el acuse guarde el hash del archivo TAL COMO SALIÓ.
// ============================================================

before(async () => { if (!EN_PRODUCCION) await runMigrations(); });
after(async () => { await pool.end(); });

// ---------- puro ----------

test('la clave no repite y usa un alfabeto que se puede dictar por teléfono', () => {
  const claves = new Set(Array.from({ length: 500 }, () => generarClaveInforme()));
  assert.equal(claves.size, 500);
  const c = generarClaveInforme();
  assert.equal(c.length, 16);
  // Sin 0/O ni 1/l/I: esta clave se dicta y se transcribe a mano.
  assert.equal(/[0O1lI]/.test(c), false, `"${c}" trae un carácter ambiguo`);
});

test('sin clave no se pide cifrado; con clave se pide AES-256', () => {
  assert.deepEqual(opcionesCifrado(null), {});
  assert.deepEqual(opcionesCifrado(''), {});

  const o = opcionesCifrado('MiClave99');
  assert.equal(o.userPassword, 'MiClave99');
  // ESTA LÍNEA ES LA QUE IMPORTA: sin `1.7ext3`, pdfkit cae a AESV2 (128
  // bits) o a RC4 según el caso, y el archivo queda con un cifrado que hoy
  // no alcanza. Se ve igual por fuera.
  assert.equal(o.pdfVersion, '1.7ext3');
  // La clave de propietario tiene que ser DISTINTA de la del lector: si
  // fueran iguales, quien abre el informe podría además reeditarlo.
  assert.notEqual(o.ownerPassword, o.userPassword);
  assert.equal(o.permissions.modifying, false);
});

test('EL CASO QUE IMPORTA: el PDF entregado sale cifrado con AES-256', async () => {
  const viaje = {
    id: 'p', fecha: '2026-08-13', modo: 'bus', origen: 'Calama', destino: 'Antofagasta',
    km: 210, pasajeros: 12, ida_vuelta: true, co2e: 0.31,
  };
  const empresa = { nombre_empresa: 'Aceros de Prueba SpA', rut: '11.111.111-1' };

  const claro = await generateComprobanteTransporte({ viaje, empresa, modoNombre: 'Bus' });
  const cifrado = await generateComprobanteTransporte({ viaje, empresa, modoNombre: 'Bus', clave: 'ClaveDePrueba99' });

  assert.equal(pdfEstaCifrado(claro), false, 'sin clave el PDF NO debe salir cifrado');
  assert.equal(pdfEstaCifrado(cifrado), true, 'con clave el PDF DEBE salir cifrado');
  // AESV3 es el identificador de AES-256 dentro del PDF. Si esto falla,
  // el archivo está cifrado pero con un algoritmo más débil del acordado.
  assert.ok(cifrado.includes(Buffer.from('AESV3')), 'el cifrado debe ser AES-256 (AESV3), no AESV2 ni RC4');
  // El texto del comprobante no puede quedar legible en el binario.
  assert.equal(cifrado.includes(Buffer.from('Antofagasta')), false,
    'el destino aparece en claro dentro del PDF cifrado');
});

test('el hash del archivo cambia con un solo byte distinto', () => {
  const a = Buffer.from('informe de julio');
  const b = Buffer.from('informe de Julio');
  assert.equal(hashArchivo(a).length, 64);
  assert.notEqual(hashArchivo(a), hashArchivo(b));
  assert.equal(hashArchivo(a), hashArchivo(Buffer.from('informe de julio')));
});

// ---------- integración ----------

async function proveedorDePrueba() {
  const { rows } = await query(
    `INSERT INTO proveedores (nombre_empresa, rut) VALUES ($1,$2) RETURNING *`,
    [`Prueba entrega ${crypto.randomUUID()}`, '11.111.111-1']
  );
  return rows[0];
}
async function limpiar(id) {
  await query(`DELETE FROM entregas WHERE proveedor_id = $1`, [id]);
  await query(`DELETE FROM proveedores WHERE id = $1`, [id]);
}

test('la clave de una empresa se crea una vez y NO cambia entre envíos', { skip: SALTO_PROD }, async () => {
  // Si cambiara en cada envío, el informe del mes pasado dejaría de
  // abrirse con la clave que el cliente tiene anotada.
  const prov = await proveedorDePrueba();
  try {
    const primera = await claveDeProveedor(prov.id);
    assert.ok(primera && primera.length === 16);
    const segunda = await claveDeProveedor(prov.id);
    assert.equal(segunda, primera, 'dos envíos seguidos tienen que usar la MISMA clave');

    // Y varias llamadas a la vez tampoco pueden dejar dos claves distintas.
    const paralelas = await Promise.all([1, 2, 3, 4].map(() => claveDeProveedor(prov.id)));
    assert.equal(new Set(paralelas).size, 1, 'la carrera dejó más de una clave');
  } finally { await limpiar(prov.id); }
});

test('la clave se guarda CIFRADA en reposo, nunca en claro', { skip: SALTO_PROD }, async () => {
  const prov = await proveedorDePrueba();
  try {
    const clave = await claveDeProveedor(prov.id);
    const { rows } = await query(`SELECT clave_informe FROM proveedores WHERE id = $1`, [prov.id]);
    const guardado = rows[0].clave_informe;

    assert.notEqual(guardado, clave, 'la columna NO puede contener la clave en claro');
    assert.equal(guardado.includes(clave), false, 'la clave aparece dentro del blob guardado');
    // Y se puede recuperar: es un secreto reversible a propósito, hay que
    // poder dictárselo al cliente.
    assert.equal(descifrar(guardado), clave);
  } finally { await limpiar(prov.id); }
});

test('rotar la clave da una nueva, y los informes viejos siguen abriéndose con la anterior', { skip: SALTO_PROD }, async () => {
  const prov = await proveedorDePrueba();
  try {
    const vieja = await claveDeProveedor(prov.id);
    const nueva = await rotarClaveProveedor(prov.id);
    assert.notEqual(nueva, vieja);
    assert.equal(await claveDeProveedor(prov.id), nueva);
    // El informe que ya se entregó no se re-cifra: sigue abriéndose con la
    // clave con que salió. Rotar protege lo que viene, no lo entregado.
    const viejoPdf = await generateComprobanteTransporte({
      viaje: { id: 'v', fecha: '2026-07-01', modo: 'bus', origen: 'A', destino: 'B', km: 1, pasajeros: 1, ida_vuelta: false, co2e: 0 },
      empresa: { nombre_empresa: 'X', rut: '11.111.111-1' }, modoNombre: 'Bus', clave: vieja,
    });
    assert.equal(pdfEstaCifrado(viejoPdf), true);
  } finally { await limpiar(prov.id); }
});

test('el acuse guarda el hash del archivo tal como salió, y si iba cifrado', { skip: SALTO_PROD }, async () => {
  const prov = await proveedorDePrueba();
  try {
    const archivo = Buffer.from('un informe cifrado cualquiera');
    await registrarEntrega({
      tipo: 'informe_mensual', proveedorId: prov.id, destinatario: 'contacto@ejemplo.cl',
      archivo, cifrado: true, periodo: '2026-07', referencia: 'sesion-x',
    });
    const { rows } = await query(`SELECT * FROM entregas WHERE proveedor_id = $1`, [prov.id]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].hash_archivo, hashArchivo(archivo));
    assert.equal(rows[0].bytes, archivo.length);
    assert.equal(rows[0].cifrado, true);
    assert.equal(rows[0].periodo, '2026-07');
    // El acuse NO guarda el contenido: solo su huella.
    assert.equal(Object.values(rows[0]).some((v) => String(v).includes('un informe')), false);
  } finally { await limpiar(prov.id); }
});

test('una entrega SIN cifrar queda marcada como tal', { skip: SALTO_PROD }, async () => {
  // Si algún día falta la llave maestra y los informes salen en claro,
  // tiene que quedar constancia de cuáles fueron — no pasar inadvertido.
  const prov = await proveedorDePrueba();
  try {
    await registrarEntrega({
      tipo: 'comprobante_transporte', proveedorId: prov.id, destinatario: 'x@ejemplo.cl',
      archivo: Buffer.from('en claro'), cifrado: false,
    });
    const { rows } = await query(
      `SELECT count(*)::int AS n FROM entregas WHERE proveedor_id = $1 AND cifrado = false`, [prov.id]
    );
    assert.equal(rows[0].n, 1);
  } finally { await limpiar(prov.id); }
});

test('el acuse no tumba la entrega si falla', { skip: SALTO_PROD }, async () => {
  // Un tipo inválido rompe el CHECK. La entrega ya ocurrió: registrarla
  // mal no puede convertirse en una excepción hacia el llamador.
  await assert.doesNotReject(registrarEntrega({
    tipo: 'inventado', destinatario: 'x@ejemplo.cl', archivo: Buffer.from('x'), cifrado: false,
  }));
});

// ---------- la clave del CÓDIGO DE ACCESO (flujo público del informe) ----------
//
// Este es el camino por el que sale el activo que se vende. Quedó sin
// cifrar cuando se hizo el de transporte, por una razón concreta: acá no
// hay `proveedor_id` —quien sube documentos se identifica con un código de
// acceso— así que no había entidad de la que sacar la clave.

async function codigoDePrueba(creditos = 5) {
  const { rows } = await query(
    `INSERT INTO codigos_acceso (codigo, creditos, empresa, email)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [`PRUEBA-${crypto.randomUUID().slice(0, 13).toUpperCase()}`, creditos,
     'Empresa de prueba', 'prueba@ejemplo.cl']
  );
  return rows[0];
}
async function limpiarCodigo(id) {
  await query(`DELETE FROM entregas WHERE codigo_id = $1`, [id]);
  await query(`DELETE FROM codigos_acceso WHERE id = $1`, [id]);
}

test('la clave de un código se crea una vez y NO cambia entre envíos', { skip: SALTO_PROD }, async () => {
  const cod = await codigoDePrueba();
  try {
    const primera = await claveDeCodigo(cod.id);
    assert.ok(primera && primera.length === 16);
    assert.equal(await claveDeCodigo(cod.id), primera, 'dos informes seguidos usan la MISMA clave');

    // Misma carrera que la de proveedores: varias entregas a la vez no
    // pueden dejar dos claves distintas, o el informe del mes pasado deja
    // de abrirse.
    const paralelas = await Promise.all([1, 2, 3, 4].map(() => claveDeCodigo(cod.id)));
    assert.equal(new Set(paralelas).size, 1, 'la carrera dejó más de una clave');
    assert.equal(paralelas[0], primera);
  } finally { await limpiarCodigo(cod.id); }
});

test('la clave del código se guarda CIFRADA en reposo', { skip: SALTO_PROD }, async () => {
  const cod = await codigoDePrueba();
  try {
    const clave = await claveDeCodigo(cod.id);
    const { rows } = await query(`SELECT clave_informe FROM codigos_acceso WHERE id = $1`, [cod.id]);
    assert.notEqual(rows[0].clave_informe, clave, 'la columna NO puede tener la clave en claro');
    assert.equal(rows[0].clave_informe.includes(clave), false);
    assert.equal(descifrar(rows[0].clave_informe), clave);
  } finally { await limpiarCodigo(cod.id); }
});

test('una tabla que no porta clave es un error, no una consulta', () => {
  // El nombre de tabla se interpola en el SQL (Postgres no admite bind de
  // identificadores). La lista blanca es lo que impide que eso sea un
  // agujero; si alguien la saltara, tiene que romperse fuerte y no armar
  // una consulta con lo que venga.
  assert.rejects(() => claveDeEntidad({ tabla: 'usuarios', id: crypto.randomUUID() }), /sin clave de informe/);
  assert.rejects(() => claveDeEntidad({ tabla: 'proveedores; DROP TABLE x', id: '1' }), /sin clave de informe/);
});

test('EL CASO QUE FALTABA: el informe consolidado sale cifrado con AES-256', { skip: SALTO_PROD }, async () => {
  const cod = await codigoDePrueba();
  try {
    const clave = await claveDeCodigo(cod.id);
    const sesion = {
      id: crypto.randomUUID(), rut_cliente: '11.111.111-1', nombre_cliente: 'Empresa de prueba',
      email_cliente: 'prueba@ejemplo.cl', fecha: '2026-08-18', total_co2e: 1.5,
    };
    const facturas = [{
      id: crypto.randomUUID(), proveedor: 'Proveedor X', monto: 100000, total_co2e: 1.5,
      categoria: 'combustible', fecha: '2026-08-01', hash_documento: 'a'.repeat(64),
    }];
    const pdf = await generateReport({ sesion, facturas, declaracion: null, alcances: [], clave });
    assert.equal(pdfEstaCifrado(pdf), true, 'el informe consolidado salió EN CLARO');
    // AESV3 = AES-256. Sin `pdfVersion: 1.7ext3` pdfkit cae a AESV2 (128)
    // o a RC4 y el archivo se ve idéntico por fuera.
    assert.ok(pdf.includes(Buffer.from('AESV3')), 'no es AES-256');

    // Y el mismo informe SIN clave sale en claro: es el caso de la carga
    // por magic link, donde no hay código del que colgar una clave.
    const enClaro = await generateReport({ sesion, facturas, declaracion: null, alcances: [] });
    assert.equal(pdfEstaCifrado(enClaro), false);
  } finally { await limpiarCodigo(cod.id); }
});

test('el acuse del informe anota con qué código se cifró', { skip: SALTO_PROD }, async () => {
  const cod = await codigoDePrueba();
  try {
    const archivo = Buffer.from('informe consolidado cifrado');
    await registrarEntrega({
      tipo: 'informe_sesion', codigoId: cod.id, destinatario: 'prueba@ejemplo.cl',
      archivo, cifrado: true, referencia: 'sesion-y',
    });
    const { rows } = await query(`SELECT * FROM entregas WHERE codigo_id = $1`, [cod.id]);
    assert.equal(rows.length, 1);
    // Sin esto el acuse no puede responder "¿con qué llave se abre esto?",
    // que es justo la pregunta para la que la tabla existe.
    assert.equal(rows[0].codigo_id, cod.id);
    assert.equal(rows[0].proveedor_id, null);
    assert.equal(rows[0].cifrado, true);
    assert.equal(rows[0].hash_archivo, hashArchivo(archivo));
  } finally { await limpiarCodigo(cod.id); }
});

test('un informe sin código queda anotado como NO cifrado', { skip: SALTO_PROD }, async () => {
  // La carga con sesión de cliente (magic link) no tiene código: el
  // informe sale en claro y eso NO puede ser silencioso.
  await registrarEntrega({
    tipo: 'informe_sesion', destinatario: 'sincodigo@ejemplo.cl',
    archivo: Buffer.from('en claro'), cifrado: false, referencia: 'sesion-z',
  });
  const { rows } = await query(
    `SELECT * FROM entregas WHERE referencia = 'sesion-z' AND tipo = 'informe_sesion'`
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cifrado, false);
  assert.equal(rows[0].codigo_id, null);
  assert.equal(rows[0].proveedor_id, null);
  await query(`DELETE FROM entregas WHERE referencia = 'sesion-z'`);
});

// ---------- la regla que sostiene todo el cifrado ----------

test('LA REGLA: la clave va en el correo de credenciales y NUNCA en el del informe', () => {
  const clave = 'AbCdEfGh23456789';

  // El correo de credenciales NO lleva adjunto — es el único que puede
  // llevar la clave.
  const cred = credencialesEmail({
    empresa: 'Minera X', codigo: 'SICR3P-AAAA-BBBB-CCCC', creditos: 10,
    link: 'https://sicr3p.cl/prueba', claveInforme: clave,
  });
  assert.ok(cred.html.includes(clave), 'la clave tiene que llegar por algún lado');

  // Y sin clave el bloque simplemente no se dibuja (falta la llave
  // maestra): no queda un recuadro vacío prometiendo algo que no está.
  const sinClave = credencialesEmail({
    empresa: 'Minera X', codigo: 'SICR3P-AAAA-BBBB-CCCC', creditos: 10, link: 'l',
  });
  assert.equal(/CLAVE PARA ABRIR/.test(sinClave.html), false);

  // El correo del informe SÍ lleva el adjunto: avisa que va cifrado y NO
  // trae la clave. Si esto se rompe, el cifrado queda en decoración.
  const inf = reporteEmail({ nombre: 'Minera X', totalCo2e: 12.5, nFacturas: 3, cifrado: true });
  assert.ok(/cifrado/i.test(inf.html), 'sin el aviso, un PDF con contraseña parece dañado');
  assert.equal(inf.html.includes(clave), false, 'LA CLAVE VIAJÓ CON EL ARCHIVO');

  // Sin cifrar no se avisa de nada.
  assert.equal(/está cifrado/.test(reporteEmail({ nombre: 'X', totalCo2e: 1, nFacturas: 1 }).html), false);
});

test('un código de CAMPAÑA del juego nunca recibe clave de informes', { skip: SALTO_PROD }, async () => {
  // Casi se rompe esto: en `POST /api/sesiones` un jugador de "Sube y
  // Suma" carga con el código de SU CAMPAÑA, que comparten todos los
  // jugadores de esa empresa. Cifrar con esa clave no protegería a ningún
  // jugador de otro — y, peor, el jugador entra por magic link y NUNCA
  // recibe una clave de informes, así que habría recibido un PDF que no
  // puede abrir. Un archivo inutilizable no protege nada: solo se pierde.
  const { rows } = await query(
    `INSERT INTO codigos_acceso (codigo, creditos, empresa, email, modo_juego)
     VALUES ($1, 20, 'Campaña', 'campana@ejemplo.cl', true) RETURNING *`,
    [`CAMP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`]
  );
  const campana = rows[0];
  try {
    assert.equal(await claveDeCodigo(campana.id), null, 'una campaña NO puede portar clave');
    // Y no se creó una en la base "por si acaso".
    const { rows: k } = await query(`SELECT clave_informe FROM codigos_acceso WHERE id = $1`, [campana.id]);
    assert.equal(k[0].clave_informe, null);
  } finally { await limpiarCodigo(campana.id); }
});

test('un código inexistente no revienta ni inventa una clave', { skip: SALTO_PROD }, async () => {
  assert.equal(await claveDeCodigo(crypto.randomUUID()), null);
  assert.equal(await claveDeCodigo(null), null);
});
