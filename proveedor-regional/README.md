# Proveedor Regional — Landing interactiva

Landing de una página para **Proveedor Regional**, institución territorial para el desarrollo
de proveedores de la Región de Antofagasta (Chile). Sitio estático (HTML/CSS/JS, sin build),
servido por un pequeño servidor Express.

## Contenido

- `public/index.html` — estructura de la página (hero, propósito, servicios, territorio, formulario, footer)
- `public/css/style.css` — estilos y paleta de marca (azul marino, terracota, arena)
- `public/js/main.js` — interactividad: menú móvil, scroll-spy, contadores animados,
  pestañas de servicios, selector de comunas y formulario "Hazte parte" (con validación
  y confirmación, guardado localmente en `localStorage` como demo)

## Uso local

```bash
cd proveedor-regional
./run.sh
# → http://localhost:4300
```

También puede abrirse `public/index.html` directamente en el navegador (sin servidor),
ya que no depende de un backend.
