import test from 'node:test';
import assert from 'node:assert/strict';
import { validarSolicitud, auspiciadorDesdeSolicitud, APORTES, MAX_MENSAJE } from '../src/services/auspicio.js';

// Postulación mínima que pasa. Los tests de rechazo parten de esta y rompen
// un solo campo, para que quede claro qué es lo que se está probando.
const OK = {
  rut: '76.570.751-K',
  nombre_empresa: 'Automotora Ejemplo SpA',
  contacto_email: 'contacto@ejemplo.cl',
  aporta_difusion: true,
};

test('una postulación válida devuelve ok y los datos normalizados', () => {
  const r = validarSolicitud({ ...OK, contacto_email: '  Contacto@Ejemplo.CL ' });
  assert.equal(r.ok, true);
  assert.equal(r.error, null);
  assert.equal(r.datos.contacto_email, 'contacto@ejemplo.cl');
  assert.equal(r.datos.nombre_empresa, 'Automotora Ejemplo SpA');
});

test('nunca lanza: un cuerpo vacío o basura devuelve un error legible', () => {
  // `null` incluido a propósito: express.json() lo entrega tal cual
  // cuando el cuerpo es literalmente `null`, y un `= {}` no lo cubre.
  for (const body of [undefined, null, 'texto suelto', {}, { rut: null }, { nombre_empresa: 123 }]) {
    const r = validarSolicitud(body);
    assert.equal(r.ok, false);
    assert.equal(typeof r.error, 'string');
    assert.ok(r.error.length > 0);
  }
});

test('el RUT se valida de verdad, no solo por formato', () => {
  // 97.000.000-1 tiene el formato correcto pero su dígito verificador es 3.
  assert.equal(validarSolicitud({ ...OK, rut: '97.000.000-1' }).ok, false);
  assert.equal(validarSolicitud({ ...OK, rut: '97.000.000-3' }).ok, true);
});

test('falta la empresa o el correo no tiene forma de correo', () => {
  assert.match(validarSolicitud({ ...OK, nombre_empresa: '   ' }).error, /empresa/i);
  assert.match(validarSolicitud({ ...OK, contacto_email: 'sin-arroba' }).error, /correo/i);
  assert.match(validarSolicitud({ ...OK, contacto_email: 'a@b' }).error, /correo/i);
});

test('sin ningún aporte marcado no hay postulación', () => {
  const r = validarSolicitud({ ...OK, aporta_difusion: false });
  assert.equal(r.ok, false);
  assert.match(r.error, /aporte/i);
  // Cualquiera de los tres, por sí solo, alcanza.
  for (const k of APORTES) assert.equal(validarSolicitud({ ...OK, aporta_difusion: false, [k]: true }).ok, true);
});

test('el detalle del vehículo solo se guarda si de verdad ofrece uno', () => {
  const veh = { marca: 'Toyota', modelo: 'Hilux', patente: 'kxpb12', anio: '2024' };
  const sin = validarSolicitud({ ...OK, vehiculo: veh });
  assert.deepEqual(sin.datos.vehiculo, {}, 'sin aporta_vehiculo el detalle sería ruido en el comodato');

  const con = validarSolicitud({ ...OK, aporta_vehiculo: true, vehiculo: veh });
  assert.equal(con.datos.vehiculo.patente, 'KXPB12', 'la patente se guarda en mayúsculas');
  assert.equal(con.datos.vehiculo.marca, 'Toyota');
});

test('los campos largos se recortan en vez de rechazar la postulación', () => {
  const r = validarSolicitud({ ...OK, mensaje: 'x'.repeat(MAX_MENSAJE + 500) });
  assert.equal(r.ok, true);
  assert.equal(r.datos.mensaje.length, MAX_MENSAJE);
});

test('los opcionales vacíos quedan en null, no en cadena vacía', () => {
  const { datos } = validarSolicitud(OK);
  assert.equal(datos.contacto_nombre, null);
  assert.equal(datos.contacto_telefono, null);
  assert.equal(datos.ciudades, null);
  assert.equal(datos.mensaje, null);
});

// ---------- lo que se copia al aceptar ----------

test('al aceptar solo se copian los campos que son condición del convenio', () => {
  const { datos } = validarSolicitud({
    ...OK, aporta_vehiculo: true, vehiculo: { marca: 'Toyota', modelo: 'Hilux', patente: 'KXPB12', anio: '2024' },
    contacto_telefono: '+56 9 1234 5678', ciudades: 'Antofagasta, Calama', mensaje: 'Nos interesa la gira.',
  });
  const a = auspiciadorDesdeSolicitud(datos);
  assert.deepEqual(Object.keys(a).sort(), ['aporta_vehiculo', 'contacto_email', 'nombre_empresa', 'rut', 'vehiculo']);
  assert.equal(a.rut, datos.rut);
  assert.equal(a.vehiculo.patente, 'KXPB12');
  // Teléfono, ciudades y mensaje son de la conversación comercial: no son
  // condiciones del convenio y no deben terminar impresos en el contrato.
  assert.equal(a.contacto_telefono, undefined);
  assert.equal(a.mensaje, undefined);
});

test('sin vehículo, el auspiciador nace sin detalle de vehículo', () => {
  const a = auspiciadorDesdeSolicitud({ ...OK, aporta_vehiculo: false, vehiculo: { marca: 'Toyota' } });
  assert.equal(a.aporta_vehiculo, false);
  assert.deepEqual(a.vehiculo, {});
});
