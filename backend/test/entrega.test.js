import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { query, pool } from '../src/lib/db.js';
import { runMigrations } from '../src/lib/migrate.js';
import { EN_PRODUCCION, SALTO_PROD } from './util/soloDev.js';
import {
  generarClaveInforme, opcionesCifrado, pdfEstaCifrado, hashArchivo,
  claveDeProveedor, rotarClaveProveedor, registrarEntrega,
} from '../src/services/entrega.js';
import { generateComprobanteTransporte } from '../src/services/transportePdf.js';
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
