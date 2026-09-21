"""Curated public-source catalog and reviewed JSONL event intake; no live connectors."""
import json
import os
from pathlib import Path
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit
ROOT = Path(__file__).parent
AREAS = {"antofagasta", "mejillones", "tocopilla", "calama", "taltal"}
KINDS = {"marejada", "restriccion_portuaria", "meteorologia", "ruta", "electricidad", "agua", "sismo", "aire", "hidrologia", "emergencia"}

def date(value):
    value = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if value.tzinfo is None:
        raise ValueError("Fecha sin zona horaria")
    return value

def validate(event, sources):
    fields = {"event_id", "source_id", "source_url", "published_at", "retrieved_at", "valid_from", "valid_to", "areas", "kind", "nature", "title", "simulated"}
    if not isinstance(event, dict) or set(event) != fields:
        raise ValueError("Esquema público inválido")
    if any(not isinstance(event[k], str) or not 0 < len(event[k]) <= 1000 for k in fields - {"areas", "simulated"}):
        raise ValueError("Texto inválido")
    hosts = {s["id"]: urlsplit(s["url"]).hostname for s in sources}
    url = urlsplit(event["source_url"])
    if event["source_id"] not in hosts or url.scheme != "https" or url.hostname != hosts[event["source_id"]] or url.username or url.password:
        raise ValueError("URL fuera de fuente catalogada")
    if type(event["simulated"]) is not bool or event["kind"] not in KINDS or event["nature"] not in {"observacion", "pronostico", "aviso", "restriccion"}:
        raise ValueError("Clasificación inválida")
    if event["kind"] == "restriccion_portuaria" and (event["source_id"] != "directemar" or event["nature"] != "restriccion"):
        raise ValueError("Restricción requiere registro DIRECTEMAR")
    if not isinstance(event["areas"], list) or not event["areas"] or any(a not in AREAS for a in event["areas"]):
        raise ValueError("Área inválida")
    for k in ("published_at", "retrieved_at", "valid_from", "valid_to"):
        date(event[k])
    if date(event["valid_to"]) <= date(event["valid_from"]) or date(event["retrieved_at"]) < date(event["published_at"]):
        raise ValueError("Vigencia inválida")
    return event

def public_payload(now, demo, area=""):
    if area and area not in AREAS:
        raise ValueError("Área inválida")
    sources = json.loads((ROOT / "sources.json").read_text())
    events = []
    configured = bool(os.environ.get("PUBLIC_EVENTS_FILE"))
    if configured and not demo:
        with open(os.environ["PUBLIC_EVENTS_FILE"], encoding="utf-8") as stream:
            events = [validate(json.loads(line), sources) for line in stream if line.strip()]
        if any(e["simulated"] for e in events):
            raise ValueError("Eventos simulados no permitidos en modo real")
    if demo:
        events = [dict(event_id="DEMO-MAR-1", source_id="armada", source_url=sources[0]["url"],
            published_at=(now-timedelta(hours=2)).isoformat(), retrieved_at=now.isoformat(),
            valid_from=(now-timedelta(hours=1)).isoformat(), valid_to=(now+timedelta(hours=12)).isoformat(),
            areas=["antofagasta", "mejillones"], kind="marejada", nature="aviso",
            title="SIMULACIÓN: aviso de marejadas para probar filtros. No es un aviso oficial.", simulated=True)]
    result = []
    for event in events:
        if area and area not in event["areas"]:
            continue
        item = dict(event)
        item["time_state"] = "vencido" if date(item["valid_to"]) < now else "futuro" if date(item["valid_from"]) > now else "vigente"
        result.append(item)
    return dict(demo=demo, sources=sources, events=result, ingestion="simulacion" if demo else "archivo_revisado" if configured else "sin_conexion", as_of=now.isoformat())
