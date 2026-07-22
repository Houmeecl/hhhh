#!/usr/bin/env bash
# ============================================================
# sicr3p — Verificador DNS del sistema de correo (SOLO LECTURA).
#
# Uso:  bash deploy/verificar-correo.sh sicr3p.cl
#
# Interroga el DNS real y reporta ✓/✗ para cada registro que el
# correo necesita, reconociendo los caminos posibles:
#   A) Zoho hosted:                MX de zoho.com + SPF include:zoho.com
#   B) Poste.io autoalojado o
#      Ferozo/DonWeb nativo:       MX mail.<dominio> (misma forma en DNS;
#      Ferozo configura A/MX/SPF/DKIM con sus propios wizards del panel,
#      así que el selector DKIM real puede no ser zmail._domainkey — este
#      script no lo puede adivinar sin la doc exacta del panel).
# También chequea el DKIM de Resend (transaccional de la plataforma).
#
# No escribe ni cambia NADA: se puede correr las veces que sea.
# ============================================================
set -euo pipefail

DOMINIO="${1:-}"
[ -n "$DOMINIO" ] || { echo "Uso: bash deploy/verificar-correo.sh <dominio>   (ej: sicr3p.cl)"; exit 1; }

# dig si existe; si no y somos root, se instala dnsutils; último recurso: nslookup.
if ! command -v dig >/dev/null 2>&1; then
  if [ "$(id -u)" = "0" ] && command -v apt-get >/dev/null 2>&1; then
    apt-get install -y -qq dnsutils >/dev/null 2>&1 || true
  fi
fi

consulta() { # consulta <tipo> <nombre> → líneas de respuesta (vacío si no hay)
  local tipo="$1" nombre="$2"
  if command -v dig >/dev/null 2>&1; then
    dig +short "$tipo" "$nombre" 2>/dev/null | sed 's/^"//; s/"$//'
  else
    nslookup -type="$tipo" "$nombre" 2>/dev/null | awk -F'= ' '/text|mail exchanger|=/{print $2}' | sed 's/^"//; s/"$//'
  fi
}

OK="✓"; NO="✗"
FALTAN=()

echo "==> Verificación de correo para: $DOMINIO"
echo

# ---------- MX ----------
MX="$(consulta MX "$DOMINIO" || true)"
ES_ZOHO=0
if echo "$MX" | grep -qi 'zoho\.com'; then
  ES_ZOHO=1
  echo "$OK MX → Zoho (camino A):"
elif echo "$MX" | grep -qi "mail\.$DOMINIO"; then
  echo "$OK MX → mail.$DOMINIO (camino B: Poste.io autoalojado o Ferozo/DonWeb nativo):"
elif [ -n "$MX" ]; then
  echo "$NO MX apunta a otro proveedor (revisa si es intencional):"
  FALTAN+=("MX")
else
  echo "$NO MX: sin registro — el dominio no recibe correo."
  FALTAN+=("MX")
fi
[ -n "$MX" ] && echo "$MX" | sed 's/^/     /'

# ---------- SPF ----------
TXTS="$(consulta TXT "$DOMINIO" || true)"
SPF_N="$(echo "$TXTS" | grep -c '^v=spf1' || true)"
SPF="$(echo "$TXTS" | grep '^v=spf1' | head -1 || true)"
if [ "$SPF_N" -gt 1 ]; then
  echo "$NO SPF: hay $SPF_N registros v=spf1 — DEBE haber UNO solo (dos SPF invalidan ambos)."
  FALTAN+=("SPF único")
elif [ -n "$SPF" ]; then
  echo "$OK SPF: $SPF"
  echo "$SPF" | grep -q 'include:zoho.com' || echo "     (nota: sin include:zoho.com — correcto solo si NO usas Zoho)"
else
  echo "$NO SPF: sin registro v=spf1."
  FALTAN+=("SPF")
fi

# ---------- Verificación de dominio Zoho ----------
if echo "$TXTS" | grep -q 'zoho-verification='; then
  echo "$OK Verificación Zoho presente (TXT zoho-verification=…)."
else
  echo "· Verificación Zoho: no encontrada (solo necesaria durante el alta del dominio en Zoho)."
fi

# ---------- DKIM ----------
DKIM_ZOHO="$(consulta TXT "zmail._domainkey.$DOMINIO" || true)"
DKIM_RESEND="$(consulta TXT "resend._domainkey.$DOMINIO" || true)"
if [ -n "$DKIM_ZOHO" ]; then
  echo "$OK DKIM Zoho (zmail._domainkey): presente."
elif [ "$ES_ZOHO" -eq 1 ]; then
  echo "$NO DKIM Zoho (zmail._domainkey): ausente — los correos de buzones pueden caer a spam."
  FALTAN+=("DKIM Zoho")
else
  echo "· DKIM Zoho (zmail._domainkey): ausente — normal si no usas Zoho. Si el correo es nativo de"
  echo "  Ferozo/DonWeb, confirma el DKIM generado por el wizard del panel (\"Configurar DKIM\") con:"
  echo "  dig TXT default._domainkey.$DOMINIO +short   (ajusta el selector si el panel usó otro)."
fi
if [ -n "$DKIM_RESEND" ]; then
  echo "$OK DKIM Resend (resend._domainkey): presente — transaccional de la plataforma firmado."
else
  echo "· DKIM Resend: ausente (necesario solo al activar los correos transaccionales de la app)."
fi

# ---------- DMARC ----------
DMARC="$(consulta TXT "_dmarc.$DOMINIO" | grep -i 'v=DMARC1' | head -1 || true)"
if [ -n "$DMARC" ]; then
  echo "$OK DMARC: $DMARC"
else
  echo "$NO DMARC (_dmarc): sin registro."
  FALTAN+=("DMARC")
fi

# ---------- Resumen ----------
echo
if [ "${#FALTAN[@]}" -eq 0 ]; then
  echo "============================================================"
  echo " Todo en orden. Último paso: prueba real en mail-tester.com"
  echo " (enviar un correo desde el buzón y apuntar a nota ≥ 9/10)."
  echo "============================================================"
else
  echo "============================================================"
  echo " Faltan: ${FALTAN[*]}"
  echo " Registros exactos para el panel DNS: deploy/WEBMAIL.md (camino A)."
  echo "============================================================"
  exit 2
fi
