# Reglas de navegación — para todo shell/panel nuevo

sicr3p tiene 8 shells logueados (Admin, Terreno, Puerto, Mandante,
Agencia, Trazador, Proveedor, Sube y Suma) más el sitio público. Hasta
ahora 7 de 8 seguían el mismo patrón sin haberlo escrito en ningún lado
— Proveedor se desvió (pestañas con `useState` en vez de rutas) porque
nadie tenía dónde leer la regla. Este documento la deja escrita.

## La regla central: toda pestaña/sección ES una ruta

**Nunca** `useState('seccion')` + `onClick` para cambiar de pantalla
dentro de un shell. **Siempre** `<Routes>` anidadas (montadas en
`/algo/*` desde `App.jsx`) + `<NavLink>` para los ítems del menú.

Por qué: con `useState`, la sección activa no tiene URL propia — no se
puede compartir un enlace directo a ella, ni usar atrás/adelante del
navegador, ni recargar la página y quedar donde estabas. Con rutas
reales, todo eso funciona gratis porque lo resuelve react-router.

```jsx
// Patrón (AdminApp.jsx, ProveedorApp.jsx tras el arreglo, y los otros 6):
const NAV = [
  { to: '/mi-panel', end: true, label: 'Inicio' },
  { to: '/mi-panel/seccion', label: 'Sección' },
];

<nav>
  {NAV.map((n) => (
    <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'active' : '')}>
      {n.label}
    </NavLink>
  ))}
</nav>

<Routes>
  <Route index element={<Inicio />} />
  <Route path="seccion" element={<Seccion />} />
  <Route path="*" element={<Navigate to="/mi-panel" replace />} />
</Routes>
```

`end: true` en el ítem que apunta a la ruta índice (evita que quede
"activo" siempre, por ser prefijo de todas las demás). Una sola ruta
por pantalla — si dos NAV apuntan al mismo componente, la pestaña
"activa" queda ambigua entre las dos URLs; mejor uno de los dos
redirige al otro.

## Links internos: siempre `<Link>`/`<NavLink>`, nunca `<a href>`

Un `<a href="/ruta-interna">` recarga la página completa — rompe la SPA
y descarta el estado en memoria. Reservar `<a href>` para: enlaces
externos (`target="_blank"`), descargas de archivo, y `mailto:`.

## El resto de la forma del shell (según lo que ya existe)

- **Con más de ~4 secciones → sidebar** (`.admin-shell` + `.admin-side`,
  reusado tal cual por Admin/Terreno/Puerto/Mandante/Agencia/Trazador).
  Trae gratis el drawer responsive (hamburguesa + overlay a ≤900px) — no
  reinventar el breakpoint.
- **Con pocas secciones (≤4-5) → tabs horizontales o bottom-nav**, sin
  sidebar ni drawer (Proveedor, Sube y Suma). El `flex-wrap` ya resuelve
  el móvil sin necesitar un drawer para tan pocos ítems.
- **Color de acento por panel → una variable CSS, nunca hex repetido
  inline.** Patrón: `.theme-<panel> { --<panel>-accent: #...; }` en el
  contenedor raíz del shell, y todo lo que necesite ese color lo lee de
  la variable (ver `.theme-puerto`, `.theme-mandante`, etc. en
  `styles.css`, y `.theme-proveedor` desde este arreglo). Los colores
  por panel de los 4 externos (Puerto azul, Mandante violeta, Agencia
  ámbar, Trazador rojo) vienen a propósito de la paleta ya usada en
  gráficos (`components/Charts.jsx`) — no son arbitrarios, pero si se
  agrega un panel nuevo su color también debe salir de ahí, no
  inventarse.
- **Logout: un botón con texto ("Cerrar sesión"), no solo un ícono.**
  Ubicación: pie del sidebar en los shells con sidebar; header superior
  derecho en los shells de tabs. (Sube y Suma es la única excepción
  deliberada — ver más abajo.)
- **Identidad visible**: nombre + email del usuario logueado, siempre en
  algún lugar del shell. El rol es opcional (Admin lo muestra porque ahí
  sí hay varios roles con permisos distintos; los paneles externos son
  todos "operador" de su propia entidad, así que no aporta).

## Excepciones deliberadas (no las "arregles" sin volver a leer por qué)

- **El sitio público (`PublicLayout.jsx`) no tiene drawer ni estado
  activo en el header.** Es un header de marketing con 3 links, no un
  panel operativo — el criterio de "sidebar si hay muchas secciones" no
  aplica porque no hay secciones, hay páginas de marketing sueltas.
- **Sube y Suma (`JuegoApp.jsx`) es mobile-first sin variante de
  escritorio**: bottom-nav siempre fija, sin conversión a sidebar en
  pantallas grandes. Es una PWA de terreno (escanear, reciclar) — el
  95%+ de su uso real es un teléfono, así que no vale la pena construir
  una vista de escritorio que casi nadie usaría. El logout ahí es solo
  ícono (sin texto) porque el topbar es angosto y prioriza mostrar el
  puntaje — deliberado, no un descuido.
- **`TorreFlota.jsx` / el "Operador" de `Torre.jsx` no tienen logout
  explícito ni sesión persistida en `localStorage`.** No es un usuario
  con cuenta — es una credencial de TERMINAL (rol `pos`, la misma del
  mostrador) que se autentica por sesión de pestaña; cerrar la pestaña
  "cierra sesión". Antes de sumarle un botón de logout, confirmar que de
  verdad hace falta (recargar ya limpia el token en memoria).
- **`impacto` y `reciclar` de Sube y Suma no están en la bottom-nav.**
  Son pantallas de segundo nivel (se llega desde tarjetas en Perfil), no
  destinos primarios — meterlas ahí dejaría la bottom-nav en 7 ítems,
  demasiados para el pulgar en un teléfono. Al visitarlas ningún ítem
  del bottom-nav queda "activo": es el costo aceptado de esa decisión,
  no un bug a silenciar agregando una ruta falsa al array `NAV`.

## Si agregas un shell nuevo

1. Móntalo en `App.jsx` como `/tu-panel/*` con `lazy()`.
2. Sigue el patrón de arriba: `NAV` + `<NavLink>` + `<Routes>` anidadas.
3. Si tiene más de 4 secciones, reusa `.admin-shell`/`.admin-side` con tu
   propio `.theme-tu-panel` (no reinventes el sidebar).
4. Si tiene pocas, usa tabs (mira `.proveedor-tabs`/`.proveedor-tab` en
   `styles.css`) — no estilos 100% inline; al menos el header, las tabs y
   el estado activo van en clases CSS reales, para que el próximo panel
   pueda copiarlas en vez de reinventarlas.
5. Logout con texto, identidad visible, color de acento como variable
   CSS. Si te desvías de alguna de estas, dejar por qué en un comentario
   — la próxima persona (o el próximo agente) necesita saber si fue una
   decisión o un olvido.
