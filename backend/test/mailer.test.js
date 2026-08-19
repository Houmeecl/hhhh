import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  elegirTransporte, construirFrom, activationEmail, resetEmail, magicEmail,
} from '../src/services/mailer.js';
import { config } from '../src/config.js';
import { PANEL_LABEL } from '../src/services/cuentas.js';

// La lógica de selección de transporte es pura y no depende del entorno:
// SMTP propio tiene prioridad, luego Resend, y si no hay ninguno, modo dev.
// (El envío real por SMTP/Resend se verifica en el VPS, no en los tests.)

const SMTP = { host: 'mail.sicr3p.cl', user: 'no-responder@sicr3p.cl', pass: 'x' };

test('SMTP propio tiene prioridad sobre Resend', () => {
  assert.equal(elegirTransporte({ smtp: SMTP, resend: { apiKey: 're_x' } }), 'smtp');
});

test('sin SMTP, usa Resend', () => {
  assert.equal(elegirTransporte({ smtp: {}, resend: { apiKey: 're_x' } }), 'resend');
});

test('sin SMTP ni Resend, cae a modo dev', () => {
  assert.equal(elegirTransporte({ smtp: {}, resend: { apiKey: '' } }), 'dev');
});

test('SMTP incompleto (sin pass) no cuenta como configurado', () => {
  assert.equal(elegirTransporte({ smtp: { host: 'mail.sicr3p.cl', user: 'x' }, resend: { apiKey: 're_x' } }), 'resend');
});

// ============================================================
// Correo por ÁREA (mailer.js `area`) — cada panel se distingue en el
// remitente y el asunto, sin cambiar la casilla real de envío.
// ============================================================

// El correo real del remitente depende de MAIL_FROM (dueño del `.env` de
// cada entorno) — en dev/CI cae al default de config.js (sicrep.cl), en el
// VPS de producción es el dominio propio (sicr3p.cl). Hardcodear un correo
// literal aquí hacía que este test pasara en un entorno y reventara en
// otro por una razón ajena a construirFrom(): se lee el mismo valor que lee
// el código (config.resend.from) para verificar SOLO la lógica que importa
// —el nombre visible cambia por área, el correo real nunca— sin acoplarse
// a qué dominio esté configurado en cada `.env`.
const FROM_EMAIL = config.resend.from.match(/<([^>]+)>/)?.[1] || config.resend.from;

test('construirFrom: sin área, el FROM genérico de siempre', () => {
  assert.equal(construirFrom(null), `sicr3p <${FROM_EMAIL}>`);
  assert.equal(construirFrom(undefined), `sicr3p <${FROM_EMAIL}>`);
});

test('construirFrom: con área, mismo correo pero nombre distinguible', () => {
  assert.equal(construirFrom('Proveedor'), `sicr3p Proveedor <${FROM_EMAIL}>`);
  assert.equal(construirFrom('Puerto'), `sicr3p Puerto <${FROM_EMAIL}>`);
});


test('PANEL_LABEL: los 7 paneles con activación tienen etiqueta legible, cada una distinta', () => {
  const paneles = ['sicrep', 'aduana_verde', 'puerto', 'mandante', 'agencia', 'trazador', 'proveedor'];
  for (const p of paneles) assert.ok(PANEL_LABEL[p], `falta etiqueta para ${p}`);
  const etiquetas = paneles.map((p) => PANEL_LABEL[p]);
  assert.equal(new Set(etiquetas).size, etiquetas.length, 'dos paneles no pueden compartir la misma etiqueta — se confundirían igual');
});

test('activationEmail: el área se imprime en el asunto y el saludo, no solo en el remitente', () => {
  const sinArea = activationEmail({ nombre: 'Ana', link: 'https://x' });
  assert.doesNotMatch(sinArea.subject, /—/);

  const conArea = activationEmail({ nombre: 'Ana', link: 'https://x', area: 'Proveedor' });
  assert.match(conArea.subject, /Proveedor/);
  assert.match(conArea.html, /Proveedor/);
});

test('activationEmail: dos paneles distintos producen asuntos distinguibles entre sí', () => {
  const proveedor = activationEmail({ nombre: 'Ana', link: 'https://x', area: 'Proveedor' });
  const puerto = activationEmail({ nombre: 'Ana', link: 'https://x', area: 'Puerto' });
  assert.notEqual(proveedor.subject, puerto.subject);
});

test('resetEmail: mismo criterio — el área identifica de qué panel es la contraseña', () => {
  const conArea = resetEmail({ nombre: 'Ana', link: 'https://x', area: 'Agencia' });
  assert.match(conArea.subject, /Agencia/);
  assert.match(conArea.html, /Agencia/);
});

test('magicEmail: Sube y Suma se distingue del acceso de cliente genérico', () => {
  const cliente = magicEmail({ link: 'https://x' });
  const jugador = magicEmail({ link: 'https://x', area: 'Sube y Suma' });
  assert.notEqual(cliente.subject, jugador.subject);
  assert.match(jugador.subject, /Sube y Suma/);
  assert.doesNotMatch(cliente.subject, /Sube y Suma/);
});
