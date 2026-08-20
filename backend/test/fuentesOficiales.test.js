import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  revisarFuentes, estadoRealDe, fuenteVerificada,
  INCOMPLETE_OFFICIAL_SOURCE,
} from '../src/services/fuentesOficiales.js';

// ============================================================
// El registro de fuentes oficiales.
//
// EL INCIDENTE QUE ORIGINA ESTO. El 20-08-2026 una revisión normativa del
// Corredor produjo veinte hallazgos sobre el EUDR, CBAM y los documentos
// por frontera. NINGUNA cita pudo contrastarse contra el texto oficial:
// el egreso de red bloquea eur-lex.europa.eu y los sitios de los
// organismos. Todo salió de fuentes secundarias y quedó marcado como no
// verificado, en un informe que nadie vuelve a abrir.
//
// LA REGLA QUE ESTOS CASOS FIJAN. No verificado NO bloquea. Lo que
// bloquea es DECLARARSE verificado sin poder demostrarlo. Es la misma
// doctrina que el nivel de confianza de una parcela: lo calcula el
// servidor leyendo la evidencia, no lo declara quien la aporta.
// ============================================================

// Un manifiesto de juguete en un directorio temporal, para poder romperlo
// sin tocar el real.
function conManifiesto(fuentes, archivos = {}) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'fuentes-'));
  for (const [rel, contenido] of Object.entries(archivos)) {
    const destino = path.join(raiz, rel);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, contenido);
  }
  const ruta = path.join(raiz, 'manifest.json');
  fs.writeFileSync(ruta, JSON.stringify({ fuentes }));
  return { ruta, raiz };
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

const BASE = {
  id: 'X-1', pais: 'UE', autoridad: 'Alguien', titulo: 'Una norma',
  sourceUrl: 'https://ejemplo/norma',
};

// ---------- La regla central ----------

test('una fuente pendiente NO rompe nada: no verificado es un estado, no un error', () => {
  const { ruta, raiz } = conManifiesto([{ ...BASE, estado: 'pendiente', motivo: 'el proxy la bloquea' }]);
  const r = revisarFuentes(ruta, raiz);
  assert.equal(r.ok, true);
  assert.equal(r.codigo, null);
  assert.equal(r.pendientes.length, 1);
});

test('declararse verificada SIN archivo es fatal', () => {
  // Es exactamente la afirmación sin respaldo que este producto existe
  // para no hacer.
  const { ruta, raiz } = conManifiesto([{ ...BASE, estado: 'verificada' }]);
  const r = revisarFuentes(ruta, raiz);
  assert.equal(r.ok, false);
  assert.equal(r.codigo, INCOMPLETE_OFFICIAL_SOURCE);
  assert.match(r.rotas[0].problema, /sin archivo ni sha256/);
});

test('si el archivo cambió bajo nuestros pies, es fatal', () => {
  // Alguien reemplaza el PDF oficial por otro y el manifiesto sigue
  // diciendo que se verificó. El hash es lo único que lo detecta.
  const { ruta, raiz } = conManifiesto(
    [{ ...BASE, estado: 'verificada', archivo: 'norma.pdf', sha256: sha('el original') }],
    { 'UE/norma.pdf': 'OTRA COSA' }
  );
  const r = revisarFuentes(ruta, raiz);
  assert.equal(r.ok, false);
  assert.match(r.rotas[0].problema, /el archivo cambió/);
});

test('verificada con su archivo y su hash: pasa', () => {
  const contenido = 'el texto oficial';
  const { ruta, raiz } = conManifiesto(
    [{ ...BASE, estado: 'verificada', archivo: 'norma.pdf', sha256: sha(contenido) }],
    { 'UE/norma.pdf': contenido }
  );
  const r = revisarFuentes(ruta, raiz);
  assert.equal(r.ok, true);
  assert.equal(r.verificadas.length, 1);
  assert.equal(fuenteVerificada('X-1', ruta, raiz), true);
});

test('una fuente que se declara verificada y no está el archivo, es fatal', () => {
  const { ruta, raiz } = conManifiesto(
    [{ ...BASE, estado: 'verificada', archivo: 'no-esta.pdf', sha256: sha('x') }]
  );
  assert.equal(revisarFuentes(ruta, raiz).ok, false);
});

// ---------- Las guardas del formato ----------

test('pendiente sin decir por qué es fatal: "todavía no" sin motivo es una excusa', () => {
  const { ruta, raiz } = conManifiesto([{ ...BASE, estado: 'pendiente' }]);
  const r = revisarFuentes(ruta, raiz);
  assert.equal(r.ok, false);
  assert.match(r.rotas[0].problema, /sin decir por qué/);
});

test('pendiente CON archivo es fatal: si está, hay que sellarla', () => {
  const { ruta, raiz } = conManifiesto(
    [{ ...BASE, estado: 'pendiente', motivo: 'x', archivo: 'norma.pdf' }],
    { 'UE/norma.pdf': 'y' }
  );
  assert.equal(revisarFuentes(ruta, raiz).ok, false);
});

test('faltarle un campo obligatorio es fatal', () => {
  const { ruta, raiz } = conManifiesto([{ id: 'X-1', estado: 'pendiente', motivo: 'x' }]);
  const r = revisarFuentes(ruta, raiz);
  assert.equal(r.ok, false);
  assert.match(r.rotas[0].problema, /campos obligatorios/);
});

test('un estado inventado es fatal', () => {
  const { ruta, raiz } = conManifiesto([{ ...BASE, estado: 'mas_o_menos' }]);
  assert.equal(revisarFuentes(ruta, raiz).ok, false);
});

test('el estado sale del disco, no del JSON', () => {
  // La afirmación del manifiesto no se cree: se comprueba.
  const { ruta, raiz } = conManifiesto(
    [{ ...BASE, estado: 'verificada', archivo: 'n.pdf', sha256: 'f'.repeat(64) }],
    { 'UE/n.pdf': 'contenido real' }
  );
  const f = revisarFuentes(ruta, raiz).fuentes[0];
  assert.equal(f.estado, 'rota', 'el JSON decía verificada y el disco dice que no');
});

// ---------- El manifiesto de verdad ----------

test('el manifiesto real del repositorio está sano', () => {
  const r = revisarFuentes();
  assert.equal(r.ok, true, r.rotas.map((f) => `${f.id}: ${f.problema}`).join(' | '));
  assert.ok(r.total >= 5, 'el registro tiene que cubrir al menos las normas que el código cita');
});

test('toda fuente pendiente del repositorio dice por qué lo está', () => {
  for (const f of revisarFuentes().pendientes) {
    assert.ok(f.motivo && f.motivo.length > 20, `${f.id} no explica por qué está pendiente`);
  }
});

test('cada fuente declara qué afirmación sostiene', () => {
  // Sin esto el registro es una lista de enlaces. Con esto se sabe qué
  // parte del producto se queda sin respaldo si la fuente no llega.
  for (const f of revisarFuentes().fuentes) {
    assert.ok(Array.isArray(f.sostiene) && f.sostiene.length, `${f.id} no dice qué sostiene`);
  }
});

test('las normas que el código cita están en el registro', () => {
  const raiz = path.join(import.meta.dirname, '..');
  const ids = new Set(revisarFuentes().fuentes.map((f) => f.id));
  const codigo = fs.readFileSync(path.join(raiz, 'src/services/exportacion.js'), 'utf8');
  // `exportacion.js` cita los dos reglamentos por número. Si cita uno que
  // no está en el registro, es una afirmación sin fuente declarada.
  for (const [texto, id] of [['2023/1115', 'UE-2023-1115'], ['2023/956', 'UE-2023-956']]) {
    if (codigo.includes(texto)) {
      assert.ok(ids.has(id), `el código cita ${texto} y no hay fuente "${id}" en el registro`);
    }
  }
});
