# Plan fundacional — Instituto sicr3p

> Línea propia de formación de sicr3p, construida sobre el módulo de
> capacitación que ya existe en la plataforma (migración 037, cursos con
> quiz, puntaje, constancia con serial y QR de verificación pública,
> sellada en la cadena de integridad).

## 1. Qué es (y qué no es)

**Es**: la marca bajo la cual sicr3p ofrece formación corta y operativa —
propia y para terceros — con una diferencia que nadie más tiene en el
nicho: **cada constancia es verificable públicamente por QR y está sellada
por hash**. El diploma de papel se puede falsificar; el serial en línea, no.

**No es** (y esto va escrito en todo el material):
- No es una institución de educación superior. En Chile "Instituto
  Profesional" es una figura regulada por la ley de educación; el nombre
  comercial definitivo debe validarse con abogado antes de usarse en
  público (alternativas seguras si el nombre "Instituto sicr3p" presenta
  riesgo: **Academia sicr3p** o **Escuela de Trazabilidad sicr3p**).
- No es una OTEC: los cursos no dan franquicia tributaria SENCE. Si algún
  día conviene, la vía es aliarse con una OTEC existente que dicte con
  nuestros contenidos y plataforma — no constituir una.
- Las constancias **no son certificaciones** ni acreditan competencias
  laborales reguladas. Dejan constancia verificable de que una persona
  completó un curso y aprobó su evaluación. Esa honestidad ya está impresa
  en el PDF de constancia y no se negocia.

## 2. Por qué tiene sentido ahora

1. **El activo ya existe**: módulo completo en producción (cursos, módulos,
   quiz con puntaje calculado en el servidor, constancia PDF con QR
   público `/constancia/:serial`, hash encadenado). Costo de desarrollo
   marginal: bajo.
2. **La demanda es cautiva primero**: cada cliente de sicr3p necesita que
   su gente sepa operar (REP en el mesón, tarjeta de viaje del chofer,
   captura documental de la agencia). La formación reduce el costo de
   soporte y acelera la adopción — se paga sola aunque nunca se venda
   por separado.
3. **El diferenciador es real**: constancia verificable + contenido
   anclado a una plataforma que el alumno usa de verdad. No es e-learning
   genérico: es el manual del sistema convertido en curso.

## 3. Oferta inicial (catálogo v1)

| Curso | Audiencia | Fuente del contenido (ya escrita) |
|---|---|---|
| **REP en simple (Ley 20.920)** | Operadores de mesón y pymes | Ficha 03 + capítulo REP del Libro de Servicios |
| **Operación del Corredor: tarjeta, pasos y torre** | Choferes y operadores logísticos | Capítulos 4 y 10 del Libro + docs TORRE/TARJETA |
| **Contabilidad de carbono con sicr3p** | Equipos de clientes y mandantes | Guía metodológica + capítulos 3, 5 y 6 del Libro |
| **Captura documental para agencias** | Agencias de aduana | Ficha 19 (propuesta aduanas) + manual de uso |

Regla de contenido: cursos de 30-60 minutos, evaluación corta, aprobación
exigente pero razonable, y siempre orientados a operar la plataforma real.

## 4. Modelo de negocio (fases, sin pasarela de pago aún)

- **Fase A — incluido**: los cursos operativos van incluidos en los planes
  de clientes/actores (hoy). Objetivo: adopción y menos soporte, no
  ingresos.
- **Fase B — por convenio**: un mandante o gremio paga por capacitar a su
  red (proveedores, choferes, agencias) con cursos a medida. Facturación
  manual — no depende de la pasarela de pago pendiente.
- **Fase C — abierto**: catálogo público con inscripción individual. Recién
  aquí se necesita cobro en línea; queda condicionada a que exista pasarela
  (VirtualPos u otra), que hoy NO está construida.

## 5. Qué hay que construir (técnico)

Lo mínimo para lanzar la marca, en orden:

1. **Página pública del Instituto** (`/instituto` en el frontend): qué es,
   catálogo de cursos, cómo verificar una constancia, y el disclaimer de
   honestidad. Reusa el sistema visual existente (misma decisión de diseño
   que `/corredor`).
2. **Branding mínimo**: nombre validado (ver riesgo legal del punto 1),
   sello/lockup "Instituto sicr3p" en la constancia PDF (hoy dice solo
   sicr3p) — un cambio acotado en `generateConstanciaCurso` (pdf.js).
3. **Inscripción por código** (si Fase B lo pide): hoy los cursos viven
   dentro de los paneles; para capacitar a la red de un mandante sin darles
   panel, haría falta un acceso por código/enlace al curso — desarrollo
   nuevo, chico, sobre el patrón de códigos ya existente.
4. **2 cursos nuevos** (Carbono y Agencias) cargados con el contenido ya
   escrito — trabajo editorial, no de código (el admin ya permite
   administrar cursos).

Explícitamente NO se construye ahora: cobro en línea, integración SENCE,
app móvil, videos (los cursos v1 son texto + evaluación, como los 2 que ya
existen sembrados).

## 6. Riesgos y cómo se mitigan

| Riesgo | Mitigación |
|---|---|
| Nombre "Instituto" con implicancia legal educacional | Validar con abogado antes del lanzamiento público; alternativas listas (Academia/Escuela) |
| Que se perciba como "vende diplomas" | La honestidad impresa (constancia ≠ certificación) + aprobación real con quiz servido por el backend |
| Distraer del negocio principal | Fase A no agrega trabajo comercial: es soporte convertido en producto |
| Sin pasarela de pago para Fase C | Fases A y B no la necesitan; C espera |

## 7. Criterio de éxito por fase

- **A**: cada actor nuevo (agencia, chofer, operador) completa su curso
  antes de operar → medible en el propio módulo.
- **B**: primer convenio pagado (un mandante capacitando a ≥10 personas de
  su red).
- **C**: solo se abre si A y B demuestran demanda; no antes.

---
*Plan fundacional v1 · Agosto 2026 · sicr3p SpA. Documento interno de
estrategia; los nombres y afirmaciones públicas quedan sujetos a la
validación legal del punto 1.*
