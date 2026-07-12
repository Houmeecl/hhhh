# sicr3p — edición portátil (pendrive)

Versión **monousuario y local** de sicr3p. Corre desde una carpeta o pendrive, procesa las
facturas **en el propio dispositivo** (sin servidor compartido) y queda **protegida por tus
credenciales SII**. Objetivo: que cada persona trabaje **solo con sus propias facturas**.

> **Importante:** esta edición **no se conecta al SII**. El RUT + clave SII se usan como
> **candado local** del dispositivo: se guardan **cifrados** y se **verifican offline** al
> abrir sesión. La conexión real al SII/RCV es parte de la Etapa 2 (ver `../ETAPA2.md`).

## Requisitos
- **Node.js 22.5 o superior** (usa el SQLite integrado `node:sqlite`, sin módulos nativos).

## Uso
```bash
cd portable
npm install          # solo la primera vez
npm start            # o: ./run.sh   (Windows: run.bat)
```
Abre **http://localhost:4100**.

1. **Primer uso — vincular dispositivo:** ingresa tu **RUT**, tu **clave SII** y un nombre
   para el dispositivo. Las credenciales quedan **cifradas** en `portable/data/sicr3p.db`.
2. **Abrir sesión:** cada vez que entras, el dispositivo **pide y verifica** tu RUT + clave
   SII. Tras 5 intentos fallidos se bloquea 1 minuto.
3. **Procesar:** sube hasta **5 facturas**, genera tu **informe PDF** y tus **etiquetas con
   QR**. El QR abre la página de **verificación local**.

## Seguridad
- La clave SII **nunca** se guarda en texto plano:
  - Verificador de login: `scrypt(clave, salt)`.
  - Copia cifrada en reposo ("bajo código"): `AES-256-GCM`.
- Verificación en **tiempo constante**; rate-limit con bloqueo temporal.
- Los datos viven en `portable/data/` (en el pendrive) y están **fuera de git**.
- Todo es local: no hay llamadas de red salientes.

## Portarlo a un pendrive
Copia la carpeta `portable/` completa (con `node_modules/` tras el `npm install`) al pendrive.
En otro equipo con Node 22.5+, ejecuta `run.sh` / `run.bat`. La base `data/sicr3p.db` viaja
con la carpeta, así que tus datos y el candado te acompañan.

## Empaque futuro (opcional)
- **Ejecutable único** (`.exe` / binario) con `pkg` o `nexe`, para no requerir Node instalado.
- **App de escritorio** con Electron.
Ambos quedan anotados como mejora; esta versión prioriza ser liviana y auditable.

## Configuración
- `PORT` (por defecto `4100`), `PUBLIC_URL` (por defecto `http://localhost:<PORT>`, usado en
  los QR).
