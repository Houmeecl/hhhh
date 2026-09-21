"""Single-fleet monitoring pilot. Demo runs without third-party packages."""
import argparse
import hashlib
import json
import math
import os
import re
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from public_data import public_payload

UTC = timezone.utc
ROOT = Path(__file__).parent
ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
FIELDS = {"event_id", "vehicle_id", "timestamp", "source", "simulated", "speed_kmh",
          "coolant_c", "engine_on", "fault_codes", "terrain", "message"}


def timestamp(value):
    if not isinstance(value, str):
        raise ValueError("Fecha ISO requerida")
    date = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if date.tzinfo is None:
        raise ValueError("La fecha requiere zona horaria")
    return date.astimezone(UTC)


def normalize(raw):
    if not isinstance(raw, dict) or set(raw) != FIELDS:
        raise ValueError("Campos del evento incompletos o desconocidos")
    event = dict(raw)
    for field in ("event_id", "vehicle_id", "source"):
        if not isinstance(event[field], str) or not ID.fullmatch(event[field]):
            raise ValueError("Identificador inválido: " + field)
    event["timestamp"] = timestamp(event["timestamp"]).isoformat()
    for field, low, high in (("speed_kmh", 0, 250), ("coolant_c", -60, 180)):
        value = event[field]
        if value is not None and (type(value) not in (int, float) or not math.isfinite(value) or not low <= value <= high):
            raise ValueError("Medición inválida: " + field)
    for field in ("engine_on", "simulated"):
        if type(event[field]) is not bool:
            raise ValueError("Booleano requerido: " + field)
    codes = event["fault_codes"]
    if not isinstance(codes, list) or len(codes) > 20 or any(not isinstance(c, str) or not ID.fullmatch(c) for c in codes):
        raise ValueError("Códigos inválidos")
    if event["terrain"] not in ("urbano", "carretera", "faena", "desconocido"):
        raise ValueError("Terreno inválido")
    if not isinstance(event["message"], str) or len(event["message"]) > 1000:
        raise ValueError("Mensaje inválido")
    return event


def alerts(event, threshold):
    result = []
    if event["coolant_c"] is not None and event["coolant_c"] >= threshold:
        result.append("Temperatura supera umbral configurado")
    if event["fault_codes"]:
        result.append("Código de diagnóstico reportado; requiere revisión técnica")
    return result


def document_id(event):
    key = event["source"] + ":" + event["vehicle_id"] + ":" + event["event_id"]
    return hashlib.sha256(key.encode()).hexdigest()


def query_body(start, end, vehicle="", text=""):
    start, end = timestamp(start), timestamp(end)
    if end <= start or end - start > timedelta(days=31):
        raise ValueError("El intervalo debe ser positivo y de hasta 31 días")
    filters = [{"range": {"timestamp": {"gte": start.isoformat(), "lte": end.isoformat()}}}]
    if vehicle:
        if not ID.fullmatch(vehicle):
            raise ValueError("Vehículo inválido")
        filters.append({"term": {"vehicle_id": vehicle}})
    if len(text) > 200:
        raise ValueError("Búsqueda demasiado larga")
    must = [{"match": {"message": {"query": text, "operator": "and"}}}] if text else []
    return {"size": 500, "track_total_hits": True, "sort": [{"timestamp": "desc"}, {"event_id": "asc"}],
            "query": {"bool": {"filter": filters, "must": must}}}


def fleet_snapshot(events, vehicles, now, threshold, stale_minutes):
    latest = {}
    for event in events:
        observed = timestamp(event["timestamp"])
        if observed > now:
            continue
        if event["vehicle_id"] not in latest or observed > timestamp(latest[event["vehicle_id"]]["timestamp"]):
            latest[event["vehicle_id"]] = event
    rows = []
    for vehicle in sorted(vehicles):
        event = latest.get(vehicle)
        reasons = alerts(event, threshold) if event else []
        stale = event is None or now - timestamp(event["timestamp"]) > timedelta(minutes=stale_minutes)
        state = "sin_datos" if stale else "alerta" if reasons else "sin_alertas"
        rows.append({"vehicle_id": vehicle, "state": state, "latest": event, "alerts": reasons})
    return rows


def demo_events(now):
    result = []
    for vehicle_no in range(1, 5):
        for hour in range(720):
            # Vehicle 4 intentionally has no data for the last six hours.
            if vehicle_no == 4 and hour < 6:
                continue
            result.append(normalize({"event_id": f"demo-{vehicle_no}-{hour}",
                "vehicle_id": f"BUS-{vehicle_no:03}", "source": "simulador",
                "timestamp": (now - timedelta(hours=hour)).isoformat(), "simulated": True,
                "speed_kmh": 0 if hour % 4 == 0 else 65, "engine_on": hour % 4 != 0,
                "coolant_c": 110 if vehicle_no == 2 and hour < 2 else 82 + hour % 9,
                "fault_codes": ["P-DEMO"] if vehicle_no == 3 and hour == 0 else [],
                "terrain": "faena" if vehicle_no % 2 == 0 else "carretera",
                "message": "Registro simulado de operación en Antofagasta"}))
    return result


class DemoStore:
    def __init__(self, events):
        self.events = events

    def search(self, body):
        filters = body["query"]["bool"]["filter"]
        dates = filters[0]["range"]["timestamp"]
        start, end = timestamp(dates["gte"]), timestamp(dates["lte"])
        vehicle = next((f["term"]["vehicle_id"] for f in filters if "term" in f), None)
        allowed = next((f["terms"]["vehicle_id"] for f in filters if "terms" in f), None)
        must = body["query"]["bool"]["must"]
        words = must[0]["match"]["message"]["query"].lower().split() if must else []
        rows = [e for e in self.events if start <= timestamp(e["timestamp"]) <= end
                and (not vehicle or e["vehicle_id"] == vehicle)
                and (allowed is None or e["vehicle_id"] in allowed)
                and all(w in e["message"].lower() for w in words)]
        rows.sort(key=lambda e: e["timestamp"], reverse=True)
        return rows[:500], len(rows)

    def latest(self, vehicles):
        return self.events


class OpenSearchStore:
    def __init__(self):
        import boto3
        from opensearchpy import OpenSearch, RequestsHttpConnection, AWSV4SignerAuth
        endpoint = urlsplit(os.environ["OPENSEARCH_ENDPOINT"])
        if endpoint.scheme != "https" or not endpoint.hostname or endpoint.username or endpoint.path not in ("", "/") or endpoint.query or endpoint.fragment:
            raise ValueError("Se requiere endpoint HTTPS sin credenciales ni ruta")
        self.index = os.environ.get("OPENSEARCH_INDEX", "sicr3p-fleet-pilot-v1")
        if not re.fullmatch(r"[a-z][a-z0-9-]{1,100}", self.index):
            raise ValueError("Índice inválido; no se permiten comodines")
        credentials = boto3.Session().get_credentials()
        if credentials is None:
            raise ValueError("Credenciales AWS no disponibles")
        auth = AWSV4SignerAuth(credentials, os.environ["AWS_REGION"], "es")
        self.client = OpenSearch(hosts=[{"host": endpoint.hostname, "port": endpoint.port or 443}],
            http_auth=auth, use_ssl=True, verify_certs=True, ssl_assert_hostname=True,
            connection_class=RequestsHttpConnection, timeout=10, max_retries=1)

    def search(self, body):
        response = self.client.search(index=self.index, body=body)
        return [normalize(h["_source"]) for h in response["hits"]["hits"]], response["hits"]["total"]["value"]

    def latest(self, vehicles):
        response = self.client.search(index=self.index, body={"size": 0,
            "query": {"bool": {"filter": [{"terms": {"vehicle_id": vehicles}}, {"range": {"timestamp": {"lte": "now"}}}]}},
            "aggs": {"vehicles": {"terms": {"field": "vehicle_id", "size": len(vehicles)},
                "aggs": {"latest": {"top_hits": {"size": 1, "sort": [{"timestamp": "desc"}]}}}}}})
        return [normalize(b["latest"]["hits"]["hits"][0]["_source"]) for b in response["aggregations"]["vehicles"]["buckets"]]

    def ingest(self, path):
        from opensearchpy.helpers import bulk
        with open(path, encoding="utf-8") as source:
            events = [normalize(json.loads(line)) for line in source if line.strip()]
        if any(e["simulated"] for e in events) and os.environ.get("ALLOW_SIMULATED_IMPORT") != "true":
            raise ValueError("Importación simulada bloqueada por defecto")
        if any(timestamp(e["timestamp"]) > datetime.now(UTC) + timedelta(minutes=5) for e in events):
            raise ValueError("Evento futuro: revisar reloj del dispositivo")
        seen = {}
        for event in events:
            key = document_id(event)
            if key in seen and seen[key] != event:
                raise ValueError("Identificador duplicado con contenido diferente")
            seen[key] = event
        # Index operation is an idempotent upsert for retries of the same source event.
        success, _ = bulk(self.client, ({"_index": self.index, "_id": k, "_source": e} for k, e in seen.items()),
                          chunk_size=500, raise_on_error=True, refresh="wait_for")
        return success


def handler(store, vehicles, threshold, stale_minutes, demo):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def respond(self, status, payload, mime="application/json"):
            data = json.dumps(payload, ensure_ascii=False).encode() if mime == "application/json" else payload
            self.send_response(status)
            self.send_header("Content-Type", mime + "; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'")
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            # Local-only pilot. Reject cross-site DNS rebinding and browser origins.
            if self.headers.get("Host", "").split(":")[0] not in ("127.0.0.1", "localhost"):
                return self.respond(403, {"error": "Acceso local únicamente"})
            if self.headers.get("Sec-Fetch-Site") == "cross-site":
                return self.respond(403, {"error": "Origen no permitido"})
            url = urlsplit(self.path)
            static = {"/": ("index.html", "text/html"), "/app.js": ("app.js", "text/javascript"), "/style.css": ("style.css", "text/css")}
            if url.path in static:
                file, mime = static[url.path]
                return self.respond(200, (ROOT / file).read_bytes(), mime)
            try:
                now = datetime.now(UTC)
                if url.path == "/api/public":
                    area = parse_qs(url.query).get("area", [""])[0]
                    return self.respond(200, public_payload(now, demo, area))
                if url.path == "/api/fleet":
                    return self.respond(200, {"demo": demo, "as_of": now.isoformat(), "threshold_c": threshold,
                        "stale_minutes": stale_minutes, "vehicles": fleet_snapshot(store.latest(vehicles), vehicles, now, threshold, stale_minutes)})
                if url.path == "/api/events":
                    params = parse_qs(url.query)
                    value = lambda key, default: params.get(key, [default])[0]
                    vehicle = value("vehicle", "")
                    if vehicle and vehicle not in vehicles:
                        raise ValueError("Vehículo fuera de la flota configurada")
                    body = query_body(value("start", (now - timedelta(days=30)).isoformat()), value("end", now.isoformat()), vehicle, value("q", ""))
                    # Restrict every query to this deployment's allowlisted fleet.
                    body["query"]["bool"]["filter"].append({"terms": {"vehicle_id": vehicles}})
                    rows, total = store.search(body)
                    return self.respond(200, {"events": rows, "total": total, "truncated": total > len(rows)})
                return self.respond(404, {"error": "No encontrado"})
            except (ValueError, KeyError):
                return self.respond(400, {"error": "Filtros o datos inválidos"})
            except Exception:
                return self.respond(503, {"error": "No fue posible consultar OpenSearch; revisar conexión y permisos"})
    return Handler


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["serve", "init-index", "import-jsonl", "export-demo"], nargs="?", default="serve")
    parser.add_argument("--mode", choices=["demo", "opensearch"], default="demo")
    parser.add_argument("--file")
    parser.add_argument("--port", type=int, default=8090)
    args = parser.parse_args()
    if args.command == "export-demo":
        if not args.file:
            parser.error("--file requerido")
        with open(args.file, "w", encoding="utf-8") as target:
            target.write("\n".join(json.dumps(e, ensure_ascii=False) for e in demo_events(datetime.now(UTC))) + "\n")
        return
    if args.command != "serve" and args.mode != "opensearch":
        parser.error("Este comando requiere --mode opensearch")
    store = DemoStore(demo_events(datetime.now(UTC))) if args.mode == "demo" else OpenSearchStore()
    if args.command == "init-index":
        store.client.indices.create(index=store.index, body=json.loads((ROOT / "mapping.json").read_text()))
        print("Índice creado")
        return
    if args.command == "import-jsonl":
        if not args.file:
            parser.error("--file requerido")
        print("Eventos importados:", store.ingest(args.file))
        return
    if args.mode == "demo":
        vehicles, threshold, stale = [f"BUS-{i:03}" for i in range(1, 5)], 105, 90
    else:
        vehicles = os.environ["FLEET_VEHICLES"].split(",")
        threshold = float(os.environ["COOLANT_ALERT_C"])
        stale = float(os.environ["STALE_MINUTES"])
        if not vehicles or len(vehicles) > 100 or any(not ID.fullmatch(v) for v in vehicles):
            raise ValueError("Configurar 1 a 100 identificadores de vehículos")
        if not math.isfinite(threshold) or not 0 < threshold < 180 or not math.isfinite(stale) or stale <= 0:
            raise ValueError("Umbrales inválidos")
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler(store, vehicles, threshold, stale, args.mode == "demo"))
    print(f"Piloto {args.mode}: http://127.0.0.1:{args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
