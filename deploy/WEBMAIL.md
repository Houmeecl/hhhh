# Correo para sicr3p.cl — la decisión y las rutas

> **CAMINO ACTIVO (decisión de julio 2026): 5 casillas compradas directo en
> Ferozo/DonWeb — sección 9.** Ferozo es la misma empresa que aloja el
> dominio y el VPS, así que su panel trae wizards de un clic para MX, SPF y
> DKIM (nada de armar registros a mano ni de depender de un ticket de rDNS).
> Zoho Mail (sección 7) y Poste.io autoalojado (secciones 1-5, 8) quedan
> documentados como alternativas descartadas por ahora — no se está usando
> ninguna de las dos, no se pierden si algún día conviene volver a mirarlas.
>
> **El correo vive en un dominio distinto al sitio: `sicrep.cl`, no
> `sicr3p.cl`.** El panel de casillas de Ferozo/DonWeb no acepta dominios
> con dígitos en el nombre — por eso las 5 casillas se crearon sobre
> `sicrep.cl` (mismo nombre, sin el "3"), que la empresa ya tenía
> registrado. El sitio, la marca y todas las URLs siguen siendo
> `sicr3p.cl`; solo cambia el dominio de las direcciones de correo.
>
> Comprobación en un comando, sirva el camino que sirva:
> `bash deploy/verificar-correo.sh sicrep.cl` (solo lectura: reporta ✓/✗ de
> MX, SPF único, DKIM Zoho/Resend y DMARC — con correo nativo de Ferozo el
> selector DKIM real puede no ser el de Zoho; el script lo indica sin marcar
> falso error).

Guía completa de las tres rutas: **Ferozo/DonWeb nativo** (sección 9, activo
hoy), **Poste.io autoalojado** (secciones 1-5, 8) y **Zoho hosted**
(sección 7). El transaccional de la plataforma (Resend) va en la sección 6.

---

## 1. Advertencia franca: ¿autoalojado o hosted?

Correo autoalojado significa:

- **Mantención permanente**: actualizar el contenedor, vigilar la cola de envío,
  revisar logs cuando algo rebota.
- **Reputación de IP**: si la IP 138.36.237.61 estuvo alguna vez en listas negras
  (común en rangos de VPS), Gmail/Outlook pueden mandar tus correos a spam por
  meses aunque hagas todo bien. Revisa la IP en <https://mxtoolbox.com/blacklists.aspx>
  antes de decidir.
- **Dos requisitos NO negociables que dependen de DonWeb**:
  1. **Puerto 25 saliente abierto** (el script lo verifica y aborta si está bloqueado).
  2. **rDNS/PTR** de la IP apuntando a `mail.sicr3p.cl` (solo DonWeb puede configurarlo).

Si DonWeb no abre el puerto 25 o no configura el rDNS, **no insistas**: usa la
alternativa hosted de la sección 7. Recibirás y enviarás con tu dominio igual,
sin mantener nada.

---

## 2. Instalación en el VPS

Con el repo actualizado en `/opt/sicr3p`:

```bash
cd /opt/sicr3p && git pull
bash deploy/instalar-webmail.sh          # instala mail.sicr3p.cl
```

El script es idempotente y:

1. Verifica puerto 25 saliente (aborta si está bloqueado), Docker (lo instala
   del repo oficial si falta) y RAM (~2 GB recomendados; avisa si hay menos).
2. Levanta el contenedor `posteio` con los datos persistentes en
   `/opt/posteio-data` (buzones, DKIM y config sobreviven a recreaciones).
3. Configura nginx para `mail.sicr3p.cl` → interfaz web del contenedor
   (que escucha solo en `127.0.0.1:8090`).
4. Pide el certificado HTTPS con certbot **solo si el DNS ya apunta al VPS**
   (si no, avisa y te deja el comando para después).
5. Abre 25/465/587/993 en ufw sin cortar el SSH activo (puerto 5595).

Si creas el DNS **antes** de correr el script, el HTTPS queda listo de una.

---

## 3. Registros DNS exactos (panel del dominio sicr3p.cl) — camino descartado (Poste.io)

> Esta sección quedó de cuando el plan era autoalojar Poste.io en el VPS
> — **descartado, ver sección 9 (Ferozo/DonWeb nativo, camino activo)**.
> Se deja solo de referencia histórica; no seguir estos pasos.
>
> **Corrección importante (confirmada por el artículo oficial de soporte
> "¿Cómo configurar el registro SPF desde Ferozo?"):** el SPF
> `v=spf1 include:spf.hostmar.com -all` que decía "es un problema" abajo
> **en realidad es el valor correcto y recomendado por el propio DonWeb**
> para su correo nativo (Hostmar es la infraestructura de envío de
> Ferozo/DonWeb) — no había que reemplazarlo. El error de diagnóstico fue
> asumir que el correo se enviaría desde el VPS (por eso pedía agregar
> `mx` al SPF); con casillas nativas de Ferozo el envío es desde Hostmar,
> no desde el VPS, así que el SPF de abajo nunca debió tocarse.

| Tipo | Nombre / Host          | Valor                                                        | Estado 19-07-2026 |
|------|------------------------|--------------------------------------------------------------|-------------------|
| A    | `mail`                 | `138.36.237.61`                                              | ✅ ya creado |
| MX   | `@` (sicr3p.cl)        | `mail.sicr3p.cl` (prioridad 10)                              | ✅ ya creado |
| TXT  | `@` (sicr3p.cl)        | `v=spf1 include:spf.hostmar.com -all` — **correcto tal cual, no tocar** | ✅ correcto |
| TXT  | `_dmarc`               | `v=DMARC1; p=quarantine; rua=mailto:postmaster@sicr3p.cl`    | ❌ crear |
| TXT  | `<selector>._domainkey`| *(DKIM: se genera después de instalar — ver sección 4)*      | ❌ después de instalar |

### El paso CRÍTICO: rDNS/PTR

Abre un ticket a soporte DonWeb pidiendo textualmente:

> Configurar el DNS inverso (rDNS/PTR) de la IP **138.36.237.61** hacia
> **mail.sicr3p.cl**, y confirmar que el puerto 25 saliente está habilitado
> para esa IP.

Sin PTR, Gmail y Outlook rechazan o marcan como spam casi todo. Verifica con:

```bash
dig -x 138.36.237.61 +short    # debe responder: mail.sicr3p.cl.
```

---

## 4. Primer arranque: asistente, DKIM y buzones — camino descartado (Poste.io)

> Igual que la sección 3: esto quedó del plan de autoalojar Poste.io,
> **descartado** (ver sección 9). Se conserva de referencia; no seguir estos
> pasos. Si algún día se retomara, los buzones van en `sicrep.cl` —el
> dominio de correo— y no en `sicr3p.cl`, que es solo el sitio.

### 4.1 Asistente inicial

Entra a **https://mail.sicr3p.cl/admin/install** (si el HTTPS aún no está,
usa un túnel SSH: `ssh -p 5595 -L 8090:127.0.0.1:8090 root@138.36.237.61` y
abre `http://localhost:8090/admin/install`).

- Hostname: `mail.sicr3p.cl` (ya viene del contenedor).
- Cuenta admin: usa `admin@sicr3p.cl` con una clave larga generada
  (guárdala en `/root/sicr3p-credenciales.txt` a mano si quieres centralizar).

### 4.2 Generar DKIM

1. En el admin: **Virtual domains → sicr3p.cl → DKIM key → Generate new key**.
2. Poste.io muestra el nombre del registro (algo como `s20260715._domainkey`)
   y el valor `v=DKIM1; k=rsa; p=MIIB…`.
3. Crea ese TXT en el panel DNS del dominio, tal cual (si el panel limita el
   largo, algunos permiten partir el valor en dos strings entre comillas).
4. Verifica: `dig TXT <selector>._domainkey.sicr3p.cl +short`.

### 4.3 Crear buzones

En el admin: **Virtual domains → sicr3p.cl → Email accounts → Create new**.
Crea al menos:

- `contacto@sicrep.cl` — el buzón "humano" principal.
- `postmaster@sicrep.cl` — recibe los reportes DMARC y avisos de otros
  servidores (puede ser un alias hacia `contacto@` si prefieres:
  **Redirections → Create new**).

### 4.4 Entrar al webmail

- **Webmail (Roundcube)**: <https://mail.sicr3p.cl> → botón *Webmail*
  (o directo <https://mail.sicr3p.cl/webmail/>). Usuario = la dirección
  completa (`contacto@sicrep.cl`), clave = la del buzón.
- **Cliente de escritorio/celular** (opcional):
  - IMAP: `mail.sicr3p.cl`, puerto 993, SSL/TLS.
  - SMTP: `mail.sicr3p.cl`, puerto 465 (SSL) o 587 (STARTTLS).

---

## 5. Prueba final de entregabilidad

1. Entra a <https://www.mail-tester.com> y copia la dirección que te da.
2. Desde el webmail (`contacto@sicrep.cl`) envíale un correo con asunto y
   cuerpo reales (no "test": los filtros castigan mensajes vacíos).
3. Aprieta *Check your score*. **Objetivo: ≥ 9/10.**

Si baja de 9, el detalle del reporte dice exactamente qué falta; en orden de
probabilidad: PTR ausente (sección 3), DKIM mal copiado (sección 4.2), SPF
duplicado o IP en lista negra. Corrige y repite (mail-tester da varias
pruebas gratis al día).

También sirve mandarse un correo a una cuenta Gmail propia y mirar
"Mostrar original": debe decir `SPF: PASS`, `DKIM: PASS`, `DMARC: PASS`.

---

## 6. Relación con el backend de sicr3p (Resend NO cambia)

**Esto no toca el envío transaccional de la app.** El backend sigue enviando
las notificaciones/recuperaciones por **Resend** (`RESEND_API_KEY` y
`MAIL_FROM` en `backend/.env` quedan igual; no hay que reiniciar pm2 ni
tocar nada).

Poste.io es para el correo **humano**: recibir y leer lo que llegue a
`contacto@sicrep.cl`, responder desde el webmail, etc. Son dos canales
separados a propósito:

- **Resend** → envíos automáticos de la app (mejor entregabilidad, cero riesgo
  de que un problema del servidor propio bote los correos de la plataforma).
- **Poste.io** → casilla de la organización, con webmail.

Si algún día quisieras que el backend envíe por SMTP propio en vez de Resend,
sería un cambio de código en el mailer (no está soportado hoy) — no lo hagas
al pasar; evalúalo aparte.

### 6.1 Activar Resend (hoy la app está en modo consola)

Mientras `RESEND_API_KEY` esté vacía en `backend/.env`, el mailer solo
registra los correos en el log (modo desarrollo honesto). Para activar los
envíos reales de la plataforma (informe por correo, magic links, comprobantes
del POS):

1. Cuenta gratuita en <https://resend.com> (3.000 correos/mes gratis).
2. Panel Resend → *Domains* → agregar `sicrep.cl` (el dominio de correo,
   no `sicr3p.cl`) → Resend te da 2-3 registros (un TXT `resend._domainkey`
   con su DKIM y un registro para rebotes en un subdominio) → pegarlos en
   el panel DNS de DonWeb, en la zona de `sicrep.cl`.
   **No tocan el SPF del dominio raíz** (ese es el de Hostmar, sección 9.3):
   conviven sin conflicto.
3. Panel Resend → *API Keys* → crear clave → en el VPS:
   ```bash
   nano /opt/sicr3p/backend/.env    # RESEND_API_KEY=re_...  y  MAIL_FROM="sicr3p <no-responder@sicrep.cl>"
   pm2 restart sicr3p-backend
   ```
4. Probar: procesar un documento y usar "Enviar informe por correo".
5. `bash deploy/verificar-correo.sh sicrep.cl` debe mostrar el DKIM de
   Resend en ✓.

---

## 7. CAMINO RECOMENDADO: correo hosted (Zoho Mail, plan gratuito)

Si DonWeb bloquea el puerto 25, no configura el rDNS, la IP está en listas
negras, o simplemente no quieres mantener un servidor de correo: **Zoho Mail
Forever Free** da hasta 5 buzones de 5 GB con dominio propio y webmail, sin
servidor que administrar. (Alternativas pagadas equivalentes: Google Workspace,
Microsoft 365, Fastmail.)

### 7.1 Alta

1. Crea la cuenta en <https://www.zoho.com/mail/> → *Forever Free Plan*
   (está algo escondido, abajo en la página de precios; requiere verificación
   por dominio, no por tarjeta).
2. Agrega el dominio **`sicrep.cl`** —el de correo, no `sicr3p.cl`, que es
   el del sitio— y verifica la propiedad con el TXT que Zoho te indique
   (algo como `zoho-verification=zb…`).
3. Crea los buzones `contacto@sicrep.cl` y `postmaster@sicrep.cl`.

### 7.2 DNS equivalente para Zoho

| Tipo | Nombre / Host           | Valor                                                      | Prioridad |
|------|-------------------------|------------------------------------------------------------|-----------|
| TXT  | `@`                     | *(el TXT de verificación que te dé Zoho)*                  | —         |
| MX   | `@` (sicrep.cl)         | `mx.zoho.com`                                              | 10        |
| MX   | `@` (sicrep.cl)         | `mx2.zoho.com`                                             | 20        |
| MX   | `@` (sicrep.cl)         | `mx3.zoho.com`                                             | 50        |
| TXT  | `@` (sicrep.cl)         | `v=spf1 include:zohomail.com ~all`                         | —         |
| TXT  | `zmail._domainkey`      | *(DKIM: se genera en el panel de Zoho → copiar tal cual)*  | —         |
| TXT  | `_dmarc`                | `v=DMARC1; p=quarantine; rua=mailto:postmaster@sicrep.cl`  | —         |

> Toda esta zona es la de `sicrep.cl`. Con Zoho **no** se crean el registro
> A de `mail.sicrep.cl` ni los MX hacia
> el VPS, y **no se corre** `instalar-webmail.sh`. El rDNS tampoco importa:
> los servidores que envían son de Zoho, con reputación propia.
>
> SPF: igual que arriba, UN solo TXT SPF en `@`. Si conviven Resend (que usa
> su propio subdominio) no hay conflicto; si alguna vez necesitas ambos en el
> mismo host, se fusionan los `include:` en un registro.

### 7.3 Uso

- Webmail: <https://mail.zoho.com>.
- IMAP/SMTP para clientes: `imap.zoho.com:993` / `smtp.zoho.com:465`
  (hay que habilitar IMAP en la config del buzón; en el plan gratis el
  acceso IMAP puede estar restringido — el webmail y la app móvil de Zoho
  siempre funcionan).
- Prueba final: igual que la sección 5 (mail-tester ≥ 9 sale casi solo,
  porque la reputación de IP es de Zoho).

---

## 8. Operación diaria (solo autoalojado)

```bash
docker ps --filter name=posteio          # ¿está arriba?
docker logs posteio --tail 50            # logs de correo
docker pull analogic/poste.io \
  && docker rm -f posteio \
  && bash /opt/sicr3p/deploy/instalar-webmail.sh   # actualizar versión
```

Los datos viven en `/opt/posteio-data`; inclúyelo en los respaldos:

```bash
tar czf /root/backups/posteio-$(date +%F).tar.gz -C /opt posteio-data
```

(Se puede agregar al cron junto al respaldo de la BD que instala
`deploy/instalar-vps.sh`.)

---

## 9. CAMINO ACTIVO: Ferozo/DonWeb nativo, sobre `sicrep.cl` (5 casillas ya compradas)

Ferozo es la misma empresa que aloja el dominio `sicr3p.cl` y el VPS — como
administra la zona DNS y el correo a la vez, su panel trae wizards de un
clic para MX, SPF y DKIM. No hay que armar registros a mano ni adivinar
valores; el panel los genera. (Fuentes: soporte.donweb.com — artículos
"Crear una cuenta de correo desde Ferozo", "Usar Webmail", "Cómo restaurar
los MX por defecto en DonWeb", "Cómo configurar el registro SPF/DKIM desde
Ferozo".)

**El correo vive en `sicrep.cl`, no en `sicr3p.cl`.** El panel de alta de
casillas de Ferozo rechaza dominios con dígitos en el nombre — el "3" de
`sicr3p.cl` lo bloquea. La empresa ya tenía registrado `sicrep.cl` (mismo
nombre sin el dígito) y las 5 casillas se crearon ahí. El sitio y toda la
marca siguen siendo `sicr3p.cl`; **solo** las direcciones de correo usan
`sicrep.cl` (`contacto@sicrep.cl`, etc.).

### 9.1 Crear las casillas
Panel Ferozo → ícono **Email** → **Cuentas** → **Crear nueva**, una por
cada buzón (mínimo `contacto@sicrep.cl` y `postmaster@sicrep.cl`; el plan
comprado trae 5). Clave: mínimo 8 caracteres, mayúscula + minúscula +
números no consecutivos + uno de `@ * /`. **Ya hecho** — `contacto@sicrep.cl`
verificado funcionando con el "Diagnosticador de correos" del panel DonWeb.

### 9.2 Apuntar el DNS al correo de Ferozo
Panel Ferozo → **Dominios** → **Zonas de DNS** → elegir `sicrep.cl` (no
`sicr3p.cl`) → **Configurar MX** → **Restaurar MX por defecto** → Aceptar.
Esto crea/corrige automáticamente el **A** de `mail.sicrep.cl` y el **MX**
de `sicrep.cl` apuntando al servidor de correo de Ferozo.

(El A/MX viejo de `mail.sicr3p.cl` → IP del VPS, del plan de Poste.io
descartado, queda vestigial — no hace daño dejarlo, pero se puede limpiar
cuando se quiera: nadie escribe a `@sicr3p.cl` para correo.)

> **Al 01-09-2026 hay algo instalado en el VPS bajo ese nombre**, fuera de
> los caminos de este documento y sin quedar registrado en el repo. Este
> archivo describe lo que se DECIDIÓ, no necesariamente lo que hay
> corriendo: no se puede leer como inventario del servidor. Para saber qué
> hay y por qué no abre, en el VPS:
>
> ```bash
> bash deploy/diagnosticar-webmail.sh mail.sicr3p.cl
> ```
>
> Separa las cuatro causas que desde el navegador se ven idénticas: nadie
> escuchando, falta de vhost, choque de puertos con nginx, o certificado
> ausente para ese nombre.

### 9.3 SPF, DKIM y DMARC — ya configurados, verificado en vivo

`sicrep.cl` está en el producto "Correo profesional" de DonWeb (panel
propio, con su zona DNS aparte), que auto-generó los tres registros al
crear las casillas — no hizo falta ningún wizard manual de esta sección.
Confirmado con `bash deploy/verificar-correo.sh sicrep.cl` (`dig` real,
no solo pantallazos):

- **SPF**: `v=spf1 include:comp.hostmar.com -all` — nota el subdominio
  `comp.hostmar.com` (no `spf.hostmar.com`, el genérico del artículo de
  soporte de Ferozo para hosting compartido; "Correo profesional" usa el
  suyo propio). **No tocar** — si el panel muestra un modal de edición
  para este registro, **Cancelar**, no Guardar.
- **DKIM**: `mail._domainkey.sicrep.cl` presente (verificar con
  `dig TXT mail._domainkey.sicrep.cl +short`).
- **DMARC**: `v=DMARC1; p=none` — política de solo-monitoreo (no rechaza
  ni pone en cuarentena, solo reporta). Punto de partida razonable; subir
  a `p=quarantine` más adelante si se quiere hacer cumplir, no es
  obligatorio ahora.

### 9.4 Webmail
<https://ferozo.email/> — usuario = la casilla completa
(`contacto@sicrep.cl`), clave = la del paso 9.1.

### 9.5 Verificar

**Ya verificado** (`bash deploy/verificar-correo.sh sicrep.cl`, `dig` real):
MX, SPF, DKIM y DMARC en ✓. Comando para volver a confirmar cuando se
quiera (por ejemplo tras cualquier cambio en el panel):
```bash
bash deploy/verificar-correo.sh sicrep.cl
```
Equivalente manual:
```bash
dig MX sicrep.cl +short
dig TXT sicrep.cl +short                      # un solo v=spf1 (comp.hostmar.com, no tocar)
dig TXT mail._domainkey.sicrep.cl +short      # DKIM nativo DonWeb
dig TXT _dmarc.sicrep.cl +short
```
Falta solo la prueba de entregabilidad real: mail-tester.com ≥ 9/10 con un
correo enviado desde `contacto@sicrep.cl` (sección 5, mismo procedimiento).

Resend (sección 6) no se toca en ningún paso de esta sección.
