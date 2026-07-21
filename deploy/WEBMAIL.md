# Correo para sicr3p.cl — la decisión y las dos rutas

> **CAMINO RECOMENDADO (decisión de julio 2026): Zoho Mail hosted — sección 7.**
> Para una operación unipersonal, correo autoalojado es la infraestructura más
> ingrata de mantener: depende del ticket rDNS de DonWeb, del puerto 25 y de
> pelear reputación de IP para siempre. Zoho resuelve buzones + webmail + app
> móvil en ~30 minutos con 4 registros DNS, gratis hasta 5 usuarios.
> El autoalojado (Poste.io, secciones 2-5) queda como opción de **soberanía
> total** para el futuro — el script `instalar-webmail.sh` no se pierde.
>
> Comprobación en un comando, sirva el camino que sirva:
> `bash deploy/verificar-correo.sh sicr3p.cl` (solo lectura: reporta ✓/✗ de
> MX, SPF único, DKIM Zoho/Resend y DMARC).

Guía completa de ambas rutas: **Poste.io autoalojado** (secciones 1-5, 8) y
**Zoho hosted** (sección 7). El transaccional de la plataforma (Resend) va en
la sección 6.

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

## 3. Registros DNS exactos (panel del dominio sicr3p.cl)

> **Estado verificado el 19-07-2026** (consulta DNS en vivo): el **A** y el **MX**
> ya existen y apuntan bien. El **SPF actual es un problema**: dice
> `v=spf1 include:spf.hostmar.com -all`, o sea autoriza SOLO a Hostmar con rechazo
> duro — el correo enviado desde el propio VPS **fallaría SPF**. Hay que
> REEMPLAZARLO (no agregar un segundo TXT) por la versión fusionada de la tabla.
> `_dmarc` no existe todavía. El PTR sigue siendo el genérico de DonWeb
> (`vps-6165621-x.dattaweb.com`), así que el ticket de la sección de rDNS sigue pendiente.

| Tipo | Nombre / Host          | Valor                                                        | Estado 19-07-2026 |
|------|------------------------|--------------------------------------------------------------|-------------------|
| A    | `mail`                 | `138.36.237.61`                                              | ✅ ya creado |
| MX   | `@` (sicr3p.cl)        | `mail.sicr3p.cl` (prioridad 10)                              | ✅ ya creado |
| TXT  | `@` (sicr3p.cl)        | `v=spf1 mx include:spf.hostmar.com ~all` (**reemplaza** al actual `v=spf1 include:spf.hostmar.com -all`) | ⚠️ corregir |
| TXT  | `_dmarc`               | `v=DMARC1; p=quarantine; rua=mailto:postmaster@sicr3p.cl`    | ❌ crear |
| TXT  | `<selector>._domainkey`| *(DKIM: se genera después de instalar — ver sección 4)*      | ❌ después de instalar |

> **Por qué esa fusión de SPF**: solo puede existir UN TXT SPF por nombre. La
> versión fusionada autoriza al VPS (vía `mx`) y conserva a Hostmar por si algo
> del hosting antiguo aún envía con el dominio; `~all` (softfail) evita rechazos
> duros mientras se estabiliza. Cuando esté claro que nada envía por Hostmar,
> simplificar a `v=spf1 mx ~all`. Resend no se toca: usa su propio subdominio
> de envío con SPF aparte.

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

## 4. Primer arranque: asistente, DKIM y buzones

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

- `contacto@sicr3p.cl` — el buzón "humano" principal.
- `postmaster@sicr3p.cl` — recibe los reportes DMARC y avisos de otros
  servidores (puede ser un alias hacia `contacto@` si prefieres:
  **Redirections → Create new**).

### 4.4 Entrar al webmail

- **Webmail (Roundcube)**: <https://mail.sicr3p.cl> → botón *Webmail*
  (o directo <https://mail.sicr3p.cl/webmail/>). Usuario = la dirección
  completa (`contacto@sicr3p.cl`), clave = la del buzón.
- **Cliente de escritorio/celular** (opcional):
  - IMAP: `mail.sicr3p.cl`, puerto 993, SSL/TLS.
  - SMTP: `mail.sicr3p.cl`, puerto 465 (SSL) o 587 (STARTTLS).

---

## 5. Prueba final de entregabilidad

1. Entra a <https://www.mail-tester.com> y copia la dirección que te da.
2. Desde el webmail (`contacto@sicr3p.cl`) envíale un correo con asunto y
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
`contacto@sicr3p.cl`, responder desde el webmail, etc. Son dos canales
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
2. Panel Resend → *Domains* → agregar `sicr3p.cl` → Resend te da 2-3
   registros (un TXT `resend._domainkey` con su DKIM y un registro para
   rebotes en un subdominio) → pegarlos en el panel DNS de DonWeb.
   **No tocan el SPF del dominio raíz** (ese es de Zoho): conviven sin
   conflicto.
3. Panel Resend → *API Keys* → crear clave → en el VPS:
   ```bash
   nano /opt/sicr3p/backend/.env    # RESEND_API_KEY=re_...  y  MAIL_FROM="sicr3p <no-responder@sicr3p.cl>"
   pm2 restart sicr3p-backend
   ```
4. Probar: procesar un documento y usar "Enviar informe por correo".
5. `bash deploy/verificar-correo.sh sicr3p.cl` debe mostrar el DKIM de
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
2. Agrega el dominio `sicr3p.cl` y verifica la propiedad con el TXT que Zoho
   te indique (algo como `zoho-verification=zb…`).
3. Crea los buzones `contacto@sicr3p.cl` y `postmaster@sicr3p.cl`.

### 7.2 DNS equivalente para Zoho

| Tipo | Nombre / Host           | Valor                                                      | Prioridad |
|------|-------------------------|------------------------------------------------------------|-----------|
| TXT  | `@`                     | *(el TXT de verificación que te dé Zoho)*                  | —         |
| MX   | `@` (sicr3p.cl)         | `mx.zoho.com`                                              | 10        |
| MX   | `@` (sicr3p.cl)         | `mx2.zoho.com`                                             | 20        |
| MX   | `@` (sicr3p.cl)         | `mx3.zoho.com`                                             | 50        |
| TXT  | `@` (sicr3p.cl)         | `v=spf1 include:zohomail.com ~all`                         | —         |
| TXT  | `zmail._domainkey`      | *(DKIM: se genera en el panel de Zoho → copiar tal cual)*  | —         |
| TXT  | `_dmarc`                | `v=DMARC1; p=quarantine; rua=mailto:postmaster@sicr3p.cl`  | —         |

> Con Zoho **no** se crean el registro A de `mail.sicr3p.cl` ni los MX hacia
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
