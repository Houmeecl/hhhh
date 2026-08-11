// ============================================================
// Inscripción de empresas — validación PURA (sin BD, sin red).
//
// Mismo criterio que services/auspicio.js: es un formulario PÚBLICO,
// cualquiera puede enviarlo, así que la validación vive acá y se testea
// sola. Estricta con RUT y correo (terminan en la conversación comercial
// y en el prospecto), laxa con el resto.
// ============================================================

import { rutValido } from './dte.js';

export const INTERESES = ['carbono', 'corredor', 'capacitacion', 'rep'];
export const MAX_MENSAJE = 2000;

const texto = (v, max) => String(v ?? '').trim().slice(0, max);

// Devuelve { ok, error, datos }. Nunca lanza: un formulario público que
// revienta con una excepción es un 500 en la cara del que se inscribe.
export function validarInscripcion(entrada) {
  const body = entrada && typeof entrada === 'object' ? entrada : {};
  const rut = texto(body.rut, 20);
  const nombre_empresa = texto(body.nombre_empresa, 200);
  const contacto_nombre = texto(body.contacto_nombre, 150);
  const contacto_email = texto(body.contacto_email, 200).toLowerCase();

  if (!nombre_empresa) return { ok: false, error: 'Falta el nombre de la empresa' };
  if (!rutValido(rut)) return { ok: false, error: 'El RUT no es válido' };
  if (!contacto_nombre) return { ok: false, error: 'Falta el nombre de contacto' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contacto_email)) {
    return { ok: false, error: 'El correo de contacto no es válido' };
  }

  // Solo claves conocidas; lo demás se descarta en silencio (el
  // formulario real solo ofrece estas casillas — cualquier otra cosa es
  // un cliente manipulado, no un error del usuario).
  const intereses = Array.isArray(body.intereses)
    ? [...new Set(body.intereses.filter((i) => INTERESES.includes(i)))]
    : [];
  if (intereses.length === 0) {
    return { ok: false, error: 'Indica al menos un área de interés' };
  }

  return {
    ok: true,
    error: null,
    datos: {
      rut,
      nombre_empresa,
      contacto_nombre,
      contacto_cargo: texto(body.contacto_cargo, 120) || null,
      contacto_email,
      contacto_telefono: texto(body.contacto_telefono, 40) || null,
      intereses,
      mensaje: texto(body.mensaje, MAX_MENSAJE) || null,
    },
  };
}

// Lo que se copia de una inscripción al prospecto del pipeline (tabla
// prospectos, sin columnas de correo/fono propias): el contacto queda en
// `contacto` y el detalle completo en `notas`, para no perder nada.
export function prospectoDesdeInscripcion(s = {}) {
  const intereses = Array.isArray(s.intereses) ? s.intereses : [];
  const notas = [
    `Correo: ${s.contacto_email || '—'}`,
    s.contacto_telefono ? `Fono: ${s.contacto_telefono}` : null,
    s.contacto_cargo ? `Cargo: ${s.contacto_cargo}` : null,
    intereses.length ? `Interés: ${intereses.join(', ')}` : null,
    s.mensaje ? `Mensaje: ${s.mensaje}` : null,
  ].filter(Boolean).join('\n');
  return {
    nombre_empresa: s.nombre_empresa,
    rut: s.rut,
    contacto: s.contacto_nombre,
    etapa: 'nuevo',
    origen: 'inscripción web',
    notas,
  };
}
