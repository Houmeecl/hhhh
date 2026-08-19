// SEO por-ruta para la SPA — index.html solo trae el <title>/meta
// description genéricos de la portada; el resto de páginas públicas
// (Corredor, Instituto, Inscripción…) los sobreescriben al montarse y
// los restauran al desmontar, mismo patrón que useManifestAdmin en
// AdminApp.jsx. Sin dependencia nueva (react-helmet): son dos elementos
// del <head> que ya existen, no hace falta más que tocarlos a mano.
import { useEffect } from 'react';

export function useSeo(title, description) {
  useEffect(() => {
    const tituloAnterior = document.title;
    if (title) document.title = title;

    const meta = document.querySelector('meta[name="description"]');
    const descripcionAnterior = meta?.getAttribute('content');
    if (meta && description) meta.setAttribute('content', description);

    return () => {
      document.title = tituloAnterior;
      if (meta && descripcionAnterior != null) meta.setAttribute('content', descripcionAnterior);
    };
  }, [title, description]);
}

// Inyecta/retira un <script type="application/ld+json"> propio de la
// página (ej. FAQPage en la portada) — independiente de los JSON-LD
// estáticos (Organization/WebSite) que ya viven en index.html.
export function useJsonLd(data) {
  useEffect(() => {
    if (!data) return undefined;
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify(data);
    document.head.appendChild(script);
    return () => { document.head.removeChild(script); };
  }, [data]);
}
