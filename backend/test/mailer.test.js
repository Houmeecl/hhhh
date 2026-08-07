import { test } from 'node:test';
import assert from 'node:assert/strict';
import { elegirTransporte } from '../src/services/mailer.js';

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
