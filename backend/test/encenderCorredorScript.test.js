import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// ============================================================
// Los scripts que encienden y respaldan el Corredor en el VPS, revisados
// sin ejecutarlos contra producción.
//
// Lo que estos casos cuidan, en orden de lo que cuesta si falla:
//
//  1. QUE EL RESPALDO INCLUYA LA BASE DEL CORREDOR. `pg_dump sicr3p` no la
//     toca: es otra base. Ahí vive la cadena de hash de los documentos de
//     carga, que es PROPIA y no se puede reconstruir desde la principal.
//     Perderla es perder la evidencia sellada.
//  2. QUE LOS DOS RESPALDOS NO SE CONFUNDAN. El del Corredor se llama
//     "sicr3p_corredor-..." (guión BAJO) justo para no calzar con el
//     patrón "sicr3p-*.sql.gz". Si calzaran, la poda de 14 días y el "usa
//     el más reciente" de restaurar.sh mezclarían las dos bases.
//  3. QUE ENCENDER NO PISE NADA. El script se va a correr más de una vez.
//     Rotar JWT_SECRET_CORREDOR de golpe cierra todas las sesiones
//     abiertas del panel: eso lo decide una persona, no un script.
//
// Se lee el archivo, no se ejecuta — mismo criterio que
// test/deployScript.test.js.
// ============================================================

const raiz = path.join(import.meta.dirname, '..', '..');
const ruta = (p) => path.join(raiz, p);
const leer = (p) => fs.readFileSync(ruta(p), 'utf8');

const ENCENDER = 'deploy/encender-corredor.sh';
const RESPALDO = 'deploy/respaldo.sh';
const RESTAURAR = 'deploy/restaurar.sh';

test('los tres scripts son bash válido', () => {
  for (const s of [ENCENDER, RESPALDO, RESTAURAR]) {
    execFileSync('bash', ['-n', ruta(s)], { stdio: 'pipe' });
  }
});

test('encender-corredor.sh es ejecutable y aborta al primer error', () => {
  assert.match(leer(ENCENDER), /^set -euo pipefail$/m,
    'sin esto, un paso que falla sigue de largo y el script termina diciendo que todo salió bien');
  // eslint-disable-next-line no-bitwise
  assert.ok(fs.statSync(ruta(ENCENDER)).mode & 0o111, 'tiene que tener permiso de ejecución');
});

// ---------- 1 y 2. El respaldo ----------

test('el respaldo incluye la base del Corredor', () => {
  const s = leer(RESPALDO);
  assert.match(s, /pg_dump "\$DB_CORREDOR"/,
    'pg_dump sicr3p no toca la otra base: hay que volcarla aparte');
  assert.match(s, /DB_CORREDOR="\$\{SICR3P_DB_CORREDOR:-sicr3p_corredor\}"/);
});

test('el respaldo del Corredor es opcional: si no está, no falla el diario', () => {
  // El Corredor puede no estar encendido en un servidor. Que eso reviente
  // el respaldo de TODO sería cambiar un dato que no existe por el dato
  // que sí existe.
  const s = leer(RESPALDO);
  assert.match(s, /psql -lqt \| cut -d '\|' -f 1 \| grep -qw "\$DB_CORREDOR"/,
    'se comprueba que la base exista antes de volcarla');
  assert.match(s, /nada que respaldar de ah/, 'y se dice, en vez de fallar en silencio');
});

test('los dos archivos de respaldo no se pisan entre sí', () => {
  const s = leer(RESPALDO);
  // El nombre del archivo del Corredor sale de $DB_CORREDOR, que empieza
  // con "sicr3p_" (guión BAJO). El patrón de poda del diario es
  // 'sicr3p-*.sql.gz' (guión). No calzan, y esa es toda la garantía.
  assert.match(s, /ARCHIVO_CORREDOR="\$DEST\/\$\{DB_CORREDOR\}-\$\(date \+%F\)\.sql\.gz"/);
  assert.match(s, /find "\$DEST" -name "\$\{DB_CORREDOR\}-\*\.sql\.gz" -mtime \+14 -delete/,
    'cada respaldo poda LO SUYO: el patrón del diario no alcanza al del Corredor');

  const nombreCorredor = 'sicr3p_corredor-2026-08-19.sql.gz';
  const globDiario = /^sicr3p-.*\.sql\.gz$/;
  assert.ok(!globDiario.test(nombreCorredor),
    'si el archivo del Corredor calzara con el patrón del diario, restaurar.sh podría agarrar el equivocado');
});

// ---------- La restauración ----------

test('restaurar.sh busca el respaldo de LA BASE que le pidieron', () => {
  const s = leer(RESTAURAR);
  assert.match(s, /PATRON="\$BACKUP_DIR\/\$\{DB\}-\*\.sql\.gz"/,
    'el patrón sale de $DB; fijo en "sicr3p-*" restauraba el dump equivocado');
});

test('restaurar.sh se niega a poner el respaldo de una base sobre otra', () => {
  const s = leer(RESTAURAR);
  assert.match(s, /BASE_ARCHIVO="\$\(basename "\$ARCHIVO"\)"/);
  assert.match(s, /no parece un respaldo de la base/);
  // pre-deploy-* lo genera actualizar.sh y es siempre de la base
  // principal: aceptarlo para el Corredor sería el mismo error con otro
  // nombre de archivo.
  assert.match(s, /PERMITIDOS_EXTRA="pre-deploy"/);
});

test('la tabla testigo del ensayo se elige mirando cuál existe', () => {
  // `facturas` no existe en la base del Corredor. Elegirla por el nombre
  // de la base dejaba la comparación en "? · ?" para cualquier base que no
  // se llamara exactamente así, y el ensayo pasaba sin comprobar nada.
  const s = leer(RESTAURAR);
  assert.match(s, /for CANDIDATA in facturas carga_documentos; do/);
  assert.match(s, /no se pudo comparar contenido/,
    'y si no existe ninguna de las dos, se dice');
});

// ---------- 3. Encender sin pisar ----------

test('encender-corredor.sh nunca sobrescribe una variable existente', () => {
  const s = leer(ENCENDER);
  assert.match(s, /if grep -q "\^\$\{clave\}=" "\$ENV_FILE"; then/);
  assert.match(s, /ya está en backend\/\.env: no se toca/);
  assert.ok(
    !/sed -i.*JWT_SECRET_CORREDOR/.test(s),
    'rotar el secreto cierra todas las sesiones del panel: eso no lo decide un script de instalación'
  );
});

test('la clave de Postgres se reusa del DATABASE_URL, no se inventa una nueva', () => {
  // Bug real ya visto en instalar-vps.sh: generar una clave nueva
  // desincroniza Postgres del .env y el backend queda sin poder conectar.
  const s = leer(ENCENDER);
  assert.match(s, /DB_PASS="\$\(grep '\^DATABASE_URL=' "\$ENV_FILE"/);
  assert.ok(!/DB_PASS="\$\(openssl rand/.test(s));
});

test('crear la base no borra una que ya exista', () => {
  const s = leer(ENCENDER);
  assert.match(s, /SELECT 1 FROM pg_database WHERE datname='\$DB'/);
  assert.ok(!/DROP DATABASE/.test(s), 'un script de encendido no borra bases');
  assert.ok(!/dropdb/.test(s));
});

test('--verificar no escribe nada', () => {
  const s = leer(ENCENDER);
  // Cada paso que modifica algo está detrás de la guarda.
  const modifican = [
    'CREATE DATABASE',
    'CREATE EXTENSION IF NOT EXISTS pgcrypto',
    'printf \'%s=%s\\n\'',
  ];
  for (const m of modifican) {
    assert.ok(s.includes(m), `el script debería contener: ${m}`);
  }
  assert.match(s, /if \[ "\$SOLO_VERIFICAR" != "1" \]/,
    'los pasos que escriben van detrás de la guarda de --verificar');
});

test('la sonda distingue "apagado" de "solo falta el token"', () => {
  const s = leer(ENCENDER);
  // 503 = el guard requireCorredorActivo, que va primero. 401 = está
  // encendido y solo falta autenticarse, que es el éxito.
  assert.match(s, /401\)/);
  assert.match(s, /503\)/);
  assert.match(s, /Corredor APAGADO/);
  // Y apunta a una ruta que es REALMENTE del Corredor: /api/corredor/puntos
  // lo atiende public.js y respondería 200 aunque el Corredor esté apagado.
  assert.match(s, /api\/corredor\/catalogo\/puntos/);
});

test('se comprueba que las dos bases sigan separadas', () => {
  const s = leer(ENCENDER);
  assert.match(s, /SELECT count\(\*\) FROM facturas/);
  assert.match(s, /las dos bases se mezclaron/);
});

// ---------- El primer administrador ----------

test('crear-admin-corredor.mjs no le cambia la clave a una cuenta existente', () => {
  const s = leer('backend/scripts/crear-admin-corredor.mjs');
  assert.match(s, /Ya existe una cuenta con/);
  assert.match(s, /No se toca su clave/);
  // Nace con la clave temporal marcada: requireClaveDefinida no deja
  // operar con ella.
  assert.match(s, /must_reset_password\)\s*\n\s*VALUES \(\$1, \$2, \$3, 'admin', true\)/);
});

test('la clave temporal usa el alfabeto sin caracteres ambiguos', () => {
  // Se dicta por teléfono cuando el correo no llega: sin 0/O ni 1/l/I.
  const s = leer('backend/scripts/crear-admin-corredor.mjs');
  const alfabeto = /const ALFABETO = '([^']+)'/.exec(s)?.[1];
  assert.ok(alfabeto, 'no se encontró el alfabeto');
  for (const c of ['0', 'O', '1', 'l', 'I']) {
    assert.ok(!alfabeto.includes(c), `el alfabeto no puede traer "${c}"`);
  }
});

test('el plan del Corredor apunta al script, no a los comandos sueltos', () => {
  assert.match(leer('docs/CORREDOR-PLAN.md'), /encender-corredor\.sh/);
});
