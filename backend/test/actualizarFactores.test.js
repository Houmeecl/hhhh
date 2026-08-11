import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { validarHallazgos, soloCambios, valorActualDe, MODELO } from '../src/services/actualizarFactores.js';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const CODIGOS = new Set(['electricidad', 'combustible', 'transporte']);

const base = {
  categoria_codigo: 'electricidad',
  campo: 'factor_fisico_kgco2e',
  valor_propuesto: '0.3100',
  fuente_url: 'https://huellachile.mma.gob.cl/factor',
  justificacion: 'El MMA publicó el factor SEN actualizado.',
};

// ============================================================
// Lo que protege este archivo: la IA busca y propone, nunca escribe un
// factor. Todo lo que devuelve pasa por validarHallazgos antes de llegar
// siquiera a la bandeja de propuestas — y aprobar sigue siendo humano.
// ============================================================

test('un hallazgo completo y verificable se acepta', () => {
  const { validos, descartados } = validarHallazgos({ hallazgos: [base] }, CODIGOS);
  assert.equal(validos.length, 1);
  assert.equal(descartados.length, 0);
  assert.equal(validos[0].valor_propuesto, '0.31');
});

test('sin URL verificable se descarta: lo que no se puede comprobar no se aprueba', () => {
  for (const url of [undefined, '', 'no es una url', 'ftp://algo', 'según el MMA']) {
    const { validos, descartados } = validarHallazgos({ hallazgos: [{ ...base, fuente_url: url }] }, CODIGOS);
    assert.equal(validos.length, 0, `aceptó una fuente no verificable: ${url}`);
    assert.match(descartados[0].motivo, /URL/);
  }
});

test('una categoría inventada por el modelo no entra', () => {
  const { validos, descartados } = validarHallazgos(
    { hallazgos: [{ ...base, categoria_codigo: 'aviacion_privada' }] }, CODIGOS);
  assert.equal(validos.length, 0);
  assert.match(descartados[0].motivo, /categoría desconocida/);
});

test('un campo fuera de la lista blanca no entra (nada de nombres de columna del modelo)', () => {
  for (const campo of ['activo', 'palabras_clave', 'password_hash', '']) {
    const { validos } = validarHallazgos({ hallazgos: [{ ...base, campo }] }, CODIGOS);
    assert.equal(validos.length, 0, `aceptó el campo ${campo}`);
  }
});

test('un factor que no es número positivo se descarta', () => {
  for (const valor of ['cero', '-1', '0', 'NaN', '']) {
    const { validos } = validarHallazgos({ hallazgos: [{ ...base, valor_propuesto: valor }] }, CODIGOS);
    assert.equal(validos.length, 0, `aceptó el valor ${valor}`);
  }
  // La coma decimal chilena sí se acepta y se normaliza.
  const { validos } = validarHallazgos({ hallazgos: [{ ...base, valor_propuesto: '0,45' }] }, CODIGOS);
  assert.equal(validos[0].valor_propuesto, '0.45');
});

test('el año de edición sí puede ser texto', () => {
  const { validos } = validarHallazgos({ hallazgos: [
    { ...base, campo: 'fuente_version_anio', valor_propuesto: 'AR6 (2021)' },
  ] }, CODIGOS);
  assert.equal(validos.length, 1);
  assert.equal(validos[0].valor_propuesto, 'AR6 (2021)');
});

test('dos propuestas para la misma categoría y campo: se queda con una', () => {
  const { validos, descartados } = validarHallazgos({ hallazgos: [
    base, { ...base, valor_propuesto: '0.4000' },
  ] }, CODIGOS);
  assert.equal(validos.length, 1);
  assert.match(descartados[0].motivo, /duplicada/);
});

test('validarHallazgos tolera null, basura y respuesta vacía sin lanzar', () => {
  for (const entrada of [null, undefined, {}, { hallazgos: null }, { hallazgos: 'texto' }, { hallazgos: [null, 3, 'x'] }]) {
    const r = validarHallazgos(entrada, CODIGOS);
    assert.equal(r.validos.length, 0);
  }
});

test('«todo al día» es una respuesta válida, no un error', () => {
  const r = validarHallazgos({ hallazgos: [] }, CODIGOS);
  assert.deepEqual(r, { validos: [], descartados: [] });
});

// ---------- No ensuciar la bandeja ----------

const CATS = [
  { codigo: 'electricidad', factor_fisico_kgco2e: '0.242100', factor_gasto_kgco2e_clp1000: '0.600000', fuente_version_anio: '2023' },
];

test('proponer el mismo valor que ya está vigente no genera una propuesta', () => {
  const iguales = soloCambios([{ ...base, valor_propuesto: '0.2421' }], CATS);
  assert.equal(iguales.length, 0);
});

test('un cambio real sí pasa', () => {
  assert.equal(soloCambios([{ ...base, valor_propuesto: '0.31' }], CATS).length, 1);
});

test('el año de edición se compara como texto, no como número', () => {
  assert.equal(soloCambios([{ categoria_codigo: 'electricidad', campo: 'fuente_version_anio', valor_propuesto: '2023' }], CATS).length, 0);
  assert.equal(soloCambios([{ categoria_codigo: 'electricidad', campo: 'fuente_version_anio', valor_propuesto: '2026' }], CATS).length, 1);
});

test('valorActualDe deja constancia de lo que había antes', () => {
  assert.equal(valorActualDe(CATS[0], 'factor_fisico_kgco2e'), '0.242100');
  assert.equal(valorActualDe(CATS[0], 'fuente_version_anio'), '2023');
  assert.equal(valorActualDe(null, 'factor_fisico_kgco2e'), null);
});

// ---------- Guardas sobre el código ----------

test('el servicio de búsqueda NUNCA escribe en motor_categorias', () => {
  const src = readFileSync(join(raiz, 'src/services/actualizarFactores.js'), 'utf8');
  const sql = src.replace(/\/\/.*$/gm, ''); // fuera comentarios
  assert.ok(!/UPDATE\s+motor_categorias/i.test(sql),
    'el buscador escribe directo en el motor: el factor tiene que pasar por aprobación humana.');
  assert.ok(!/INSERT\s+INTO\s+motor_versiones/i.test(sql),
    'el buscador crea una versión del motor por su cuenta.');
  assert.ok(!/UPDATE\s+fuentes_metodologicas/i.test(sql));
});

test('aplicar una propuesta congela una versión, y solo por la vía del admin', () => {
  const src = readFileSync(join(raiz, 'src/routes/motor.js'), 'utf8');
  const i = src.indexOf("router.post('/propuestas/:id/aprobar'");
  assert.ok(i > 0, 'desapareció el endpoint de aprobación');
  const tramo = src.slice(i, i + 3000);
  assert.ok(/adminOnly/.test(src.slice(i, i + 200)), 'aprobar dejó de exigir rol de admin');
  assert.ok(/crearVersion\(/.test(tramo), 'aprobar ya no congela una versión del motor');
  assert.ok(/FOR UPDATE/.test(tramo), 'aprobar no toma el lock de la fila: dos clics podrían aplicarla dos veces');
});

test('el modelo por defecto es el que se decidió, no uno heredado', () => {
  assert.equal(MODELO, 'claude-opus-5');
});

test('la migración 052 exige URL en toda propuesta', () => {
  // Por sufijo y no por número: el número cambió al traer esto desde el
  // repositorio nuevo, y un renumerado no debería romper el test.
  const archivo = readdirSync(join(raiz, 'migrations')).find((f) => f.endsWith('_propuestas_factores.sql'));
  assert.ok(archivo, 'no se encontró la migración *_propuestas_factores.sql');
  const sql = readFileSync(join(raiz, 'migrations', archivo), 'utf8');
  assert.match(sql, /fuente_url\s+TEXT\s+NOT NULL/i,
    'la URL de la fuente dejó de ser obligatoria: entrarían propuestas imposibles de verificar.');
  // El CHECK del campo es lo que impide que un nombre de columna arbitrario
  // llegue al UPDATE de la aprobación.
  assert.match(sql, /CHECK \(campo IN \(/i);
});
