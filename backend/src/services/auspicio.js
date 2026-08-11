// ============================================================
// Postulaciones de auspicio — validación PURA (sin BD, sin red).
//
// Es un formulario PÚBLICO: cualquiera puede enviarlo. Por eso la
// validación vive acá, se testea sola, y es estricta con lo que después
// termina impreso en un contrato — la razón social y el RUT de una
// postulación aceptada se copian tal cual al auspiciador y quedan
// congelados en el snapshot del convenio.
// ============================================================

import { rutValido } from './dte.js';

export const APORTES = ['aporta_vehiculo', 'aporta_monetario', 'aporta_difusion'];
export const MAX_MENSAJE = 2000;

const texto = (v, max) => String(v ?? '').trim().slice(0, max);

// Devuelve { ok, error, datos }. Nunca lanza: un formulario público que
// revienta con una excepción es un 500 en la cara del que postula.
export function validarSolicitud(entrada) {
  // `= {}` no basta: express.json() entrega `null` cuando el cuerpo es
  // literalmente `null`, y el default solo cubre `undefined`.
  const body = entrada && typeof entrada === 'object' ? entrada : {};
  const rut = texto(body.rut, 20);
  const nombre_empresa = texto(body.nombre_empresa, 200);
  const contacto_email = texto(body.contacto_email, 200).toLowerCase();

  if (!nombre_empresa) return { ok: false, error: 'Falta el nombre de la empresa' };
  if (!rutValido(rut)) return { ok: false, error: 'El RUT no es válido' };
  // Validación deliberadamente laxa: exigir una gramática de correo
  // completa rechaza direcciones legítimas. Que tenga arroba y punto
  // después basta para atajar el error de tipeo evidente.
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contacto_email)) {
    return { ok: false, error: 'El correo de contacto no es válido' };
  }

  const aportes = Object.fromEntries(APORTES.map((k) => [k, Boolean(body[k])]));
  if (!APORTES.some((k) => aportes[k])) {
    return { ok: false, error: 'Indica al menos una forma de aporte' };
  }

  const v = body.vehiculo || {};
  return {
    ok: true,
    error: null,
    datos: {
      rut,
      nombre_empresa,
      contacto_nombre: texto(body.contacto_nombre, 150) || null,
      contacto_email,
      contacto_telefono: texto(body.contacto_telefono, 40) || null,
      ...aportes,
      // El detalle del vehículo solo se guarda si de verdad ofrece uno:
      // si no, sería ruido que después aparece en el comodato.
      vehiculo: aportes.aporta_vehiculo
        ? {
            marca: texto(v.marca, 60), modelo: texto(v.modelo, 60),
            patente: texto(v.patente, 20).toUpperCase(), anio: texto(v.anio, 4),
          }
        : {},
      ciudades: texto(body.ciudades, 300) || null,
      mensaje: texto(body.mensaje, MAX_MENSAJE) || null,
    },
  };
}

// Lo que se copia de una postulación aceptada al auspiciador. Solo estos
// campos: el mensaje, el teléfono y las ciudades son de la conversación
// comercial, no condiciones del convenio.
export function auspiciadorDesdeSolicitud(s = {}) {
  return {
    rut: s.rut,
    nombre_empresa: s.nombre_empresa,
    contacto_email: s.contacto_email,
    aporta_vehiculo: Boolean(s.aporta_vehiculo),
    vehiculo: s.aporta_vehiculo ? (s.vehiculo || {}) : {},
  };
}
