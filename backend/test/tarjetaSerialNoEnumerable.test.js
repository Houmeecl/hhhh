import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// ============================================================
// El serial de la Tarjeta de Viaje no puede volver a ser enumerable.
//
// EL HALLAZGO. GET /api/v/:serial es público y sin clave. El serial era su
// única credencial y se generaba con `crypto.randomBytes(2)`: 65.536
// combinaciones. El apiLimiter deja 300 peticiones cada 15 minutos por IP,
// así que barrer el espacio entero era cosa de un fin de semana desde un
// solo IP, o de minutos repartiendo IPs. Y la respuesta traía la
// instrucción vigente de la torre — destino, zona, nota, emisor. Es decir:
// se podía enumerar a dónde va cada carga viva sin credencial alguna.
//
// Eso es el mismo riesgo que sostiene la regla de no rastrear vehículos,
// entrando por otra puerta. Dos cosas lo cierran, y las dos se defienden
// acá porque las dos son fáciles de deshacer sin darse cuenta:
//   1. el serial pasó a 8 bytes (2^64)
//   2. la instrucción se movió detrás de la clave del portador
//
// Este archivo lee el código fuente en vez de levantar el servidor: la
// suite corre en el VPS con NODE_ENV=production contra la base real, y un
// test estructural no escribe nada.
// ============================================================

const leer = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

// Los comentarios explican el ataque y nombran torre_mensajes; si no se
// quitan, el test se leería a sí mismo y pasaría en falso.
const sinComentarios = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const PUBLIC = sinComentarios(leer('../src/routes/public.js'));
const ORIGEN = sinComentarios(leer('../src/routes/origen.js'));

// El handler de /v/:serial, aislado del resto del archivo.
function handlerPublicoTarjeta() {
  const i = PUBLIC.indexOf("router.get('/v/:serial'");
  assert.notEqual(i, -1, 'no se encontró el handler de /v/:serial');
  const fin = PUBLIC.indexOf("router.get('/v/:serial/qr.png'", i);
  assert.notEqual(fin, -1, 'no se encontró el fin del handler');
  return PUBLIC.slice(i, fin);
}

test('el serial se genera con 8 bytes, no con 2', () => {
  const src = leer('../src/services/pasaporteOrigen.js');
  const bytes = src.match(/const BYTES_SERIAL = (\d+);/);
  assert.ok(bytes, 'desapareció BYTES_SERIAL');
  assert.ok(
    Number(bytes[1]) >= 8,
    `BYTES_SERIAL es ${bytes[1]}: con menos de 8 el espacio vuelve a ser enumerable`
  );
  // Y que nadie deje un randomBytes(2) suelto en los generadores.
  for (const fn of ['generarSerialTarjeta', 'generarSerialCredencialProveedor']) {
    const i = src.indexOf(`export function ${fn}()`);
    assert.notEqual(i, -1, `no está ${fn}`);
    const cuerpo = src.slice(i, i + 200);
    assert.ok(
      !/randomBytes\([0-7]\)/.test(cuerpo),
      `${fn} volvió a un randomBytes corto`
    );
  }
});

test('/v/:serial NO devuelve la instrucción de la torre', () => {
  const h = handlerPublicoTarjeta();
  assert.ok(
    !h.includes('torre_mensajes'),
    'el endpoint público volvió a consultar torre_mensajes: el destino de la carga queda sin clave'
  );
  for (const campo of ['instruccion', 'destino', 'zona', 'emisor']) {
    assert.ok(!h.includes(campo), `/v/:serial volvió a exponer "${campo}"`);
  }
});

test('/v/:serial tampoco devuelve el portador', () => {
  // El nombre de quien transporta no le hace falta a nadie que solo
  // escanea la tarjeta, y sumado al código de lote arma un perfil.
  const h = handlerPublicoTarjeta();
  assert.ok(!h.includes('portador'), '/v/:serial volvió a exponer el portador');
});

test('la instrucción vive detrás de la clave del portador', () => {
  const i = ORIGEN.indexOf("tarjetaRouter.get('/instruccion'");
  assert.notEqual(i, -1, 'desapareció GET /api/tarjeta/instruccion');
  const decl = ORIGEN.slice(i, i + 160);
  assert.ok(decl.includes('requireAuth'), 'la instrucción quedó sin requireAuth');
  assert.ok(
    decl.includes("requireRole('tarjeta')"),
    'la instrucción quedó sin requireRole: otro rol podría leerla'
  );
});

test('los seriales cortos ya emitidos siguen entrando', async () => {
  // Hay tarjetas TV-XXXX impresas y grabadas circulando. Rechazarlas de
  // golpe deja camiones en ruta sin poder registrar un paso, que es peor
  // que el riesgo que se cierra.
  const { serialTarjetaValido } = await import('../src/services/pasaporteOrigen.js');
  assert.equal(serialTarjetaValido('TV-04A2'), true);
});
