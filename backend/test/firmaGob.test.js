import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import {
  AMBIENTES, MAX_SOLICITUD_BYTES, MAX_EXPIRACION_MIN, TIPOS_PERMITIDOS,
  horaChilena, runParaToken, construirToken, archivoParaFirma,
  layoutFirmaVisible, normalizarRespuesta, firmarDocumentos,
} from '../src/services/firmaGob.js';

const decodificar = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());

// ---------- hora chilena ----------

test('horaChilena entrega el formato ISODate que pide el documento', () => {
  assert.match(horaChilena(new Date('2026-07-28T12:00:00Z')), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
});

test('horaChilena sigue el huso de Santiago en invierno y en verano', () => {
  // El documento pide "hora chilena". Chile cambia de huso dos veces al
  // año: restar 4 horas fijas deja de firmar medio año. Se verifica que el
  // desfase contra UTC no sea el mismo en enero que en julio.
  const enero = horaChilena(new Date('2026-01-15T12:00:00Z'));
  const julio = horaChilena(new Date('2026-07-15T12:00:00Z'));
  assert.equal(enero.slice(11, 13), '09'); // UTC-3 (horario de verano)
  assert.equal(julio.slice(11, 13), '08'); // UTC-4 (horario de invierno)
});

// ---------- RUN ----------

test('runParaToken quita puntos, guión y dígito verificador', () => {
  assert.equal(runParaToken('11.111.111-1'), '11111111');
  assert.equal(runParaToken('22222222-2'), '22222222');
  assert.equal(runParaToken('9.876.543-K'), '9876543');
});

test('runParaToken rechaza un RUT que no sirve', () => {
  assert.throws(() => runParaToken(''), /RUT inválido/);
  assert.throws(() => runParaToken('-'), /RUT inválido/);
});

// ---------- token ----------

test('construirToken arma un JWT HS256 verificable con el secreto', () => {
  const token = construirToken({
    run: '22.222.222-2', entity: 'Subsecretaría General de La Presidencia',
    purpose: 'Desatendido', secreto: 'abcd',
  });
  const [head, body, firma] = token.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(head, 'base64url').toString()), { alg: 'HS256', typ: 'JWT' });
  const esperada = crypto.createHmac('sha256', 'abcd').update(`${head}.${body}`).digest('base64url');
  assert.equal(firma, esperada);
});

test('el payload lleva exactamente los cuatro campos del documento', () => {
  const p = decodificar(construirToken({
    run: '22222222-2', entity: 'X', purpose: 'Desatendido', secreto: 'abcd',
    ahora: new Date('2026-07-28T12:00:00Z'),
  }));
  assert.deepEqual(Object.keys(p).sort(), ['entity', 'expiration', 'purpose', 'run']);
  assert.equal(p.run, '22222222');
  assert.match(p.expiration, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
});

test('la expiración no puede pasar los 30 minutos que acepta la API', () => {
  assert.throws(
    () => construirToken({ run: '1-9', entity: 'X', purpose: 'Y', secreto: 'abcd', minutos: MAX_EXPIRACION_MIN + 1 }),
    /no puede superar/
  );
  assert.doesNotThrow(() => construirToken({ run: '1-9', entity: 'X', purpose: 'Y', secreto: 'abcd', minutos: MAX_EXPIRACION_MIN }));
});

test('sin secreto, entidad o propósito no se arma el token', () => {
  assert.throws(() => construirToken({ run: '1-9', entity: 'X', purpose: 'Y' }), /secreto/);
  assert.throws(() => construirToken({ run: '1-9', purpose: 'Y', secreto: 'a' }), /entity/);
  assert.throws(() => construirToken({ run: '1-9', entity: 'X', secreto: 'a' }), /purpose/);
});

// ---------- archivos ----------

test('archivoParaFirma manda checksum del ORIGINAL y contenido en base64', () => {
  const buf = Buffer.from('contenido del contrato');
  const f = archivoParaFirma({ buffer: buf, descripcion: 'Contrato CT-ABC' });
  assert.equal(f.checksum, crypto.createHash('sha256').update(buf).digest('hex'));
  assert.equal(Buffer.from(f.content, 'base64').toString(), 'contenido del contrato');
  assert.equal(f['content-type'], 'application/pdf');
  assert.equal(f.layout, undefined); // sin layout no se manda la clave
});

test('archivoParaFirma rechaza tipos fuera de los tres permitidos', () => {
  assert.deepEqual(TIPOS_PERMITIDOS, ['application/pdf', 'application/xml', 'application/json']);
  assert.throws(
    () => archivoParaFirma({ buffer: Buffer.from('x'), descripcion: 'd', contentType: 'image/png' }),
    /no permitido/
  );
  assert.throws(() => archivoParaFirma({ buffer: 'no soy buffer', descripcion: 'd' }), /Buffer/);
});

// ---------- layout ----------

test('layoutFirmaVisible arma el AgileSignerConfig del Anexo B', () => {
  const xml = layoutFirmaVisible({ imagenBase64: 'SU1BR0VO', llx: 10, lly: 20, urx: 30, ury: 40, page: 2 });
  assert.ok(xml.startsWith('<AgileSignerConfig>'));
  assert.ok(xml.includes('<llx>10</llx><lly>20</lly><urx>30</urx><ury>40</ury>'));
  assert.ok(xml.includes('<page>2</page>'));
  assert.ok(xml.includes('<image>BASE64</image><BASE64VALUE>SU1BR0VO</BASE64VALUE>'));
});

test('layoutFirmaVisible usa LAST por defecto y exige la imagen', () => {
  assert.ok(layoutFirmaVisible({ imagenBase64: 'x' }).includes('<page>LAST</page>'));
  assert.throws(() => layoutFirmaVisible({}), /imagen/);
});

// ---------- respuesta ----------

test('normalizarRespuesta separa firmados de fallidos y decodifica el PDF', () => {
  const r = normalizarRespuesta({
    files: [
      { checksum_original: 'aaa', status: 'error' },
      { checksum_original: 'bbb', checksum_signed: 'ccc', content: Buffer.from('firmado').toString('base64'), status: 'OK', description: 'Contrato' },
    ],
    metadata: { signed_failed: 1, OTP_expired: false, files_signed: 1, files_received: 2 },
  });
  assert.equal(r.firmados.length, 1);
  assert.equal(r.fallidos.length, 1);
  assert.equal(r.firmados[0].contenido.toString(), 'firmado');
  assert.equal(r.firmados[0].checksumOriginal, 'bbb');
  assert.equal(r.fallidos[0].checksumOriginal, 'aaa');
  assert.deepEqual(r.metadata, { recibidos: 2, firmados: 1, fallidos: 1, otpExpirado: false });
});

test('normalizarRespuesta lee las dos formas del metadata que trae el documento', () => {
  // El JSON Schema usa snake_case y el ejemplo del código 200 camelCase —
  // el propio documento se contradice, así que se leen ambas.
  const camel = normalizarRespuesta({ files: [], metadata: { otpExpired: true, filesSigned: 3, signedFailed: 0, objectsReceived: 3 } });
  assert.deepEqual(camel.metadata, { recibidos: 3, firmados: 3, fallidos: 0, otpExpirado: true });
  // Y la errata "files_recived" que aparece en el mismo bloque del schema.
  const errata = normalizarRespuesta({ files: [], metadata: { files_recived: 5 } });
  assert.equal(errata.metadata.recibidos, 5);
});

// ---------- guardas de firmarDocumentos ----------

test('firmarDocumentos no sale a la red si la integración está apagada', async () => {
  // Sin FIRMAGOB_HABILITADO no debe intentar ninguna llamada: se pasa un
  // fetch que explota para probar que ni siquiera se invoca.
  const explota = () => { throw new Error('no debió llamarse'); };
  await assert.rejects(
    firmarDocumentos({ archivos: [{}], fetchImpl: explota }),
    /apagado/
  );
});

test('los ambientes apuntan al host oficial y el tope de 5 MB está declarado', () => {
  assert.ok(AMBIENTES.test.startsWith('https://api.firma.test.digital.gob.cl/'));
  assert.ok(AMBIENTES.produccion.startsWith('https://api.firma.digital.gob.cl/'));
  assert.ok(AMBIENTES.test.endsWith('/firma/v2/files/tickets'));
  assert.equal(MAX_SOLICITUD_BYTES, 5 * 1024 * 1024);
});
