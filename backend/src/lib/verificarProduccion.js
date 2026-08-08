// Verificación de configuración al arrancar, pensada para uso real:
// nada en el código impedía que un despliegue de producción quedara con
// los secretos JWT de desarrollo o con SEED_DEMO=true (contraseñas de
// portal fijas en "demo123"). Esta función es pura (recibe el config y
// devuelve hallazgos) para poder testearla sin base de datos; index.js
// decide qué hacer con el resultado: en producción los fatales abortan
// el arranque, en desarrollo solo se advierten.

const SECRETOS_DEV = ['dev_access_secret_change_me', 'dev_refresh_secret_change_me'];
const LARGO_MINIMO_SECRETO = 32;

export function verificarConfigProduccion(cfg) {
  const fatales = [];
  const advertencias = [];

  for (const [nombre, valor] of [
    ['JWT_ACCESS_SECRET', cfg.jwt.accessSecret],
    ['JWT_REFRESH_SECRET', cfg.jwt.refreshSecret],
  ]) {
    if (SECRETOS_DEV.includes(valor)) {
      fatales.push(`${nombre} sigue con el valor de desarrollo — genera uno con: openssl rand -hex 32`);
    } else if (String(valor).length < LARGO_MINIMO_SECRETO) {
      fatales.push(`${nombre} tiene menos de ${LARGO_MINIMO_SECRETO} caracteres — demasiado corto para firmar sesiones`);
    }
  }
  if (cfg.jwt.accessSecret === cfg.jwt.refreshSecret) {
    fatales.push('JWT_ACCESS_SECRET y JWT_REFRESH_SECRET son idénticos — deben ser secretos distintos');
  }

  if (cfg.seedDemo) {
    fatales.push('SEED_DEMO=true — sembraría clientes ficticios y contraseñas de portal fijas ("demo123")');
  }

  // Sin esta llave, el cifrado de credenciales SII caería a la llave fija de
  // desarrollo: las claves tributarias guardadas quedarían "cifradas" con un
  // secreto público. Es fatal en producción.
  if (!cfg.cripto?.siiKey) {
    fatales.push('SII_CRED_KEY vacía — se guardarían claves tributarias con la llave de cifrado de desarrollo; genera una con: openssl rand -hex 32');
  } else if (String(cfg.cripto.siiKey).length < LARGO_MINIMO_SECRETO) {
    fatales.push(`SII_CRED_KEY tiene menos de ${LARGO_MINIMO_SECRETO} caracteres — demasiado corta para cifrar credenciales`);
  }

  const smtpOk = cfg.smtp?.host && cfg.smtp?.user && cfg.smtp?.pass;
  if (!smtpOk && !cfg.resend.apiKey) {
    advertencias.push('Sin SMTP propio ni RESEND_API_KEY — los correos NO se envían, solo se escriben en el log');
  }
  if (!cfg.baseapi?.enabled) {
    advertencias.push('BASEAPI_API_KEY vacía — el autocompletado SII por RUT queda deshabilitado');
  }
  // FATAL, no advertencia. En modo mock, `simpleApi.mockAnalyzeInvoice` genera
  // el CO2e con un PRNG: ítems de una lista fija, cantidades aleatorias, hasta
  // un RUT emisor falso. Ese número entra a `facturas`, SE SELLA EN LA CADENA
  // DE HASH y se imprime en el informe firmado que recibe el cliente. Un
  // número inventado no puede llegar a producción por descuido de una variable
  // de entorno.
  if (cfg.simple.mock) {
    fatales.push('MOCK_SIMPLE=true — el motor externo fabricaría el CO2e con datos simulados y quedaría sellado en la cadena');
  }

  return { fatales, advertencias };
}
