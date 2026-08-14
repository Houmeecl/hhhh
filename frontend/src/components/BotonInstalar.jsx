import { useEffect, useState } from 'react';

// ============================================================
// Botón "Instalar app" para las PWA (hoy: Sube y Suma). Evita que la
// persona tenga que descubrir sola el menú del navegador — que es
// distinto en cada uno y en iPhone ni siquiera está donde uno espera.
//
// Tres caminos, porque los navegadores no se comportan igual:
//  · Chrome/Edge/Android: disparan `beforeinstallprompt`. Se guarda el
//    evento y el botón lo re-dispara con prompt(). Es el único caso con
//    instalación de un toque.
//  · iOS/Safari: NO existe ese evento — la única vía es Compartir →
//    "Agregar a inicio". Ahí el botón muestra esa instrucción.
//  · Ya instalada (display-mode: standalone): no se muestra nada, sería
//    ofrecer instalar algo que ya está instalado.
// ============================================================

// Safari en iPhone/iPad. El check de `MSStream` descarta los IE móviles
// viejos que mentían en el userAgent.
function esIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

// Corriendo ya como app instalada, no como pestaña del navegador.
// `standalone` a secas es el de iOS, que no implementa display-mode.
function yaInstalada() {
  return window.matchMedia?.('(display-mode: standalone)')?.matches
    || window.navigator.standalone === true;
}

// `respaldo`: qué hacer cuando el navegador NO ofrece instalación con un
// toque. Por defecto se explica cómo hacerlo a mano; con `false` el
// componente se calla, para los sitios donde el aviso estorbaría en medio
// de otro flujo.
export default function BotonInstalar({ nombre = 'la app', className = 'btn btn-outline btn-sm', style, respaldo = true }) {
  const [evento, setEvento] = useState(null);
  const [instalada, setInstalada] = useState(yaInstalada);
  const [verAyuda, setVerAyuda] = useState(false);

  useEffect(() => {
    // preventDefault: sin esto Chrome muestra su propio banner además
    // del botón, y quedan dos invitaciones a lo mismo.
    const alPoder = (e) => { e.preventDefault(); setEvento(e); };
    const alInstalar = () => { setInstalada(true); setEvento(null); };
    window.addEventListener('beforeinstallprompt', alPoder);
    window.addEventListener('appinstalled', alInstalar);
    return () => {
      window.removeEventListener('beforeinstallprompt', alPoder);
      window.removeEventListener('appinstalled', alInstalar);
    };
  }, []);

  async function instalar() {
    if (!evento) return;
    evento.prompt();
    // `outcome` es 'accepted' | 'dismissed'. El evento se consume: si lo
    // rechaza, el navegador no lo vuelve a emitir en esta visita, así que
    // se descarta el botón en vez de dejar uno que ya no hace nada.
    const { outcome } = await evento.userChoice;
    setEvento(null);
    if (outcome === 'accepted') setInstalada(true);
  }

  if (instalada) return null;

  if (esIOS()) {
    return (
      <div style={style}>
        <button type="button" className={className} onClick={() => setVerAyuda((v) => !v)}>
          Instalar {nombre}
        </button>
        {verAyuda && (
          <p className="muted" style={{ fontSize: 12.5, marginTop: 8, lineHeight: 1.5 }}>
            En iPhone se agrega desde Safari: toca <b>Compartir</b> (el cuadrado con la flecha
            hacia arriba, abajo en la pantalla) y elige <b>Agregar a inicio</b>.
          </p>
        )}
      </div>
    );
  }

  // Sin el evento de instalación (Firefox, Chrome de escritorio que aún
  // no considera que la app califique, cualquier navegador sin soporte)
  // ANTES no se dibujaba nada. El resultado era el peor de los mundos: la
  // persona llegaba a la página a buscar cómo bajar el juego y no veía
  // ningún botón — como si no existiera.
  //
  // Un botón muerto sigue siendo mala idea, pero callarse tampoco es la
  // respuesta: se explica cómo dejarla instalada desde el menú del propio
  // navegador. `respaldo={false}` lo apaga donde el aviso estorbe (en
  // medio de un flujo, por ejemplo).
  if (!evento) {
    if (!respaldo) return null;
    return (
      <div style={style}>
        <button type="button" className={className} onClick={() => setVerAyuda((v) => !v)}>
          Cómo instalar {nombre}
        </button>
        {verAyuda && (
          <p className="muted" style={{ fontSize: 12.5, marginTop: 8, lineHeight: 1.5 }}>
            Este navegador no ofrece instalación con un toque. Abre su menú
            (los tres puntos, arriba a la derecha) y busca <b>Instalar</b> o
            <b> Agregar a la pantalla de inicio</b>. También puedes seguir
            usándola desde el navegador: funciona igual.
          </p>
        )}
      </div>
    );
  }

  return (
    <div style={style}>
      <button type="button" className={className} onClick={instalar}>
        Instalar {nombre}
      </button>
    </div>
  );
}
