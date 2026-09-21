import json
import unittest
import threading
from datetime import datetime, timedelta
from urllib.request import urlopen
from http.server import ThreadingHTTPServer
import monitor as m
from public_data import public_payload, validate

class PilotTests(unittest.TestCase):
    def setUp(self):
        self.now=datetime.now(m.UTC)
        self.events=m.demo_events(self.now)
    def test_allowlist_without_vehicle_filter(self):
        body=m.query_body((self.now-timedelta(days=30)).isoformat(), self.now.isoformat())
        body['query']['bool']['filter'].append({'terms':{'vehicle_id':['BUS-001']}})
        rows,total=m.DemoStore(self.events).search(body)
        self.assertEqual(total,720)
        self.assertEqual(len(rows),500)
        self.assertTrue(all(e['vehicle_id']=='BUS-001' for e in rows))
    def test_missing_and_future_data(self):
        future=dict(self.events[0],timestamp=(self.now+timedelta(hours=1)).isoformat())
        rows=m.fleet_snapshot(self.events+[future],['BUS-001','BUS-002','BUS-004','missing'],self.now,105,90)
        self.assertEqual([r['state'] for r in rows],['sin_alertas','alerta','sin_datos','sin_datos'])
    def test_invalid_measurement_and_timezone(self):
        for value in [float('nan'),True,999]:
            with self.assertRaises(ValueError):m.normalize(dict(self.events[0],coolant_c=value))
        with self.assertRaises(ValueError):m.timestamp('2026-09-21T12:00:00')
    def test_public_area_and_closure_separation(self):
        d=public_payload(self.now,True,'mejillones')
        event={k:v for k,v in d['events'][0].items() if k!='time_state'}
        validate(event,d['sources'])
        self.assertEqual(public_payload(self.now,True,'calama')['events'],[])
        with self.assertRaises(ValueError):validate(dict(event,kind='restriccion_portuaria'),d['sources'])
        self.assertTrue(d['events'][0]['simulated'])
    def test_http_endpoints(self):
        server=ThreadingHTTPServer(('127.0.0.1',0),m.handler(m.DemoStore(self.events),['BUS-001'],105,90,True))
        t=threading.Thread(target=server.serve_forever,daemon=True);t.start()
        try:
            for path in ['/','/app.js','/style.css','/api/fleet','/api/events','/api/public']:
                with urlopen('http://127.0.0.1:'+str(server.server_port)+path) as r:
                    self.assertEqual(r.status,200)
                    self.assertTrue(r.read())
        finally:server.shutdown();server.server_close();t.join()
if __name__=='__main__':unittest.main()
