// Explicit event schema: never forward free text, RUTs, email, URLs or documents.
export const EVENTS = Object.freeze([
  'pagina_visitada', 'inscripcion_completada',
  'problema_registrado', 'analisis_completado', 'propuesta_consultada',
  'simulacion_completada', 'cotizacion_solicitada',
]);
const CATEGORIES = {
  pagina: ['inicio', 'plataforma', 'inscripcion', 'auspicio', 'instituto', 'corredor', 'prueba'],
  rubro: ['transporte_personal', 'transporte_carga', 'maestranza', 'montaje', 'alimentacion', 'comercio', 'otro'],
  comuna: ['antofagasta', 'mejillones', 'calama', 'sierra_gorda', 'tocopilla', 'taltal', 'otra'],
  tipo_problema: ['retraso', 'averia', 'viaje_cancelado', 'corte_electrico', 'corte_agua', 'viento', 'oleaje', 'lluvia', 'otro'],
  tipo_cobertura: ['traslado_respaldo', 'llegada_turno', 'continuidad_transporte', 'viento', 'oleaje', 'suministros', 'otra'],
  resultado: ['viable', 'faltan_datos', 'descartado'],
};
export function safeProperties(input = {}) {
  const output = {};
  for (const [key, values] of Object.entries(CATEGORIES)) {
    if (typeof input?.[key] === 'string' && values.includes(input[key])) output[key] = input[key];
  }
  return output;
}
export function publicPage(pathname) {
  return ({
    '/': 'inicio', '/plataforma': 'plataforma', '/inscripcion': 'inscripcion',
    '/auspicio': 'auspicio', '/instituto': 'instituto', '/corredor': 'corredor',
    '/prueba': 'prueba',
  })[pathname] || null;
}

export function createAnalytics({ apiKey, serverZone = 'US', loadSdk, enabled = true, blocked = () => false }) {
  let initialization;
  let optedOut = false;
  let sdk;
  let lastNavigation;
  const allowed = () => Boolean(enabled && apiKey && !optedOut && !blocked());
  const ready = () => {
    if (!allowed()) return Promise.resolve(null);
    if (!initialization) {
      initialization = (async () => {
        const loaded = await loadSdk();
        if (!allowed()) { initialization = undefined; return null; }
        sdk = loaded;
        await sdk.init(apiKey, undefined, {
          serverZone: serverZone === 'EU' ? 'EU' : 'US',
          autocapture: false,
          defaultTracking: false,
          fetchRemoteConfig: false,
          identityStorage: 'sessionStorage',
          trackingOptions: { ipAddress: false, language: false, platform: false },
        }).promise;
        return sdk;
      })().catch(() => {
        initialization = undefined;
        return null;
      });
    }
    return initialization;
  };
  async function track(name, properties) {
    if (!EVENTS.includes(name) || !allowed()) return false;
    const clean = safeProperties(properties);
    try {
      const client = await ready();
      if (!client || !allowed()) return false;
      // A failed upload must never interrupt the customer's business operation.
      const delivery = client.track(name, clean);
      delivery?.promise?.catch(() => {});
      return true; // queued, not proof of server ingestion
    } catch { return false; }
  }
  return {
    track,
    page(pathname, navigationKey) {
      const label = publicPage(pathname);
      // Keep the local navigation identity even on excluded pages; never send it.
      const identity = navigationKey + ':' + pathname;
      if (identity === lastNavigation) return Promise.resolve(false);
      lastNavigation = identity;
      return label ? track('pagina_visitada', { pagina: label }) : Promise.resolve(false);
    },
    setOptOut(value) {
      optedOut = Boolean(value);
      try { sdk?.setOptOut(optedOut); } catch { /* analytics is optional */ }
    },
  };
}
