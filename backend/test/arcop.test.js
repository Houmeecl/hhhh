import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DERECHOS, ETIQUETA_DERECHO, MAX_DETALLE, PLAZO_RESPUESTA_DIAS,
  validarSolicitud, dondeBuscar, limitesDeSupresion,
  diasEsperando, fueraDePlazo, armarPaquete,
} from '../src/services/arcop.js';
import { INVENTARIO, INVENTARIO_CORREDOR, PERSONAL } from '../src/services/inventarioDatos.js';

const RUT = '76.570.751-K';

// ---------- validación ----------

test('una solicitud por RUT es válida', () => {
  const r = validarSolicitud({ derecho: 'acceso', rut: RUT });
  assert.equal(r.ok, true);
  assert.equal(r.datos.rut, RUT);
  assert.equal(r.datos.email, null);
});

test('identificarse solo con el correo también vale', () => {
  // Quien ejerce puede no tener RUT registrado: un conductor, un contacto
  // antiguo. Exigirle RUT lo dejaría fuera de su propio derecho.
  const r = validarSolicitud({ derecho: 'acceso', email: 'Ana@Ejemplo.CL' });
  assert.equal(r.ok, true);
  assert.equal(r.datos.email, 'ana@ejemplo.cl', 'el correo se normaliza a minúsculas');
  assert.equal(r.datos.rut, null);
});

test('nunca lanza: cuerpo vacío o basura devuelve un error legible', () => {
  for (const body of [undefined, null, 'texto suelto', {}, { derecho: 123 }, { rut: {} }]) {
    const r = validarSolicitud(body);
    assert.equal(r.ok, false);
    assert.equal(typeof r.error, 'string');
    assert.ok(r.error.length > 0);
  }
});

test('sin identificarse no hay solicitud', () => {
  const r = validarSolicitud({ derecho: 'acceso' });
  assert.equal(r.ok, false);
  assert.match(r.error, /RUT|correo/i);
});

test('el derecho tiene que ser uno de los cinco', () => {
  assert.equal(validarSolicitud({ derecho: 'inventado', rut: RUT }).ok, false);
  assert.equal(validarSolicitud({ rut: RUT }).ok, false);
  for (const d of DERECHOS) {
    const r = validarSolicitud({ derecho: d, rut: RUT, detalle: 'x' });
    assert.equal(r.ok, true, `${d} debería ser válido`);
  }
});

test('el RUT se valida de verdad y el correo por forma', () => {
  // 97.000.000-1 tiene formato correcto pero su dígito verificador es 3.
  assert.match(validarSolicitud({ derecho: 'acceso', rut: '97.000.000-1' }).error, /RUT/i);
  assert.match(validarSolicitud({ derecho: 'acceso', email: 'sin-arroba' }).error, /correo/i);
  assert.match(validarSolicitud({ derecho: 'acceso', email: 'a@b' }).error, /correo/i);
});

test('rectificar sin decir qué está mal no es accionable', () => {
  const r = validarSolicitud({ derecho: 'rectificacion', rut: RUT });
  assert.equal(r.ok, false);
  assert.match(r.error, /dato/i);
  assert.equal(validarSolicitud({ derecho: 'rectificacion', rut: RUT, detalle: 'Mi correo cambió' }).ok, true);
  // Los otros derechos no exigen detalle.
  assert.equal(validarSolicitud({ derecho: 'supresion', rut: RUT }).ok, true);
});

test('el detalle largo se recorta en vez de rechazar la solicitud', () => {
  const r = validarSolicitud({ derecho: 'supresion', rut: RUT, detalle: 'x'.repeat(MAX_DETALLE + 500) });
  assert.equal(r.ok, true);
  assert.equal(r.datos.detalle.length, MAX_DETALLE);
});

test('cada derecho tiene una etiqueta que se entiende sin saber de leyes', () => {
  for (const d of DERECHOS) {
    assert.ok(ETIQUETA_DERECHO[d], `falta etiqueta de ${d}`);
    assert.match(ETIQUETA_DERECHO[d], /—/, `${d}: la etiqueta debería explicar, no solo nombrar`);
  }
});

// ---------- dónde buscar ----------

test('dondeBuscar sale del inventario y distingue RUT de correo', () => {
  const porRut = dondeBuscar({ rut: RUT }).map((d) => d.tabla);
  assert.ok(porRut.includes('facturas'), 'las facturas se buscan por RUT');

  const porCorreo = dondeBuscar({ email: 'ana@ej.cl' }).map((d) => d.tabla);
  assert.ok(porCorreo.includes('usuarios'));
  assert.ok(!porCorreo.includes('facturas'), 'facturas no tiene correo');
});

test('con RUT y correo se busca en la unión de ambos, sin repetir tablas', () => {
  const ambos = dondeBuscar({ rut: RUT, email: 'ana@ej.cl' });
  const tablas = ambos.map((d) => d.tabla);
  assert.equal(new Set(tablas).size, tablas.length, 'no debería repetir tablas');
  assert.ok(tablas.includes('facturas') && tablas.includes('usuarios'));
  // `clientes` se alcanza por correo; sus columnas no se duplican.
  const clientes = ambos.find((d) => d.tabla === 'clientes');
  if (clientes) assert.equal(new Set(clientes.columnas).size, clientes.columnas.length);
});

test('sin identificador no se busca en ninguna parte', () => {
  assert.deepEqual(dondeBuscar({}), []);
});

test('nunca se busca en una tabla clasificada como no personal', () => {
  for (const d of dondeBuscar({ rut: RUT, email: 'a@b.cl' })) {
    const e = (d.bd === 'corredor' ? INVENTARIO_CORREDOR : INVENTARIO)[d.tabla];
    assert.ok(e, `${d.bd}:${d.tabla} no está en su inventario`);
    assert.equal(e.clasificacion, PERSONAL, `${d.tabla} no es personal`);
  }
});

test('dondeBuscar dice en qué base vive cada tabla', () => {
  // Sin este dato la ruta no puede elegir pool, y elegir mal significa que
  // la tabla no aparece: es como el Corredor quedó fuera del derecho de
  // acceso sin que nadie se enterara.
  const destinos = dondeBuscar({ rut: RUT, email: 'a@b.cl' });
  for (const d of destinos) {
    assert.ok(['principal', 'corredor'].includes(d.bd), `${d.tabla}: base "${d.bd}" desconocida`);
  }
  assert.ok(destinos.some((d) => d.bd === 'corredor'), 'ninguna tabla del Corredor: volvió el punto ciego');
});

// ---------- límites de la supresión ----------

test('limitesDeSupresion separa lo borrable de lo retenido, con fundamento', () => {
  const l = limitesDeSupresion();
  assert.ok(l.borrable.length > 0);
  assert.ok(l.retenido.length > 0);
  for (const r of l.retenido) assert.ok(r.motivo?.length > 0, `${r.tabla}: sin fundamento`);
  // Nada puede estar en las dos listas a la vez.
  for (const t of l.borrable) {
    assert.ok(!l.retenido.some((r) => r.tabla === t), `${t} aparece como borrable y como retenido`);
  }
});

test('las facturas quedan retenidas: encadenadas y con respaldo tributario', () => {
  const l = limitesDeSupresion();
  assert.ok(l.retenido.some((r) => r.tabla === 'facturas'));
  assert.ok(!l.borrable.includes('facturas'));
});

test('la explicación dice por qué, no solo que no se puede', () => {
  const { explicacion } = limitesDeSupresion();
  assert.match(explicacion, /obligación legal|tributari/i);
  assert.match(explicacion, /cadena|integridad/i);
  // Y aclara que el resto sí se elimina: no es una negativa total.
  assert.match(explicacion, /el resto/i);
});

// ---------- plazos ----------

const HOY = new Date('2026-07-28T12:00:00Z');
const haceDias = (n) => new Date(HOY.getTime() - n * 24 * 60 * 60 * 1000);

test('diasEsperando cuenta días completos y nunca es negativo', () => {
  assert.equal(diasEsperando(haceDias(10), HOY), 10);
  assert.equal(diasEsperando(HOY, HOY), 0);
  assert.equal(diasEsperando(new Date(HOY.getTime() + 99999), HOY), 0, 'una fecha futura no es espera negativa');
  assert.equal(diasEsperando(null, HOY), 0);
  assert.equal(diasEsperando('basura', HOY), 0);
});

test('fueraDePlazo avisa recién pasado el plazo', () => {
  assert.equal(fueraDePlazo(haceDias(PLAZO_RESPUESTA_DIAS), HOY), false);
  assert.equal(fueraDePlazo(haceDias(PLAZO_RESPUESTA_DIAS + 1), HOY), true);
});

// ---------- el paquete de datos ----------

test('armarPaquete acompaña cada sección con su finalidad y base de licitud', () => {
  const p = armarPaquete({
    titular: { rut: RUT },
    hallazgos: [{ tabla: 'facturas', filas: [{ id: 1 }, { id: 2 }] }],
    generadoAt: '2026-07-28T12:00:00.000Z',
  });
  assert.equal(p.total_registros, 2);
  const s = p.secciones[0];
  assert.equal(s.tabla, 'facturas');
  assert.ok(s.finalidad, 'sin finalidad el titular no sabe para qué se usó su dato');
  assert.ok(s.base_licitud);
  assert.equal(s.encadenada, true, 'que esté encadenada explica por qué no se puede borrar');
});

test('las tablas sin filas no aparecen como secciones vacías', () => {
  const p = armarPaquete({
    titular: { rut: RUT },
    hallazgos: [{ tabla: 'facturas', filas: [] }, { tabla: 'clientes', filas: [{ id: 1 }] }],
  });
  assert.equal(p.secciones.length, 1);
  assert.equal(p.secciones[0].tabla, 'clientes');
});

test('sin resultados se dice qué se buscó, no que la persona no existe', () => {
  const p = armarPaquete({ titular: { rut: RUT }, hallazgos: [] });
  assert.equal(p.total_registros, 0);
  assert.match(p.nota, /tablas consultadas/i);
  assert.ok(!/no existe/i.test(p.nota));
});

test('con resultados no se arrastra la nota de "sin resultados"', () => {
  const p = armarPaquete({ titular: { rut: RUT }, hallazgos: [{ tabla: 'clientes', filas: [{ id: 1 }] }] });
  assert.equal(p.nota, null);
});
