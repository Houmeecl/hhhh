# sicr3p — Landing de pre-lanzamiento

Sitio **estático + SEO** para captar empresas y personas antes del lanzamiento, con **lista de
espera** y **códigos de piloto** (cupos de fundador). Marca **sicr3p**. El "juego" de captura de
documentos es una webapp aparte que se abre por **QR**; este landing la promociona y capta interés.

## Correr localmente
```bash
cd prelanzamiento-empresas
npm install
npm start          # o ./run.sh   →  http://localhost:4200
```
Usa el **SQLite integrado de Node 22** (`node:sqlite`, sin dependencias nativas). Al arrancar
siembra `CUPOS` códigos de piloto (por defecto 100) en `data/prelanzamiento.db`.

## Endpoints
- `POST /api/waitlist` — lista de espera (empresa o persona). Envía un correo de
  confirmación con **1 PDF de muestra adjunto** (`public/muestra-informe.pdf`, datos
  de ejemplo — no es un informe real de cliente). No bloqueante: si el correo falla,
  la respuesta al usuario ya se envió igual.
- `POST /api/piloto/validar` — valida un código de piloto (uso único).
- `GET /api/piloto/cupos` — cupos restantes (contador del hero).

## Correo de confirmación (Resend)
Variables de entorno (mismas que el backend principal):
```bash
RESEND_API_KEY=   # vacío = modo dev, el correo se imprime en consola
MAIL_FROM="sicr3p <no-responder@sicr3p.cl>"
```
El PDF de muestra ya está generado y committeado (`public/muestra-informe.pdf`).
Para regenerarlo (p. ej. si cambia el estilo del informe en `backend/src/services/pdf.js`):
```bash
cd backend && node scripts/generar-muestra-informe.mjs
```

## Ver los inscritos / códigos
```bash
node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('./data/prelanzamiento.db');
console.table(db.prepare('SELECT email,empresa,rubro FROM waitlist').all());
console.log('Códigos sin usar:'); console.table(db.prepare('SELECT codigo FROM codigos_piloto WHERE usado=0 LIMIT 10').all());"
```

## Desplegar en el apex (sicr3p.cl) con nginx
Sirve `public/` como estático y proxya `/api` a este proceso Node:
```nginx
server {
  listen 80; server_name sicr3p.cl www.sicr3p.cl;
  root /var/www/sicr3p-prelanzamiento/public; index index.html;
  location / { try_files $uri $uri/ /index.html; }
  location /api/ { proxy_pass http://127.0.0.1:4200; proxy_set_header Host $host; }
}
```
Luego HTTPS con `certbot --nginx -d sicr3p.cl -d www.sicr3p.cl`.

## Checklist SEO (ya incluido)
- `<title>` + meta description con keywords · Open Graph + Twitter cards.
- JSON-LD: Organization (SICR3P SpA) + WebSite + FAQPage.
- `canonical` + `hreflang es-CL` · `robots.txt` + `sitemap.xml` · favicon · theme-color.
- HTML semántico, mobile-first, tipografía Inter, accesibilidad (targets 48px, focus visible).

> Nota: cuando tengas el dominio, cambia `sicr3p.cl` por el real en `index.html` (canonical/OG),
> `robots.txt` y `sitemap.xml`.
