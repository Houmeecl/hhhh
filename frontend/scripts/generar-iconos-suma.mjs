// ============================================================
// Regenera los íconos de la PWA "Sube y Suma" (public/icons/
// icono-suma-*.png) a partir del SVG de abajo — la fuente de verdad del
// diseño es este archivo, no los PNG.
//
// Uso:  node frontend/scripts/generar-iconos-suma.mjs
// Requiere Playwright con Chromium (se usa el navegador como
// rasterizador; el repo no trae una dependencia de imágenes).
// Ajusta PLAYWRIGHT si tu instalación está en otra ruta.
// ============================================================
import { chromium } from 'playwright';

const PLAYWRIGHT_CHROMIUM = process.env.CHROMIUM_PATH || undefined;

// Ícono propio de "Sube y Suma". Misma familia que el corporativo
// (cuadrado redondeado, glifo blanco grueso, punto de acento) pero
// inconfundible al lado de él en la pantalla de inicio: fondo verde
// profundo en vez de azul marino, flecha hacia arriba en vez del "3",
// y el punto en verde azulado (el theme_color del juego).
//
// `safe` = fracción del lienzo que ocupa el glifo. En el maskable el
// sistema recorta hasta un círculo inscrito: todo lo que importa vive
// en el 80% central.
function html({ size, radius, safe, punto }) {
  const g = size * safe;          // caja del glifo
  const off = (size - g) / 2;     // centrado
  return `<!doctype html><meta charset="utf-8">
<style>
  html,body { margin:0; padding:0; background:transparent; }
  svg { display:block; }
</style>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect x="0" y="0" width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="#0f2e2b"/>
  <g transform="translate(${off} ${off}) scale(${g / 100})">
    <!-- Flecha "sube": punta ancha + asta corta, legible a 192 px. -->
    <path d="M50 4 L88 42 L68 42 L68 60 L32 60 L32 42 L12 42 Z" fill="#ffffff"/>
    <!-- "+" de suma: dice el nombre del juego y lo separa de un ícono
         genérico de "subir archivo", que es como se leía con una barra.
         rx bajo a propósito: con el radio cerca de la mitad del ancho las
         dos barras se redondean hasta parecer un trébol, no una cruz. -->
    <rect x="43" y="68" width="14" height="32" rx="3" fill="#ffffff"/>
    <rect x="34" y="77" width="32" height="14" rx="3" fill="#ffffff"/>
  </g>
  <!-- Punto de acento, mismo gesto que el ícono corporativo. En la
       variante maskable va más adentro: el recorte del sistema es un
       círculo y, en la esquina, este punto se perdía. -->
  <circle cx="${size * punto.cx}" cy="${size * punto.cy}" r="${size * punto.r}" fill="#0d9488"/>
</svg>`;
}

const browser = await chromium.launch({
  ...(PLAYWRIGHT_CHROMIUM ? { executablePath: PLAYWRIGHT_CHROMIUM } : {}),
  args: ['--no-sandbox'],
});
const page = await (await browser.newContext({ deviceScaleFactor: 1 })).newPage();

const ESQUINA = { cx: 0.79, cy: 0.21, r: 0.105 };
// Zona segura del maskable = círculo de radio 0.4 desde el centro. A
// (0.70, 0.30) con r=0.085 el punto queda a 0.37 del centro: entra
// entero. En la esquina quedaba a 0.51 — recortado.
const ADENTRO = { cx: 0.70, cy: 0.30, r: 0.085 };

const salidas = [
  { archivo: 'icono-suma-192.png', size: 192, radius: 42, safe: 0.62, punto: ESQUINA },
  { archivo: 'icono-suma-512.png', size: 512, radius: 112, safe: 0.62, punto: ESQUINA },
  // Maskable: sin esquinas (el sistema pone la suya) y glifo más chico,
  // dentro del 80% seguro.
  { archivo: 'icono-suma-maskable-512.png', size: 512, radius: 0, safe: 0.46, punto: ADENTRO },
];

// Relativo a este archivo: el script corre igual desde cualquier cwd.
const dir = new URL('../public/icons/', import.meta.url).pathname;
for (const s of salidas) {
  await page.setViewportSize({ width: s.size, height: s.size });
  await page.setContent(html(s));
  await page.locator('svg').screenshot({ path: `${dir}/${s.archivo}`, omitBackground: true });
  console.log('escrito', s.archivo, `${s.size}x${s.size}`);
}
await browser.close();
