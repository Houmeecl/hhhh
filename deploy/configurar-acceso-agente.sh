#!/usr/bin/env bash
# ============================================================
# sicr3p — Crea un usuario dedicado para acceso SSH del agente Claude,
# separado por completo de la cuenta que ya usas (root/tu propio usuario).
#
# Uso (como root en el VPS, vía la terminal integrada de WinSCP o cualquier
# otra consola):
#   cd /opt/sicr3p && git pull && bash deploy/configurar-acceso-agente.sh
#
# Qué hace:
#   1. Crea el usuario "sicr3p-agente" (si no existe ya).
#   2. Le agrega la llave pública de abajo a su authorized_keys (solo esa
#      llave puede entrar con ese usuario — nunca tu contraseña ni la de root).
#   3. Le da sudo sin clave, SOLO a ese usuario, para que pueda correr los
#      scripts de deploy (apt-get, nginx, pm2).
#
# Para revocar el acceso en cualquier momento (un solo comando):
#   deluser --remove-home sicr3p-agente && rm -f /etc/sudoers.d/sicr3p-agente
#
# Idempotente: se puede correr varias veces sin duplicar nada.
# ============================================================
set -euo pipefail

USUARIO="sicr3p-agente"
LLAVE_PUBLICA="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJdLxsEROuJqPi48sITtobNgfDOdxuPyiv6/+F2/Q/+4 claude-sicr3p-202607"

if id "$USUARIO" >/dev/null 2>&1; then
  echo "==> El usuario $USUARIO ya existe, no se recrea."
else
  adduser --disabled-password --gecos "" "$USUARIO"
  echo "==> Usuario $USUARIO creado."
fi

install -d -m 700 -o "$USUARIO" -g "$USUARIO" "/home/$USUARIO/.ssh"
TOUCH_FILE="/home/$USUARIO/.ssh/authorized_keys"
touch "$TOUCH_FILE"
if grep -qF "$LLAVE_PUBLICA" "$TOUCH_FILE"; then
  echo "==> La llave pública ya estaba autorizada."
else
  echo "$LLAVE_PUBLICA" >> "$TOUCH_FILE"
  echo "==> Llave pública agregada."
fi
chmod 600 "$TOUCH_FILE"
chown "$USUARIO:$USUARIO" "$TOUCH_FILE"

cat > "/etc/sudoers.d/$USUARIO" <<EOF
$USUARIO ALL=(ALL) NOPASSWD:ALL
EOF
chmod 440 "/etc/sudoers.d/$USUARIO"

echo
echo "============================================================"
echo " Listo. El agente puede conectarse como: $USUARIO@<tu-IP-o-dominio>"
echo " Revocar el acceso en cualquier momento:"
echo "   deluser --remove-home $USUARIO && rm -f /etc/sudoers.d/$USUARIO"
echo "============================================================"
