# regira · Modo CONCURSO 🏆

Convierte el juego (Ley REP) en **concursos por mérito**: competencias por ranking en un
período — entre **empresas**, **equipos** o **personas** — con premios por posición, página
pública con **ranking en vivo + countdown** (la que abre el **QR**), inscripción con un
clic y cierre con ganadores + notificación a toda la comunidad.

> **Staging:** esta carpeta vive temporalmente en el repo `hhhh` porque el acceso de la
> sesión a `Houmeecl/regira` quedó pendiente de aprobación. Son archivos NUEVOS para copiar
> al repo regira (no modifican nada existente, salvo 4 líneas de montaje).

## Qué reutiliza de regira (nada se duplica)
- El **conteo antifraude** existente: los envases (`containers`) registrados con validación
  QR/GPS son la métrica del ranking. Nadie suma sin pasar por el escáner.
- `companies`, `teams`, `users`, `notifications`, sesión y roles tal como están.
- Se agregan **solo 2 tablas**: `contests` y `contest_participants`.

## Instalación (4 pasos)

**1. Copiar archivos** (respetando rutas):
```
shared/concursos.ts            → regira/shared/concursos.ts
server/concursos.ts            → regira/server/concursos.ts
client/pages/Concurso.tsx      → regira/client/src/pages/Concurso.tsx
client/pages/AdminConcursos.tsx→ regira/client/src/pages/AdminConcursos.tsx
```

**2. Montar la API** — en `server/routes.ts`, dentro de `registerRoutes(app)`:
```ts
import { registerConcursoRoutes } from "./concursos";
// ...dentro de registerRoutes, junto a las demás rutas:
registerConcursoRoutes(app);
```

**3. Montar las páginas** — en `client/src/App.tsx`:
```tsx
import Concurso from "@/pages/Concurso";
import AdminConcursos from "@/pages/AdminConcursos";
// ...dentro de <Switch>:
<Route path="/concurso/:id" component={Concurso} />
<Route path="/admin/concursos">
  <ProtectedRoute adminOnly><AdminConcursos /></ProtectedRoute>
</Route>
```

**4. Crear las tablas**:
```bash
npm run db:push
```
(Opcional: `APP_URL=https://tudominio.cl` en el entorno para que el QR apunte al dominio público.)

## Flujo del concurso
1. **Admin** crea el concurso en `/admin/concursos`: título, quiénes compiten
   (empresas/equipos/personas), métrica (envases o puntos del período), fechas y premios
   1º/2º/3º. Nace en borrador → **Activar**.
2. **Descarga el QR** y úsalo en la actividad (afiche, lanzamiento, landing de sicr3p).
   El QR abre `/concurso/:id`.
3. Los participantes **se inscriben con un clic** (la inscripción usa su empresa/equipo/
   cuenta según el scope) y reciclan como siempre: cada envase validado suma al ranking.
4. La página pública muestra **ranking en vivo** (refresco cada 30 s) y **countdown**.
5. Al término, el admin pulsa **Cerrar y premiar**: se calcula el ranking final
   (desempate: quien se inscribió primero), se guardan los ganadores y se envía una
   **notificación** a toda la comunidad con el 1º lugar.

## API
| Método | Ruta | Acceso |
|---|---|---|
| GET | `/api/concursos` | público |
| GET | `/api/concursos/:id` | público (detalle + leaderboard) |
| GET | `/api/concursos/:id/qr` | público (PNG del QR) |
| POST | `/api/concursos/:id/inscribir` | sesión |
| GET/POST | `/api/admin/concursos` | admin |
| PATCH | `/api/admin/concursos/:id/activar` | admin |
| POST | `/api/admin/concursos/:id/cerrar` | admin |

## Nota de diseño
- El ranking suma **solo dentro del período** del concurso y **solo entre inscritos** —
  el histórico de puntos no da ventaja: todos parten de cero al inicio.
- `server/concursos.ts` es autocontenido (crea su propia conexión drizzle/neon y sus
  guards de sesión), así que no toca `storage.ts` ni `routes.ts` más allá del montaje.
- Idea de uso con sicr3p: el concurso es la **actividad de captura** para empresas; los
  documentos/envases registrados generan los datos del piloto.
