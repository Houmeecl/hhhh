import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// ============================================================
// Recuperación de contraseña del Corredor.
//
// EL AGUJERO QUE CIERRA. Hasta el 23-08-2026, un exportador que perdía su
// clave quedaba afuera: `tokens_password_corredor` existía desde la
// migración 001 y no la insertaba nadie. La única salida era que un admin
// emitiera una clave temporal y se la dictara por teléfono.
//
// Este archivo lee el código fuente en vez de levantar el servidor: la
// suite corre en el VPS con NODE_ENV=production contra la base real, y un
// test estructural no escribe nada. El flujo completo se verificó a mano
// contra la base local — pedir el enlace, canjearlo, reusarlo (falla),
// entrar con la clave nueva y comprobar que la vieja ya no sirve.
// ============================================================

const src = fs.readFileSync(new URL('../src/routes/corredorApi.js', import.meta.url), 'utf8');

// Los comentarios explican el ataque de enumeración; si no se quitan, el
// test se leería a sí mismo y pasaría en falso.
const codigo = src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const bloque = (nombre) => {
  const i = codigo.indexOf(`router.post('/auth/${nombre}'`);
  assert.notEqual(i, -1, `desapareció POST /auth/${nombre}`);
  const fin = codigo.indexOf('\nrouter.', i + 10);
  return codigo.slice(i, fin === -1 ? undefined : fin);
};

test('existen las dos rutas del ciclo', () => {
  assert.ok(bloque('olvide-clave').length > 0);
  assert.ok(bloque('restablecer').length > 0);
});

// ---------- Lo que impide enumerar quién exporta ----------

test('pedir el enlace responde lo mismo exista o no el correo', () => {
  // Si dijera "ese correo no está registrado", cualquiera podría averiguar
  // qué empresas operan en el Corredor probando direcciones. En un corredor
  // minero, saber quién exporta ya es información.
  const b = bloque('olvide-clave');
  const salidas = b.match(/res\.(json|status)\(/g) || [];
  assert.equal(salidas.length, 1, 'hay más de una salida: alguna rama delata si el correo existe');
  assert.ok(/Si el correo existe/.test(b), 'se perdió la respuesta genérica');
});

test('el trabajo va DENTRO del if, no antes de responder', () => {
  // Contestar antes de tiempo en el caso negativo también delata, por
  // diferencia de latencia.
  const b = bloque('olvide-clave');
  const iIf = b.indexOf('if (u &&');
  const iRes = b.indexOf('res.json');
  assert.ok(iIf !== -1 && iIf < iRes, 'la respuesta quedó antes de la rama que hace el trabajo');
});

test('los tres motivos de rechazo dan el mismo mensaje', () => {
  // Enlace inexistente, vencido y ya usado significan lo mismo para quien
  // lo tiene en la mano. Distinguirlos solo le sirve a quien prueba
  // enlaces ajenos.
  const b = bloque('restablecer');
  const errores = b.match(/error: '[^']+'/g) || [];
  const sobreElEnlace = errores.filter((e) => !/contraseña debe tener/.test(e));
  assert.equal(new Set(sobreElEnlace).size, 1, `mensajes distintos para el enlace: ${sobreElEnlace}`);
});

// ---------- Lo que protege el token ----------

test('el token se guarda hasheado, nunca en claro', () => {
  const b = bloque('olvide-clave');
  assert.ok(/createHash\('sha256'\)/.test(b), 'el token dejó de hashearse antes de guardarlo');
});

test('el token tiene entropía suficiente', () => {
  const b = bloque('olvide-clave');
  const bytes = b.match(/randomBytes\((\d+)\)/);
  assert.ok(bytes, 'desapareció randomBytes');
  assert.ok(
    Number(bytes[1]) >= 32,
    `randomBytes(${bytes[1]}) es poco para un enlace que cambia una contraseña`
  );
});

test('el canje es atómico: marcar usado y cambiar clave van juntos', () => {
  // Si se marcara después, dos peticiones simultáneas con el mismo enlace
  // cambiarían la contraseña dos veces.
  const b = bloque('restablecer');
  assert.ok(/withTxCorredor/.test(b), 'el canje dejó de ser transaccional');
  assert.ok(/FOR UPDATE/.test(b), 'se perdió el FOR UPDATE: dos canjes simultáneos pasarían los dos');
  assert.ok(/usado = true/.test(b), 'el enlace ya no se marca como usado');
});

test('restablecer exige una contraseña de largo mínimo', () => {
  assert.ok(/length < 8/.test(bloque('restablecer')));
});

test('restablecer levanta must_reset_password', () => {
  // Si no, el usuario cambia su clave y el panel lo sigue mandando a
  // cambiarla, en un bucle.
  assert.ok(/must_reset_password = false/.test(bloque('restablecer')));
});

// ---------- El correo ----------

const mailer = fs.readFileSync(new URL('../src/services/mailer.js', import.meta.url), 'utf8');
const plantilla = () => {
  const i = mailer.indexOf('export function resetCorredorEmail');
  assert.notEqual(i, -1, 'desapareció resetCorredorEmail');
  return mailer.slice(i, i + 1400);
};

test('el plazo del correo sale de la constante, no escrito de nuevo', () => {
  // Si mañana cambia el plazo, el texto no puede quedar mintiendo.
  assert.ok(/HORAS_TOKEN_CORREDOR/.test(codigo));
  assert.ok(/horas: HORAS_TOKEN_CORREDOR/.test(bloque('olvide-clave')));
  assert.ok(/\$\{Number\(horas\)\}/.test(plantilla()), 'el plazo quedó escrito a mano en el correo');
});

test('el correo escapa el nombre y el enlace', () => {
  // Los nombres reales traen `&` y comillas; sin escape, un `<script>`
  // viajaría intacto al cliente de correo de quien lo recibe.
  assert.ok(/esc\(nombre\)/.test(plantilla()), 'el nombre entra sin escapar');
  assert.ok(/esc\(link\)/.test(plantilla()), 'el enlace entra sin escapar');
});

test('un fallo del correo no tumba la petición', () => {
  // El token ya quedó creado y el admin todavía puede emitir una clave
  // temporal; reventar acá dejaría al usuario sin ninguna de las dos vías.
  const b = bloque('olvide-clave');
  const i = b.indexOf('sendMail');
  assert.ok(b.lastIndexOf('try {', i) > b.indexOf('if (u &&'), 'sendMail quedó fuera de su propio try');
});
