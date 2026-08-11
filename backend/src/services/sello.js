// ============================================================
// Sello embebible de sicr3p — SVG generado en el servidor, sin
// dependencias. Un comercio lo pega en su sitio (<img> o <object>)
// y muestra su contabilidad de carbono TRAZABLE con enlace de
// verificación pública. Nunca dice "certificado" ni "acreditado":
// sicr3p no certifica, hace contabilidad trazable.
// ============================================================

// Escapa los cinco caracteres especiales de XML. OBLIGATORIO para
// todo texto variable que entre al SVG (la empresa la escribe el
// cliente: sin esto, un nombre malicioso inyectaría markup).
export function escapeXml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Trunca a `max` caracteres agregando "…" (para que el nombre de la
// empresa no se salga del sello).
function truncar(s, max) {
  const t = String(s ?? '').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

const TEMAS = {
  claro: { fondo: '#ffffff', borde: '#e6e9ed', texto: '#16283c', suave: '#5b6b7b' },
  oscuro: { fondo: '#0f1f2e', borde: '#24384c', texto: '#f2f5f8', suave: '#9fb0c0' },
};

const VERDE = '#28a745';
const FUENTE = 'Poppins, -apple-system, Segoe UI, sans-serif';

// Etiquetas fijas del sello por idioma. El español es el default y queda
// byte a byte idéntico al sello original; 'en' traduce SOLO los textos
// fijos (empresa, toneladas y fecha son datos y no se tocan). Igual que
// en español, jamás "certified" ni "accredited": contabilidad verificable.
const ETIQUETAS = {
  es: {
    aria: 'Sello sicr3p de contabilidad de carbono trazable',
    subtitulo: 'Contabilidad de carbono trazable',
    cadena: 'cadena de integridad',
    verificar: 'verificable en',
  },
  en: {
    aria: 'sicr3p verifiable carbon accounting seal',
    subtitulo: 'Verifiable carbon accounting',
    cadena: 'chain intact',
    verificar: 'verify at',
  },
};

// Genera el sello completo como string SVG (~340×120). Función PURA:
// recibe todo lo que necesita, no toca red ni base de datos.
export function generarSelloSvg({
  empresa,
  t_co2e,
  fecha,
  nivel_rep = null,
  cadena_intacta = null,
  verificar_url = '',
  tema = 'claro',
  lang = 'es',
} = {}) {
  const c = TEMAS[tema] || TEMAS.claro;
  const L = ETIQUETAS[lang] || ETIQUETAS.es;
  const emp = escapeXml(truncar(empresa, 28));
  const toneladas = escapeXml(`${Number(t_co2e || 0)} t CO2e`);
  const fechaTxt = escapeXml(fecha || '');
  const urlSinProtocolo = escapeXml(String(verificar_url || '').replace(/^https?:\/\//i, ''));

  const partes = [];
  partes.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="340" height="120" viewBox="0 0 340 120" role="img" aria-label="${L.aria}">`
  );
  partes.push(
    `<rect x="0.5" y="0.5" width="339" height="119" rx="10" fill="${c.fondo}" stroke="${c.borde}"/>`
  );
  // Wordmark: "sicr3p" con el punto verde de la marca.
  partes.push(
    `<text x="16" y="26" font-family="${FUENTE}" font-size="16" font-weight="700" fill="${c.texto}">sicr3p<tspan fill="${VERDE}">.</tspan></text>`
  );
  partes.push(
    `<text x="16" y="40" font-family="${FUENTE}" font-size="8.5" fill="${c.suave}">${L.subtitulo}</text>`
  );
  partes.push(
    `<text x="16" y="61" font-family="${FUENTE}" font-size="12" font-weight="600" fill="${c.texto}">${emp}</text>`
  );
  partes.push(
    `<text x="16" y="77" font-family="${FUENTE}" font-size="10" fill="${c.texto}">${toneladas}${fechaTxt ? ` · ${fechaTxt}` : ''}</text>`
  );

  // Fila de distintivos: chip REP y/o cadena de integridad.
  let x = 16;
  if (nivel_rep) {
    const chipTxt = escapeXml(`REP ${nivel_rep}`);
    const chipW = 14 + chipTxt.length * 5;
    partes.push(`<rect x="${x}" y="85" width="${chipW}" height="14" rx="7" fill="${VERDE}"/>`);
    partes.push(
      `<text x="${x + chipW / 2}" y="95" text-anchor="middle" font-family="${FUENTE}" font-size="8" font-weight="600" fill="#ffffff">${chipTxt}</text>`
    );
    x += chipW + 10;
  }
  if (cadena_intacta === true) {
    partes.push(
      `<text x="${x}" y="95" font-family="${FUENTE}" font-size="8.5" fill="${VERDE}">&#10003; ${L.cadena}</text>`
    );
  }

  if (urlSinProtocolo) {
    partes.push(
      `<text x="16" y="112" font-family="${FUENTE}" font-size="7.5" fill="${c.suave}">${L.verificar} ${urlSinProtocolo}</text>`
    );
  }
  partes.push('</svg>');
  return partes.join('');
}
