import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// ============================================================
// El script que despliega producción, revisado sin ejecutarlo.
//
// EL BUG QUE ESTOS CASOS IMPIDEN QUE VUELVA: `avisar()` se INVOCABA en la
// línea 143 y se DEFINÍA en la 260. En bash una función tiene que estar
// definida antes de llamarse, así que esa invocación moría con
// "avisar: command not found" — y con `set -euo pipefail` eso no es un
// mensaje feo: el código 127 mata el script en el acto. Resultado:
//
//   · el correo de "producción congelada" NUNCA se mandaba;
//   · el `touch "$AVISADO"` de la línea siguiente nunca corría, así que la
//     marca de "ya avisé hoy" jamás se ponía;
//   · el `exit 0` del bloque nunca se alcanzaba: salía con 127.
//
// O sea, el aviso que el commit a4a4f09 ("El deploy avisa por correo
// cuando falla, en vez de callarse") agregó para no fallar en silencio era
// exactamente el que nunca salía. Estuvo así hasta que se vio en el VPS.
//
// `bash -n` NO detecta esto: el archivo es sintácticamente válido. Solo se
// ve mirando el ORDEN, que es lo que hace el primer caso.
//
// Se lee el archivo, no se ejecuta — mismo criterio que
// test/ciSinEscribirEnProduccion.test.js con las migraciones.
// ============================================================

const RUTA = path.join(import.meta.dirname, '..', '..', 'deploy', 'actualizar.sh');
const fuente = fs.readFileSync(RUTA, 'utf8');
const lineas = fuente.split('\n');

// Funciones que el script define, con la línea donde empieza cada una.
function definiciones() {
  const mapa = new Map();
  lineas.forEach((l, i) => {
    const m = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*\(\)\s*\{/.exec(l);
    if (m && !mapa.has(m[1])) mapa.set(m[1], i + 1);
  });
  return mapa;
}

// Invocaciones a nivel de script (no dentro de otra función): son las que
// corren en orden y por eso exigen que la definición ya haya pasado. Una
// llamada DENTRO de otra función es segura —se resuelve al invocarla, con
// el archivo ya leído entero—, y por eso `rollback()` podía llamar a
// `avisar` sin problema mientras el bloque de cuarentena reventaba.
function invocacionesDeNivelSuperior(nombre) {
  const usos = [];
  let profundidad = 0;
  lineas.forEach((l, i) => {
    // Fuera comentarios Y contenido de cadenas: un mensaje de log que
    // MENCIONA "rollback" no es una invocación de rollback(). Sin esto el
    // chequeo daba un falso positivo en cuanto alguien escribía el nombre
    // de una función dentro de un texto — y un test que grita en falso se
    // termina ignorando, que es peor que no tenerlo.
    const sinComentario = l
      .replace(/#.*$/, '')
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/'(?:[^'\\]|\\.)*'/g, "''");
    if (/^[a-zA-Z_][a-zA-Z0-9_]*\s*\(\)\s*\{/.test(l)) profundidad = 1;
    else if (profundidad > 0) {
      profundidad += (sinComentario.match(/\{/g) || []).length;
      profundidad -= (sinComentario.match(/\}/g) || []).length;
      if (profundidad < 0) profundidad = 0;
    }
    if (profundidad > 0) return;                       // dentro de una función: seguro
    if (new RegExp(`(^|[;&|]|\\s)${nombre}(\\s|$)`).test(sinComentario)
        && !new RegExp(`^\\s*${nombre}\\s*\\(\\)`).test(l)) {
      usos.push(i + 1);
    }
  });
  return usos;
}

test('ninguna función se invoca antes de estar definida', () => {
  const defs = definiciones();
  assert.ok(defs.size >= 5, `se esperaban varias funciones, se encontraron ${defs.size}`);
  const rotas = [];
  for (const [nombre, linea] of defs) {
    for (const uso of invocacionesDeNivelSuperior(nombre)) {
      if (uso < linea) rotas.push(`${nombre}() se usa en la línea ${uso} y se define en la ${linea}`);
    }
  }
  assert.deepEqual(rotas, [],
    'Con `set -euo pipefail`, invocar una función antes de definirla mata el script con 127. '
    + 'Sube la definición por encima de su primer uso.');
});

test('avisar() está definida y por encima de todos sus usos', () => {
  // El caso concreto que falló en producción, fijado aparte del chequeo
  // genérico: si alguien mueve la función, este test dice qué se rompió.
  const defs = definiciones();
  const linea = defs.get('avisar');
  assert.ok(linea, 'avisar() desapareció del script: el manejo de errores llama a una función que no existe');
  const usos = [...fuente.matchAll(/^\s+avisar\s/gm)].map((m) => fuente.slice(0, m.index).split('\n').length);
  assert.ok(usos.length >= 3, `se esperaban al menos 3 llamadas a avisar, hay ${usos.length}`);
  for (const uso of usos) {
    assert.ok(uso > linea, `avisar() se usa en la línea ${uso} pero se define en la ${linea}`);
  }
});

test('el script pasa el chequeo de sintaxis de bash', () => {
  // No cubre el orden de funciones (por eso el primer caso), pero sí atrapa
  // un `fi` de más o unas comillas sin cerrar antes de que lleguen al VPS.
  execFileSync('bash', ['-n', RUTA], { stdio: 'pipe' });
});

test('el bloque de cuarentena termina en exit 0, no a mitad de camino', () => {
  // La guarda de cuarentena existe para que el cron NO reintente un commit
  // roto cada 30 minutos. Si muere antes del `exit 0` —como pasaba— el
  // script sale con error y la marca de "ya avisé" nunca se pone.
  // La línea de CÓDIGO, no un comentario que mencione la cuarentena: hay
  // comentarios más arriba que explican el incidente y citan ese texto.
  const i = lineas.findIndex((l) => l.includes('EN CUARENTENA') && !l.trim().startsWith('#'));
  assert.ok(i > 0, 'no se encontró el bloque de cuarentena');
  const bloque = lineas.slice(i, i + 8).join('\n');
  assert.match(bloque, /touch "\$AVISADO"/, 'el bloque ya no marca que avisó');
  assert.match(bloque, /exit 0/, 'el bloque de cuarentena tiene que salir con 0');
});

test('el lock se cierra en los subshells que lanzan procesos pesados', () => {
  // Regresión de b73091d: sin `9>&-`, npm/vite/pm2 heredan el fd del lock y
  // un huérfano lo deja tomado después de que el script murió.
  // Solo las líneas que EJECUTAN algo: un subshell `( cd … && npm … )` o el
  // `eval "$RESTART_CMD"`. Un primer intento buscaba cualquier línea que
  // mencionara "npm ci" y marcaba comentarios y mensajes de log() — ocho
  // falsos positivos que habrían enseñado a ignorar este test.
  const pesados = lineas.filter((l) => {
    const codigo = l.replace(/#.*$/, '');
    if (/^\s*(#|$)/.test(l)) return false;
    return /\(\s*cd\s+"\$REPO_DIR[^)]*(npm|npx)/.test(codigo)
      || /eval\s+"\$RESTART_CMD"/.test(codigo);
  });
  assert.ok(pesados.length >= 4,
    `se esperaban al menos 4 comandos pesados, se encontraron ${pesados.length}`);
  const sinCerrar = pesados.filter((l) => !l.includes('9>&-'));
  assert.deepEqual(sinCerrar, [],
    'estos comandos heredan el descriptor del lock; agrégales `9>&-`');
});
