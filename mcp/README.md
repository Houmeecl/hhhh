# Servidor MCP de sicr3p

Expone la API de sicr3p como herramientas [MCP](https://modelcontextprotocol.io)
para agentes (Claude Desktop, Claude Code u otro cliente MCP). **Solo
lectura**: cada herramienta llama al mismo endpoint HTTP público o de
mandante que ya sirve la plataforma, con las mismas reglas de acceso —
este servidor no abre ningún camino nuevo a los datos.

## Instalación

```bash
cd mcp
npm install
```

## Configuración

| Variable | Qué es | Default |
|---|---|---|
| `SICR3P_API_URL` | Base de la instancia (con `https://`) | `https://sicr3p.cl` |
| `SICR3P_API_KEY` | X-Api-Key del mandante (se emite en el panel: Accesos → Mandantes). Solo la usan las herramientas `sicr3p_mandante_*`; sin ella, las públicas funcionan igual. | — |

### Claude Code

```bash
claude mcp add sicr3p -e SICR3P_API_URL=https://sicr3p.cl -e SICR3P_API_KEY=TU_CLAVE \
  -- node /ruta/a/hhhh/mcp/servidor.js
```

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "sicr3p": {
      "command": "node",
      "args": ["/ruta/a/hhhh/mcp/servidor.js"],
      "env": {
        "SICR3P_API_URL": "https://sicr3p.cl",
        "SICR3P_API_KEY": "TU_CLAVE"
      }
    }
  }
}
```

## Herramientas

**Públicas (sin credencial):**

| Herramienta | Qué devuelve |
|---|---|
| `sicr3p_estado_cadena` | Estado de la cadena de integridad global (eslabones, último hash, verificación) |
| `sicr3p_verificar_documento` | Verificación de un documento procesado por su UUID (el del QR) |
| `sicr3p_pasaporte_lote` | Pasaporte de Trazabilidad Documental de un lote (cadena de custodia + semáforo) |
| `sicr3p_mensajes_lote` | Instrucciones de la Torre de Control para un lote |
| `sicr3p_pasaporte_producto` | Pasaporte Digital de Producto de una sesión |
| `sicr3p_cursos_instituto` | Catálogo público del Instituto sicr3p |
| `sicr3p_verificar_constancia` | Verificación de una constancia de curso por serial |

**De mandante (requieren `SICR3P_API_KEY`):**

| Herramienta | Qué devuelve |
|---|---|
| `sicr3p_mandante_proveedores` | Proveedores del mandante con su CO2e |
| `sicr3p_mandante_proveedor_resumen` | Resumen de un proveedor por RUT |
| `sicr3p_mandante_alcance3` | Export Alcance 3 / Scope 3 (GHG Protocol), filtrable por año |
| `sicr3p_mandante_cbam` | Export CBAM (emisiones incorporadas por lote) |

## Probar a mano

```bash
npx @modelcontextprotocol/inspector node servidor.js
```

## Límites (los mismos de la plataforma)

Los resultados son estimaciones metodológicas trazables, no una
certificación ni una verificación de tercera parte acreditada. Las
constancias de curso no son certificaciones. El export CBAM alimenta la
declaración del importador, no la reemplaza.
