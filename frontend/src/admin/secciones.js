import { Icon } from '../components/icons.jsx';

// ============================================================
// Metadata de las 26 secciones del panel admin — la única fuente para el
// NAV de AdminApp.jsx y para los checkboxes de Usuarios.jsx. El slug es
// el vocabulario de usuarios.secciones_admin (migración 092; espejo
// backend en src/constants/seccionesAdmin.js — mantener los tres
// sincronizados).
//
// `siempre: true` = la sección no se puede quitar (toda cuenta necesita
// un landing tras el login; su ruta backend tampoco se gatea).
// ============================================================

export const SECCIONES_ADMIN_NAV = [
  {
    titulo: 'Operación y seguimiento',
    items: [
      { slug: 'dashboard', to: '/admin', end: true, ico: Icon.Chart, label: 'Dashboard', siempre: true },
      { slug: 'clientes', to: '/admin/clientes', ico: Icon.Building, label: 'Clientes y contratos' },
      { slug: 'enrolar', to: '/admin/enrolar', ico: Icon.Users, label: 'Enrolar cliente' },
      { slug: 'sesiones', to: '/admin/sesiones', ico: Icon.Doc, label: 'Sesiones e informes' },
      { slug: 'buscar', to: '/admin/buscar', ico: Icon.Search, label: 'Búsqueda' },
      { slug: 'prospectos', to: '/admin/prospectos', ico: Icon.Target, label: 'Prospectos' },
      { slug: 'cobros', to: '/admin/cobros', ico: Icon.Tag, label: 'Cobros y campañas' },
      { slug: 'metricas', to: '/admin/metricas', ico: Icon.Chart, label: 'Métricas' },
    ],
  },
  {
    titulo: 'Procesos de negocio',
    items: [
      // 'tambien': hoy la pantalla de SII es 100% sobre empresas
      // proveedoras (conexión SII, generar, contrato) — una cuenta con
      // solo la sección 'proveedores' también debe poder llegar acá.
      { slug: 'sii', tambien: ['proveedores'], to: '/admin/sii', ico: Icon.Doc, label: 'SII compras/ventas' },
      { slug: 'capital_natural', to: '/admin/capital', ico: Icon.Leaf, label: 'Capital Natural' },
      { slug: 'trazabilidad', to: '/admin/trazabilidad', ico: Icon.Doc, label: 'Trazabilidad' },
      { slug: 'transporte', to: '/admin/transporte', ico: Icon.ArrowRight, label: 'Transporte Cat. 7' },
      { slug: 'corredor', to: '/admin/corredor', ico: Icon.Target, label: 'Corredor Bioceánico' },
      { slug: 'origen', to: '/admin/origen', ico: Icon.Qr, label: 'Pasaporte de Origen' },
      { slug: 'capacitacion', to: '/admin/capacitacion', ico: Icon.Book, label: 'Capacitación' },
      { slug: 'apl', to: '/admin/apl', ico: Icon.CheckCircle, label: 'APL' },
      { slug: 'activos', to: '/admin/activos', ico: Icon.Qr, label: 'Activos y adhesivos' },
    ],
  },
  {
    titulo: 'Acceso y comercial',
    items: [
      { slug: 'auspiciadores', to: '/admin/auspiciadores', ico: Icon.Users, label: 'Auspiciadores' },
      { slug: 'juego', to: '/admin/juego', ico: Icon.Sparkles, label: 'Sube y Suma' },
      { slug: 'accesos_externos', to: '/admin/accesos', ico: Icon.Qr, label: 'Accesos externos' },
      // Alias más angosto de 'accesos_externos': solo la pestaña
      // Proveedores de esa pantalla (ver Accesos.jsx), sin mandantes/
      // puertos/agencias/trazadores. No otorga nada que
      // 'accesos_externos' no otorgara ya — ver migración 097.
      //
      // `redundanteCon`: apunta a la MISMA ruta que 'accesos_externos', así
      // que una cuenta con los dos slugs veía la pantalla dos veces en el
      // menú, con el mismo destino y dos nombres distintos. Cuando está el
      // slug amplio, el angosto no agrega nada y no se lista.
      { slug: 'proveedores', to: '/admin/accesos', ico: Icon.Building, label: 'Proveedores', redundanteCon: 'accesos_externos' },
    ],
  },
  {
    titulo: 'Sistema',
    items: [
      { slug: 'motor_propio', to: '/admin/motor-propio', ico: Icon.Cog, label: 'Motor propio' },
      { slug: 'motor_externo', to: '/admin/motor', ico: Icon.Plug, label: 'Motor externo' },
      { slug: 'usuarios', to: '/admin/usuarios', ico: Icon.Users, label: 'Usuarios y roles' },
      { slug: 'actividad', to: '/admin/actividad', ico: Icon.List, label: 'Log de actividad' },
      { slug: 'datos_personales', to: '/admin/datos', ico: Icon.Shield, label: 'Datos personales' },
    ],
  },
];

// ¿Esta cuenta puede ver la sección? Superadmin ve todo; 'dashboard'
// (siempre:true) lo ve cualquiera; `item.tambien` deja que una sección
// más angosta (ej. 'proveedores') también desbloquee una más amplia que
// hoy cubre exactamente lo mismo (ej. 'sii') sin que a esta última haya
// que quitarle su propio slug de nadie que ya lo tenga.
export function puedeVerSeccion(user, slug) {
  const item = SECCIONES_ADMIN_NAV.flatMap((s) => s.items).find((i) => i.slug === slug);
  if (item?.siempre) return true;
  if (user?.es_superadmin) return true;
  const propias = user?.secciones_admin || [];
  return propias.includes(slug) || (item?.tambien || []).some((s) => propias.includes(s));
}

// OR de varias secciones — mismo idiom que requireSeccion(...slugs) del
// backend (middleware/auth.js), como primitiva única en vez de que cada
// pantalla reimplemente su propio Array.isArray/.some ad hoc.
export function puedeVerAlguna(user, ...slugs) {
  return slugs.some((s) => puedeVerSeccion(user, s));
}

// Los ítems de un grupo que esta cuenta debe VER en el menú.
//
// No es lo mismo que "puede entrar": dos slugs pueden llevar a la misma
// pantalla (ver `redundanteCon`). Ahí el permiso sigue siendo de los dos
// —quitarle uno no le quita el acceso— pero el menú muestra una sola
// entrada, la más amplia.
export function itemsVisiblesDe(seccion, user) {
  const visibles = (seccion?.items || []).filter((i) => puedeVerSeccion(user, i.slug));
  return visibles.filter((i) => !(i.redundanteCon && visibles.some((o) => o.slug === i.redundanteCon)));
}
