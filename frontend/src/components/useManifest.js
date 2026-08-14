import { useEffect } from 'react';

// ============================================================
// Cambia el manifiesto que declara la página mientras el componente está
// montado, y lo restaura al salir.
//
// EL SITIO SIRVE CUATRO APPS INSTALABLES desde un mismo index.html, que
// enlaza el manifiesto genérico (`/manifest.webmanifest`, start_url "/").
// Cada shell lo reemplaza por el suyo: el navegador instala lo que dice
// el manifiesto VIGENTE en el momento en que la persona toca "instalar".
//
// POR QUÉ ESTÁ ACÁ Y NO COPIADO EN CADA SHELL. Estaba duplicado en
// JuegoApp y en AdminAvApp, y la copia que faltaba causó un bug real:
// `/suma/login` mostraba el botón "Instalar Sube y Suma" sin haber
// cambiado el manifiesto, así que instalaba el SITIO —abriéndose en la
// portada— en vez del juego. El botón funcionaba; lo que instalaba era
// otra cosa. Con el hook compartido, poner el botón y poner el manifiesto
// dejan de ser dos decisiones separadas que alguien puede desalinear.
//
// OJO CON EL `scope` DEL MANIFIESTO: `manifest-suma` declara "/suma", así
// que la invitación a instalar solo se ofrece en páginas bajo esa ruta.
// Una página de descarga colgada de "/descargar" tendría el botón y el
// navegador nunca dispararía el evento.
// ============================================================

export function useManifest(href) {
  useEffect(() => {
    const link = document.querySelector('link[rel="manifest"]');
    if (!link || !href) return undefined;
    const original = link.getAttribute('href');
    link.setAttribute('href', href);
    return () => link.setAttribute('href', original);
  }, [href]);
}

export const useManifestSuma = () => useManifest('/manifest-suma.webmanifest');
