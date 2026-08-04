# instituto.sicrep.cl — subdominio del Instituto sicr3p

El mismo bundle del frontend sirve el subdominio: cuando el host empieza
con `instituto.`, la SPA muestra la landing del Instituto en la raíz
(ver `frontend/src/App.jsx`). Todas las demás rutas (`/inscripcion`,
`/constancia/:serial`, paneles) siguen funcionando bajo ese host.

No hay build ni backend aparte: es el mismo `dist/` y la misma API del
VPS, solo un `server` adicional de nginx. Sirve igual para
`instituto.sicr3p.cl` si prefieres mantener todo bajo el dominio web.

## 1. DNS (en el panel del dominio sicrep.cl)

Registro A: `instituto.sicrep.cl` → IP del VPS (la misma de sicr3p.cl).
Esperar a que propague (`dig +short instituto.sicrep.cl`).

## 2. nginx (en el VPS, como root)

```bash
cat > /etc/nginx/sites-available/instituto-sicr3p <<'NGINX'
server {
    listen 80;
    server_name instituto.sicrep.cl;

    root /opt/sicr3p/frontend/dist;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 20m;
    }

    location / {
        try_files $uri /index.html;
    }
}
NGINX
ln -sf /etc/nginx/sites-available/instituto-sicr3p /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

## 3. HTTPS

```bash
certbot --nginx -d instituto.sicrep.cl
```

Certbot reescribe el bloque a 443 y deja la redirección 80→443.

## 4. Verificar

- `https://instituto.sicrep.cl/` → landing del Instituto (catálogo de
  cursos cargado desde la API, verificador de constancias).
- `https://instituto.sicrep.cl/inscripcion` → formulario de inscripción.
- `https://sicr3p.cl/` sigue mostrando la portada general (el cambio de
  raíz aplica SOLO a hosts `instituto.*`).

## Nota

El deploy automático (`deploy/actualizar.sh`) no necesita cambios: el
subdominio sirve el mismo `dist/` que se reconstruye en cada deploy.
