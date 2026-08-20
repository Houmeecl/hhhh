# Pendientes de sicr3p

Estado al **20-08-2026**. Cada punto trae dónde mirarlo y cómo se comprueba,
para que no haya que creerle a este archivo: se verifica.

Orden por gravedad, no por esfuerzo. Arriba está lo que puede hacer daño
callado; abajo, lo que falta pero se nota solo.

**Regla para editar este archivo:** un pendiente se borra cuando el código
lo cierra, no cuando se decide que no importa. Si se decide que no importa,
se mueve a *Decidido que no* con la razón y la fecha.

---

## 1 · Verdes falsos

Lo que el sistema afirma sin poder demostrarlo, o lo que omite sin decirlo.
Es la categoría más grave porque no se ve: nadie reclama por un dato que no
sabe que falta.

### 1.1 — Doce normas citadas, ninguna contrastada

| | |
|---|---|
| **Dónde** | `docs/official/manifest.json`, `backend/src/services/fuentesOficiales.js` |
| **Comprobar** | `cd backend && npm run fuentes` |
| **Estado** | 12 fuentes, **12 pendientes**, 0 rotas |

El pasaporte de carga cita el EUDR, el CBAM, la Resolución DNA 494/2017 y
la regulación brasileña. Ninguna se ha contrastado contra el texto oficial:
el proxy de egreso responde 403 al CONNECT hacia `eur-lex.europa.eu`,
`dnit.gov.py`, `gov.br` y `bcn.cl`.

Esto **no es un error del sistema** — está declarado, el PDF imprime cuántas
fuentes tiene verificadas y cuántas no, y declararse verificado sin prueba
rompe la compilación. Pero sigue siendo una deuda real, y el manifiesto ya
tiene las URL directas.

**Cerrar así**, desde una red sin el bloqueo:

```bash
# bajar el PDF a docs/official/<PAIS>/
cd backend && npm run fuentes -- --sellar UE-2023-1115 32023R1115.pdf
# commitear el PDF y el manifiesto en el MISMO commit
```

### 1.2 — El artículo 9 del EUDR está 6 de 8

| | |
|---|---|
| **Dónde** | `backend/src/services/exportacion.js` |
| **Bloqueado por** | 1.1 — no se puede confirmar sin el texto oficial |

Una revisión normativa indicó que de los ocho requisitos de información del
artículo 9 se comprueban seis. Si es cierto, una carga puede salir en verde
cumpliendo seis de ocho, que es exactamente un verde falso.

**Sin verificar.** Salió de fuentes secundarias. No se actúa hasta sellar
`UE-2023-1115`; corregirlo sobre una fuente secundaria sería repetir el
error que 1.1 existe para no repetir.

### 1.3 — El NC 1507 podría faltar del listado EUDR

Mismo origen y misma condición que 1.2. El aceite de soja podría estar en el
Anexo I sin estar en el listado que sicr3p mantiene. Si falta, esa carga se
clasifica como exportación simple cuando debería ser EUDR.

---

## 2 · Lo que promete y no hace

Funcionalidad a medio construir: la tabla existe, la pantalla existe, y en
el medio no hay nada.

### 2.1 — `carga_documentos.estado` nunca sale de `pendiente_revision`

| | |
|---|---|
| **Comprobar** | `grep -rn "carga_documentos SET estado" backend/src/` → sin resultados |
| **Impacto** | Alto: el exportador queda esperando una revisión que nadie hace |

El documento se carga, queda en `pendiente_revision` y ahí se queda para
siempre. No hay endpoint, ni pantalla, ni rol que lo mueva a aprobado o
rechazado.

**Cerrar así:** decidir primero quién revisa —¿el admin del Corredor?
¿nadie, y el estado sobra?— y después construirlo. Si la respuesta es que
nadie revisa, lo correcto es **quitar la columna**, no dejarla mintiendo.

### 2.2 — No hay recuperación de contraseña en el Corredor

| | |
|---|---|
| **Comprobar** | `grep -rn "INSERT INTO tokens_password_corredor" backend/src/` → sin resultados |
| **Impacto** | Alto en operación: si un exportador pierde su clave, no hay camino de vuelta |

La tabla existe, tiene su índice, se inventaría y **desde hoy se purga**.
Nadie inserta: la única mención en las rutas es un comentario en
`corredorApi.js:302` que dice justamente que todavía no se usa. La única
forma de entrar es la clave temporal que crea un admin a mano.

**Depende de 2.3**: un enlace de un solo uso no sirve sin correo que lo
lleve.

### 2.3 — El Corredor no manda correos

| | |
|---|---|
| **Comprobar** | `grep -rn "mailer\|enviarCorreo" backend/src/routes/corredorApi.js` → sin resultados |

El resto de la plataforma tiene `mailer` y bitácora de envíos. El Corredor
no. Sin esto no hay activación de cuenta, ni recuperación de clave, ni aviso
de que un documento llegó.

---

## 3 · Alcance declarado y no cubierto

### 3.1 — El panel del Corredor está solo en español

| | |
|---|---|
| **Comprobar** | `grep -rn "useIdioma" frontend/src/panel-corredor/` → sin resultados |
| **Pide** | es-CL, es-AR, es-PY y pt-BR como mínimo |

Los textos están en duro (`Nueva carga`, `Código arancelario`, `Región de
origen`). La landing pública sí tiene tres idiomas; el panel, ninguno.

El corredor cruza Brasil y Paraguay: un transportista brasileño usando un
panel en español de Chile es un problema de operación, no de estética.

**Ojo al hacerlo:** los textos jurídicos no se autotraducen. Un régimen
aduanero mal traducido es peor que uno sin traducir.

---

## 4 · Acciones en el VPS

No son código: son cosas que hay que ir a hacer al servidor.

- [ ] **El checkout está en la rama vieja.** Mientras siga así, el cron
      reporta "sin cambios" en silencio y nada de lo empujado llega.

      ```bash
      cd /opt/sicr3p && git fetch origin main && git checkout main && bash deploy/actualizar.sh
      ```

- [ ] **Encender el Corredor** y crear el primer admin real:

      ```bash
      bash deploy/encender-corredor.sh --admin <correo real>
      ```

- [ ] **Borrar la cuenta `tu-correo@dominio.cl`.** Su clave temporal se pegó
      en un chat, así que está quemada. Hacerlo después de crear el admin
      real, no antes.

---

## 5 · Salud del entorno

**PostgreSQL se cayó tres veces** durante la jornada del 20-08. El síntoma
engaña: aparecen doce fallas en `adminCuentas` que parecen una regresión y
no lo son. Antes de creerle a una corrida roja:

```bash
pg_isready || service postgresql start
```

Vale también para el VPS: `deploy/actualizar.sh` corre `npm test` con
`NODE_ENV=production` contra la base real antes de reiniciar, así que una
base caída se lee como código roto.

---

## Cerrado hoy

Queda anotado porque explica por qué varios de los pendientes de arriba
están escritos como están.

| Qué | Commit |
|---|---|
| Registro de fuentes oficiales con sha256; declararse verificado sin prueba rompe el build | `fbb703c` |
| URL reales de la DNIT + seis normas más en el manifiesto | `2ef5861` |
| `cripto.test.js` probaba solo el modo desarrollo y caía en el gate del VPS | `5b25a41` |
| Serial de la Tarjeta de Viaje: de 2^16 a 2^64, y el destino sale del endpoint público | `29d7932` |
| El derecho de acceso ARCOP omitía la base del Corredor **en silencio** | `4ec3406` |
| La purga no alcanzaba las tablas del Corredor que el inventario prometía purgar | `e615c2f` |
| Título del navegador y vista previa al compartir | `9595c3a` |

Los dos del medio comparten causa: el inventario no sabía decir en qué base
vivía cada tabla, y `puntos_corredor` existe de verdad en las dos. Un objeto
literal no admite la misma llave dos veces, así que una de las dos
clasificaciones era código muerto y nadie se enteró — el test tenía la misma
ceguera.

---

## Decidido que no

- **Rastrear vehículos.** La carga cruza cuatro países; seguir camiones en
  vivo es un riesgo de seguridad. Se registra el hito en el punto de
  control, no la posición del móvil. `carga_pasos` no tiene `lat` ni `lng`
  y hay un test que lo impide.
  La ubicación por dispositivo queda para el tag de la etapa dos.

- **Migrar a Next.js.** Evaluado el 20-08: 24 semanas y 780–920 persona-día
  para un panel privado detrás de un login. No se justifica.

- **Emitir nivel de confianza 5.** Necesita un rol de auditor que no existe.
  El código no lo emite nunca, por diseño.
