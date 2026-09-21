# SICR3P · Monitoreo operacional del norte

Piloto independiente para flotas de Antofagasta. Incluye tablero, 30 días de telemetría sintética, reglas explicables, búsqueda y catálogo de fuentes públicas. No contiene seguros, pagos, diagnóstico mecánico ni ML entrenado.

## Ejecutar demo

Python 3.10 o superior; demo sin dependencias externas:

```sh
cd pilots/fleet-monitor
python monitor.py
```

Abrir http://127.0.0.1:8090. Los datos y el aviso de marejada son **simulados**, no corresponden a avisos reales. El catálogo enlaza fuentes públicas; no hay conectores automáticos activos. La demo toma una instantánea al arrancar; recargar consulta esa instantánea y el estado envejece correctamente.

## OpenSearch

Adaptador para dominio administrado Amazon OpenSearch con firma AWS SigV4 `es`, TLS verificado y credenciales obtenidas por la cadena estándar de boto3. No se despliega infraestructura. No probado contra un dominio real. No soporta Serverless en esta versión.

Instalar `python -m pip install -r requirements.txt`. Configurar en el entorno, sin guardar secretos en el repositorio:

- `OPENSEARCH_ENDPOINT`: endpoint HTTPS del dominio.
- `AWS_REGION`: región del dominio.
- `OPENSEARCH_INDEX`: índice dedicado, predeterminado `sicr3p-fleet-pilot-v1`.
- `FLEET_VEHICLES`: identificadores autorizados separados por comas.
- `COOLANT_ALERT_C`: umbral validado para los vehículos del piloto.
- `STALE_MINUTES`: tolerancia de antigüedad validada para la frecuencia del proveedor.

```sh
python monitor.py init-index --mode opensearch
python monitor.py import-jsonl --mode opensearch --file telemetria.jsonl
python monitor.py serve --mode opensearch
```

`mapping.json` define el esquema estricto. `python monitor.py export-demo --file demo.jsonl` genera un ejemplo del contrato. No usar datos sintéticos en un índice operacional: importación bloqueada por defecto; solo para un índice de pruebas se puede habilitar `ALLOW_SIMULATED_IMPORT=true`. El importador valida el lote antes de enviarlo, rechaza fechas futuras de más de cinco minutos y usa un identificador estable para reintentos. Un error de bulk puede dejar un lote parcialmente cargado; se puede reintentar el archivo. Una nueva importación con la misma identidad reemplaza el documento: guardar originales/versiones fuera de este índice si se requiere auditoría inmutable.

La búsqueda muestra hasta 500 registros y el total; permite acotar vehículo, fecha y texto. El panel usa la última lectura por vehículo, sin confundir falta de señal con falla o estado saludable. Los códigos requieren revisión técnica. Los umbrales de demo no son recomendaciones de fabricante.

## Datos públicos y marejadas

`sources.json` es un catálogo inicial ampliable, no una afirmación de integración o cobertura total. Contiene Armada, DIRECTEMAR, SHOA, DMC, SENAPRED, MOP, SEC, SISS, CSN, SINCA, DGA y datos.gob.cl. Antes de cada conector hay que verificar API/descarga permitida, licencia, frecuencia, disponibilidad histórica y cobertura territorial. No todas las instituciones exponen datos operacionales automatizables.

Se puede cargar un archivo JSONL **revisado manualmente** mediante `PUBLIC_EVENTS_FILE` en modo OpenSearch. Obtener el ejemplo de estructura en `/api/public` durante la demo, quitando el campo calculado `time_state`; `public_data.validate` valida todos los campos, fechas y dominio de origen. Sustituir los registros por evidencia real y poner `simulated:false` solo si realmente corresponde. Registrar el enlace al documento específico, publicación, captura, vigencia, áreas, naturaleza y tipo. La validación de dominio no autentica el contenido: la revisión sigue siendo necesaria. No se descarga el enlace desde el servidor.

Áreas iniciales: Antofagasta, Mejillones, Tocopilla, Calama y Taltal. Se muestran avisos vigentes, futuros y vencidos. El filtro es territorial; no se ha implementado cruce automático con GPS o polígonos de rutas. Una marejada **no prueba cierre de puerto**, y un sismo **no prueba daño**. Restricciones portuarias se registran por separado con fuente DIRECTEMAR. Ausencia de registros no significa ausencia de riesgo. Los eventos públicos se leen del archivo y todavía no se indexan en OpenSearch; el adaptador OpenSearch de este piloto cubre telemetría.

Próxima integración: avisos marítimos y estado portuario con registros versionados, luego meteorología, rutas y emergencias; posteriormente servicios básicos y contexto ambiental según cobertura verificada. Conservar documento original, hash, método de extracción, estación/unidades, control de calidad y caducidad por fuente. Las noticias serían contexto por verificar, no evidencia oficial automática.

## Verificación y límites

```sh
python -m unittest -v
node --check app.js
```

Servidor limitado a loopback, sin autenticación ni soporte multiempresa. No exponer directamente a Internet. Para producción se requieren autenticación, aislamiento por cliente, política IAM mínima diferenciada para lectura/escritura, retención, respaldos, control de acceso a datos de vehículos y observabilidad. No hay alarmas enviadas, refresco automático, integración IoT, predicción ni despliegue AWS en este piloto. El siguiente insumo es un archivo real del proveedor de telemetría y la definición de vehículos/rutas del piloto.

Referencias técnicas: https://docs.opensearch.org/latest/clients/python-low-level/ y https://docs.opensearch.org/latest/api-reference/document-apis/bulk/
