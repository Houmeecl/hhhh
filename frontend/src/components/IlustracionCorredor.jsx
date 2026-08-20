import { useEffect, useState } from 'react';
import { PUNTOS_CORREDOR, PUNTOS_FRONTERA } from '../lib/corredor.js';

// ============================================================
// Ilustración del Corredor Bioceánico — SVG, dibujada a partir de las
// COORDENADAS REALES del catálogo (`lib/corredor.js`), no de un trazado
// inventado a mano.
//
// POR QUÉ ASÍ. La regla de producto de sicr3p dice que una imagen de
// producto es una captura real, nunca un mockup. Un mapa dibujado a ojo
// cae del lado equivocado de esa regla: se ve como un dato y no lo es.
// Proyectando el mismo array que alimenta la torre de control, la línea
// que se ve acá ES el corredor — y si mañana se agrega un punto al
// catálogo, la ilustración lo incorpora sola.
//
// LO QUE ESTA ILUSTRACIÓN NO ES. No es un mapa geográfico: no hay
// costas, ni fronteras políticas dibujadas, ni escala. Es un diagrama de
// la ruta, y por eso la proyección es lineal y no cartográfica. Dibujar
// una silueta de Sudamérica a mano alzada sería exactamente el mockup
// que la regla prohíbe.
//
// Y NO DICE DÓNDE ESTÁ NINGUNA CARGA. Los puntos son lugares fijos y
// públicos —aduanas, ciudades, puertos—. La plataforma no rastrea
// vehículos; ver docs/CORREDOR-PLAN.md §4.0.
// ============================================================

const PAIS = {
  BR: { nombre: 'Brasil', color: '#0f766e' },
  PY: { nombre: 'Paraguay', color: '#0e7490' },
  AR: { nombre: 'Argentina', color: '#1d4ed8' },
  CL: { nombre: 'Chile', color: '#28a745' },
};

// En un teléfono el diagrama horizontal se salía de la pantalla y había
// que deslizarlo de lado: se veía ROTO, no deslizable. Vertical es como
// se lee una ruta en un teléfono —de arriba abajo— y además caben los
// catorce puntos rotulados, así que la versión chica termina diciendo
// MÁS que la grande, no menos.
function useVertical(limite = 720) {
  const [vertical, setVertical] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(`(max-width: ${limite}px)`).matches
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${limite}px)`);
    const alCambiar = (e) => setVertical(e.matches);
    mq.addEventListener('change', alCambiar);
    setVertical(mq.matches);
    return () => mq.removeEventListener('change', alCambiar);
  }, [limite]);
  return vertical;
}

const ANCHO = 920;
const ALTO = 360;
const MARGEN = { x: 58, arriba: 74, abajo: 92 };

// Proyección lineal de lng/lat al lienzo. El corredor va de este a oeste
// (de -54.6 a -70.5) en una franja de latitud angosta (-20.5 a -24.2),
// así que el eje X lleva la longitud y el Y la latitud, cada uno
// normalizado a su propio rango. Es un diagrama, no una carta náutica.
function proyectar(puntos) {
  const lngs = puntos.map((p) => p.lng);
  const lats = puntos.map((p) => p.lat);
  const lngMin = Math.min(...lngs); const lngMax = Math.max(...lngs);
  const latMin = Math.min(...lats); const latMax = Math.max(...lats);
  const anchoUtil = ANCHO - MARGEN.x * 2;
  // Solo una parte del alto disponible: normalizar la latitud a todo el
  // lienzo exagera un desnivel de menos de 4 grados hasta que el trazado
  // se lee como un gráfico de bolsa. El corredor sube y baja, pero lo que
  // importa es que avanza de este a oeste.
  const altoUtil = (ALTO - MARGEN.arriba - MARGEN.abajo) * 0.62;

  return puntos.map((p) => ({
    ...p,
    // Se invierte la longitud: el origen del corredor está al ESTE
    // (Campo Grande) y el destino al OESTE (los puertos), y se lee de
    // izquierda a derecha como cualquier línea de tiempo.
    x: MARGEN.x + ((lngMax - p.lng) / (lngMax - lngMin || 1)) * anchoUtil,
    y: MARGEN.arriba + ((p.lat - latMax) / ((latMin - latMax) || 1)) * altoUtil,
  }));
}

// Curva suave que pasa por todos los puntos (Catmull-Rom convertida a
// Bézier cúbica). Una polilínea recta se ve como un gráfico; la curva se
// lee como una ruta, que es lo que es.
function trazado(pts) {
  if (pts.length < 2) return '';
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

const esPuerto = (id) => id.startsWith('puerto-') && id !== 'puerto-seco';

// Rótulos del pie que no se pisan. Antofagasta y Mejillones están a 5
// centésimas de grado de longitud: sus etiquetas quedaban una encima de
// la otra y se leía "AMejilliagasta". Cuando dos caen a menos de
// SEPARACION px, la segunda baja una fila.
const SEPARACION = 92;
const FILA = 17;

function acomodar(rotulos) {
  const ordenados = [...rotulos].sort((a, b) => a.x - b.x);
  let ultimoX = -Infinity;
  let fila = 0;
  return ordenados.map((r) => {
    fila = r.x - ultimoX < SEPARACION ? fila + 1 : 0;
    ultimoX = r.x;
    return { ...r, fila };
  });
}

const V_ANCHO = 340;
const V_FILA = 46;
const V_ARRIBA = 34;

// Vertical: una fila por punto —espaciado parejo, no proporcional a la
// distancia— porque acá el objetivo es que los catorce nombres se lean,
// no representar kilómetros. El vaivén en X sí sale de la longitud real,
// para que siga pareciendo una ruta y no una lista.
function proyectarVertical(puntos) {
  const lngs = puntos.map((p) => p.lng);
  const lngMin = Math.min(...lngs); const lngMax = Math.max(...lngs);
  return puntos.map((p, i) => ({
    ...p,
    x: 34 + ((lngMax - p.lng) / (lngMax - lngMin || 1)) * 52,
    y: V_ARRIBA + i * V_FILA,
  }));
}

function IlustracionVertical() {
  const pts = proyectarVertical(PUNTOS_CORREDOR);
  const alto = V_ARRIBA + (pts.length - 1) * V_FILA + 40;
  const d = trazado(pts);
  return (
    <svg viewBox={`0 0 ${V_ANCHO} ${alto}`} preserveAspectRatio="xMidYMin meet" focusable="false">
      <defs>
        <linearGradient id="cor-ruta-v" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0f766e" />
          <stop offset="45%" stopColor="#1d4ed8" />
          <stop offset="100%" stopColor="#28a745" />
        </linearGradient>
      </defs>
      <path d={d} className="cor-ilu-halo" stroke="url(#cor-ruta-v)" />
      <path d={d} className="cor-ilu-linea" stroke="url(#cor-ruta-v)" />
      {pts.map((p, i) => {
        const frontera = PUNTOS_FRONTERA.includes(p.id);
        const color = PAIS[p.pais]?.color || '#64748b';
        const primeroDelPais = i === 0 || pts[i - 1].pais !== p.pais;
        return (
          <g key={p.id}>
            {frontera
              ? (
                <rect x={p.x - 7} y={p.y - 7} width="14" height="14" rx="2"
                  transform={`rotate(45 ${p.x} ${p.y})`} className="cor-ilu-frontera" stroke={color} />
              )
              : <circle cx={p.x} cy={p.y} r={esPuerto(p.id) ? 6.5 : 4} className="cor-ilu-punto" stroke={color} />}
            <text x={p.x + 18} y={p.y + 4} className="cor-ilu-fila" fill={frontera || esPuerto(p.id) ? color : undefined}>
              {p.nombre.replace(/\s*\(frontera .+\)$/, '')}
            </text>
            {primeroDelPais && (
              <text x={V_ANCHO - 8} y={p.y + 4} textAnchor="end" className="cor-ilu-pais" fill={color}>
                {PAIS[p.pais]?.nombre}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export default function IlustracionCorredor({ titulo = 'Ruta del Corredor Bioceánico, de Campo Grande a los puertos de Antofagasta' }) {
  const vertical = useVertical();
  if (vertical) {
    return (
      <figure className="cor-ilu cor-ilu-v" role="img" aria-label={titulo}>
        <IlustracionVertical />
      </figure>
    );
  }
  const pts = proyectar(PUNTOS_CORREDOR);
  const d = trazado(pts);

  // Una etiqueta por país, sobre el punto medio de sus paradas. Rotular
  // los catorce puntos deja un amasijo ilegible en el celular; los
  // nombres completos están en la torre de control, que es donde
  // importan.
  const paises = Object.keys(PAIS).map((cod) => {
    const suyos = pts.filter((p) => p.pais === cod);
    if (!suyos.length) return null;
    const x = suyos.reduce((a, p) => a + p.x, 0) / suyos.length;
    return { cod, x, ...PAIS[cod] };
  }).filter(Boolean);

  const rotulos = acomodar(
    pts
      .filter((p) => PUNTOS_FRONTERA.includes(p.id) || esPuerto(p.id))
      .map((p) => ({
        id: p.id,
        x: p.x,
        y: p.y,
        color: PAIS[p.pais]?.color || '#64748b',
        texto: PUNTOS_FRONTERA.includes(p.id)
          ? p.nombre.replace(/^.*\(frontera (.+)\)$/, '$1')
          : p.nombre.replace('Puerto ', ''),
      }))
  );

  return (
    <figure className="cor-ilu" role="img" aria-label={titulo}>
      <svg viewBox={`0 0 ${ANCHO} ${ALTO}`} preserveAspectRatio="xMidYMid meet" focusable="false">
        <defs>
          <linearGradient id="cor-ruta" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#0f766e" />
            <stop offset="45%" stopColor="#1d4ed8" />
            <stop offset="100%" stopColor="#28a745" />
          </linearGradient>
          <filter id="cor-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="6" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* Bandas de país: contexto sin dibujar fronteras que no sabemos
            dónde van exactamente. */}
        {paises.map((p, i) => {
          const siguiente = paises[i + 1];
          const desde = i === 0 ? 0 : (paises[i - 1].x + p.x) / 2;
          const hasta = siguiente ? (p.x + siguiente.x) / 2 : ANCHO;
          return (
            <g key={p.cod}>
              <rect x={desde} y={0} width={hasta - desde} height={ALTO} fill={p.color} opacity="0.045" />
              <text x={(desde + hasta) / 2} y={34} textAnchor="middle"
                className="cor-ilu-pais" fill={p.color}>{p.nombre}</text>
            </g>
          );
        })}

        {/* La ruta: una sombra ancha y suave debajo, la línea nítida encima. */}
        <path d={d} className="cor-ilu-halo" stroke="url(#cor-ruta)" filter="url(#cor-glow)" />
        <path d={d} className="cor-ilu-linea" stroke="url(#cor-ruta)" />

        {/* Los nodos: rombo en los tres cruces de frontera —que es donde
            cambia la documentación exigida y lo que hace caro este
            corredor—, círculo grande en los puertos, punto en el resto. */}
        {pts.map((p) => {
          const frontera = PUNTOS_FRONTERA.includes(p.id);
          const color = PAIS[p.pais]?.color || '#64748b';
          if (frontera) {
            return (
              <rect key={p.id} x={p.x - 8} y={p.y - 8} width="16" height="16" rx="2"
                transform={`rotate(45 ${p.x} ${p.y})`} className="cor-ilu-frontera" stroke={color} />
            );
          }
          return (
            <circle key={p.id} cx={p.x} cy={p.y} r={esPuerto(p.id) ? 7 : 4.5}
              className="cor-ilu-punto" stroke={color} />
          );
        })}

        {/* Los rótulos, aparte y ya acomodados para que no se pisen. */}
        {rotulos.map((r) => {
          const y = ALTO - 50 + r.fila * FILA;
          return (
            <g key={r.id}>
              <line x1={r.x} y1={r.y + 13} x2={r.x} y2={y - 11} className="cor-ilu-guia" stroke={r.color} />
              <text x={r.x} y={y} textAnchor="middle" className="cor-ilu-cruce" fill={r.color}>{r.texto}</text>
            </g>
          );
        })}

        {/* Los dos extremos, rotulados completos. */}
        <text x={pts[0].x} y={pts[0].y - 18} textAnchor="start" className="cor-ilu-extremo">Campo Grande</text>
        <text x={ANCHO - MARGEN.x} y={ALTO - 20} textAnchor="end" className="cor-ilu-pie">
          {PUNTOS_CORREDOR.length} puntos de control · 3 cruces de frontera · 4 países
        </text>
        <text x={MARGEN.x} y={ALTO - 20} textAnchor="start" className="cor-ilu-pie">
          Atlántico → Pacífico
        </text>
      </svg>
    </figure>
  );
}
