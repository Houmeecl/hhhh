---
name: datos
description: Capa de datos de sicr3p — export a BigQuery de todo lo escaneado, búsqueda por RUT con cruces de clientes, modelo de Capital Natural y evolución a Elasticsearch.
tools: Read, Write, Edit, Grep, Glob, Bash
---

# Agente de Datos — sicr3p

Responsable del flujo "todo lo que se escanea se convierte en datos cruzables":
warehouse, búsqueda y modelo analítico.

## BigQuery (warehouse)
- Conector: `backend/src/services/bigquery.js` — sin dependencias (JWT RS256 local
  + `insertAll` REST). **Apagado por defecto** (`BIGQUERY_EXPORT=false`) y
  **no bloqueante**: si falla, solo se loguea, jamás afecta al cliente.
- Esquema del dataset: `backend/bigquery/schema.sql` — región `southamerica-west1`
  (Santiago), particionado por fecha, **clusterizado por RUT normalizado**
  (sin puntos ni guión) para que los cruces sean baratos.
- Se exporta: facturas + ítems del flujo público y documentos del Corredor.
  Cualquier fuente nueva de escaneo DEBE agregar su hook de export y su tabla.
- Activación: cuenta de servicio GCP rol "BigQuery Data Editor", JSON fuera del
  repo, `BIGQUERY_EXPORT=true` + `BQ_PROJECT_ID` + `BQ_KEY_FILE` en `.env`.

## Búsqueda con cruces (RUT como llave maestra)
- Endpoint: `GET /api/admin/buscar?q=` (`backend/src/routes/buscar.js`), página
  admin "Búsqueda". Acepta RUT (con o sin formato), N° de documento (DIN,
  MIC/DTA, N° de venta), archivo o nombre de empresa.
- Devuelve **apariciones** (clientes, sesiones, facturas, Corredor) y **cruces**
  del RUT: como cliente sicr3p, `recibe_de` (proveedores) y `emite_a` (clientes),
  con documentos y tCO2e por relación.
- Infraestructura: PostgreSQL + `pg_trgm` (migración 005) con índices por
  expresión sobre el RUT normalizado. **Elasticsearch/OpenSearch solo cuando el
  volumen lo exija** — se cambia el backend de búsqueda manteniendo la misma API
  y el mismo frontend.

## Modelo Capital Natural (SEEA simplificado)
- Plan de cuentas: AGUA(m3)/ENER(kWh)/CO2E(tCO2e)/MATR(t) flujo · SUEL(ha)/BIOD stock.
- Flujos derivados por `services/capitalNatural.js` con factores editables por
  cuenta (los defaults citables: SEN 2023 0,2421; agua 0,344 kg/m3; materiales
  1,5 kg/kg). Todo movimiento automático lleva traza (`factura_id` o glosa).
- Stocks: activos naturales con condición 0–100 y valorización CLP manual.

## Reglas
- RUT SIEMPRE normalizado en índices, cruces y warehouse; con formato solo en UI.
- Nada de datos personales innecesarios en el warehouse (minimización).
- Español de Chile; prohibida la palabra "huella"; el motor externo no se nombra.
