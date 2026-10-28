"""Regression coverage for device decoding, freshness, history, and HTTP/SSE."""
import contextlib
import http.client
import io
import json
import sqlite3
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

import device_reader
from history import HistoryStore
from projects import project_catalog
from server import TelemetryHub, load_room, make_handler, parse_args
from http.server import ThreadingHTTPServer


def registers():
    raw = [0] * 26
    raw[0], raw[1], raw[2], raw[3] = 242, 462, 10132, 65488
    raw[4], raw[19], raw[20], raw[25] = 100, 63, 1, 2
    return raw


def reading(sequence=1, age=0, alarm=False):
    raw = registers()
    raw[20], raw[24], raw[5] = sequence, age, int(alarm)
    result = device_reader.decode(raw, 'fixture', 502)
    result['mode'] = 'full'
    return result


class DecoderTests(unittest.TestCase):
    def test_scales_and_signed_values(self):
        data = device_reader.decode(registers(), 'fixture', 502)
        self.assertEqual(data['environment']['temperature_c'], 24.2)
        self.assertEqual(data['environment']['pressure_hpa'], 1013.2)
        self.assertEqual(data['status']['wifi_rssi_dbm'], -48)

    def test_invalid_booleans_are_unknown(self):
        for invalid in (0xFFFF, 2, 32768):
            raw = registers()
            for index in (5, 7, 21, 22):
                raw[index] = invalid
            status = device_reader.decode(raw, 'fixture', 502)['status']
            for key in ('alarm_on', 'wifi_connected', 'button_a_down', 'button_b_down'):
                self.assertIsNone(status[key])

    def test_invalid_mask_does_not_report_healthy_sensors(self):
        raw = registers()
        raw[19] = 0xFFFF
        data = device_reader.decode(raw, 'fixture', 502)
        self.assertIsNone(data['environment']['temperature_c'])
        self.assertIsNone(data['status']['validity_mask'])
        self.assertTrue(all(sensor['ok'] is None for sensor in data['status']['sensor_health']))

    def test_invalid_temperature_and_sensor_fault(self):
        raw = registers()
        raw[0] = 0x8000
        self.assertIsNone(device_reader.decode(raw, 'fixture', 502)['environment']['temperature_c'])
        raw[0], raw[19] = 242, 62
        data = device_reader.decode(raw, 'fixture', 502)
        self.assertIsNone(data['environment']['temperature_c'])
        self.assertFalse(data['status']['sensor_health'][0]['ok'])

    def test_malformed_registers_are_rejected(self):
        for raw in ([0], [65536] * 26, [-1] * 26, [None] * 26):
            with self.assertRaises(ValueError):
                device_reader.decode(raw, 'fixture', 502)

    @patch('device_reader.read_fc04', side_effect=[ValueError('unsupported map'), [251]])
    def test_temperature_fallback(self, reader):
        result = device_reader.read_latest('fixture', 502, 7, 1)
        self.assertEqual(result['mode'], 'temperature-only')
        self.assertEqual(result['device']['unit_id'], 7)
        self.assertEqual(result['environment']['temperature_c'], 25.1)
        self.assertIsNone(result['status']['alarm_on'])
        self.assertEqual([call.kwargs['count'] for call in reader.call_args_list], [26, 1])

    @patch('device_reader.read_fc04')
    def test_unknown_map_is_not_decoded_as_full(self, reader):
        raw = registers()
        raw[25] = 3
        reader.return_value = raw
        self.assertEqual(device_reader.read_latest('fixture', 502, 1, 1)['mode'], 'temperature-only')

    @patch('device_reader.read_fc04', side_effect=OSError('device unreachable'))
    def test_both_read_failures_surface(self, reader):
        with self.assertRaisesRegex(ConnectionError, 'temperature read also failed'):
            device_reader.read_latest('fixture', 502, 1, 1)


class HubTests(unittest.TestCase):
    def setUp(self):
        self.hub = TelemetryHub('fixture', 502, 1, 1, 1, False)
        self.addCleanup(self.hub.store.close)

    def test_old_sample_is_stale_even_though_device_is_online(self):
        self.hub.process_reading(reading(age=600))
        data = self.hub.payload['data']
        self.assertTrue(data['online'])
        self.assertEqual(data['quality']['state'], 'stale')
        self.assertEqual(self.hub.events, self.hub.events.__class__())

    def test_frozen_sequence_is_stale_and_deduplicated(self):
        with patch('server.time.monotonic') as clock:
            for stamp in (10, 12, 16):
                clock.return_value = stamp
                self.hub.process_reading(reading())
        self.assertEqual(self.hub.payload['data']['quality']['state'], 'stale')
        self.assertEqual(len(self.hub.store.samples(self.hub.source)), 1)

    def test_snapshot_reports_publication_age_without_relabeling_an_old_read_as_new(self):
        with patch('server.time.monotonic', return_value=10) as clock:
            self.hub.process_reading(reading())
            clock.return_value = 70
            _, snapshot = self.hub.latest()
        self.assertEqual(snapshot['publication_age_seconds'], 60)

    def test_storage_failure_does_not_mark_a_responding_device_offline(self):
        with patch.object(self.hub.store, 'add_sample', side_effect=sqlite3.OperationalError('disk full')):
            with self.assertLogs('aura', level='ERROR'):
                self.hub.process_reading(reading())
        self.assertEqual(self.hub.payload['kind'], 'telemetry')
        self.assertEqual(self.hub.payload['history_error'], 'disk full')
        self.hub.process_reading(reading(sequence=2))
        self.assertIsNone(self.hub.payload['history_error'])

    def test_sequence_wrap_is_a_new_sample(self):
        self.hub.process_reading(reading(sequence=65535))
        first = self.hub.payload['data']['sample_id']
        self.hub.process_reading(reading(sequence=0))
        self.assertNotEqual(first, self.hub.payload['data']['sample_id'])
        self.assertEqual(self.hub.payload['data']['quality']['state'], 'fresh')

    def test_fault_and_unknown_health_are_distinct(self):
        data = reading()
        data['status']['sensor_health'][0]['ok'] = False
        self.hub.process_reading(data)
        self.assertEqual(self.hub.payload['data']['quality']['state'], 'fault')
        data = device_reader.decode_temperature_only([242], 'fixture', 502, 1)
        self.hub.process_reading(data)
        self.assertEqual(self.hub.payload['data']['quality']['state'], 'unknown')

    def test_invalid_alarm_does_not_become_a_clear_event(self):
        self.hub.process_reading(reading(alarm=True))
        unknown = reading(sequence=2)
        unknown['status']['alarm_on'] = None
        self.hub.process_reading(unknown)
        self.hub.process_reading(reading(sequence=3, alarm=False))
        self.assertFalse(self.hub.events)

    def test_rapid_demo_toggles_are_both_recorded(self):
        self.hub.demo = True
        self.hub.last_alarm = False
        self.assertTrue(self.hub.toggle_demo_alarm())
        self.assertFalse(self.hub.toggle_demo_alarm())
        events = self.hub.store.alarms(self.hub.source)
        self.assertEqual([item['alarm_on'] for item in events], [True, False])
        self.assertEqual(len({item['id'] for item in events}), 2)
        self.assertNotEqual(self.hub.events[-1][1]['id'], self.hub.payload['id'])

    def test_live_toggle_is_forbidden(self):
        with self.assertRaises(PermissionError):
            self.hub.toggle_demo_alarm()

    def test_offline_timestamp_is_utc_and_one_gap_is_saved(self):
        self.hub.process_reading(reading())
        self.hub.mark_offline('unreachable')
        self.assertEqual(self.hub.payload['sample']['quality'], 'offline')
        self.hub.mark_offline('still unreachable')
        self.assertTrue(self.hub.payload['last_seen'].endswith('Z'))
        samples = self.hub.store.samples(self.hub.source)
        self.assertEqual(sum(item['quality'] == 'offline' for item in samples), 1)


class HistoryTests(unittest.TestCase):
    def test_survives_restart_deduplicates_bounds_and_isolates_sources(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'history.sqlite3'
            store = HistoryStore(path, retention=2)
            for i in range(3):
                store.add_sample('live', {'id':str(i), 'temperature_c':20+i})
            store.add_sample('live', {'id':'2', 'temperature_c':100})
            store.add_sample('demo', {'id':'demo', 'temperature_c':99})
            store.add_alarm('live', {'id':'alarm-1', 'at':'2020-01-01T00:00:00Z'})
            store.close()
            store = HistoryStore(path, retention=2)
            self.addCleanup(store.close)
            self.assertEqual([row['temperature_c'] for row in store.samples('live')], [21,22])
            self.assertEqual(len(store.samples('demo')), 1)
            self.assertEqual(store.alarms('live')[0]['id'], 'alarm-1')
            self.assertFalse(store.alarms('demo'))


class ConfigurationTests(unittest.TestCase):
    def test_projects_keep_the_room_configuration_and_device_binding(self):
        room = load_room()
        room.update(name='Saved studio', code='ST-02')
        catalog = project_catalog(room)
        self.assertEqual(catalog['default_project'], 'atrium-building')
        items = {item['id']: item for item in catalog['projects']}
        self.assertEqual(items['meeting-room']['name'], 'Saved studio')
        self.assertEqual(items['meeting-room']['room'], room)
        self.assertEqual(items['meeting-room']['iot'][0]['scope'], 'meeting-room')
        self.assertEqual(items['atrium-building']['model']['floors'], 3)
        self.assertEqual(items['atrium-building']['iot'], [])

    def test_invalid_cli_values(self):
        for flag, values in {
            '--timeout':['0','-1','nan','inf','31'],
            '--unit':['-1','256'], '--interval':['0','nan','61'],
            '--web-port':['0','65536'], '--stale-after':['0','nan','3601']
        }.items():
            for value in values:
                with self.subTest(flag=flag, value=value), contextlib.redirect_stderr(io.StringIO()):
                    with self.assertRaises(SystemExit) as error:
                        parse_args([flag, value])
                    self.assertEqual(error.exception.code, 2)

    def test_room_configuration_validation(self):
        self.assertEqual(load_room()['width_m'], 11.2)
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'room.json'
            path.write_text(json.dumps({'name':'Studio', 'width_m':9, 'sensor_position':{'x':1,'y':1,'z':2}}))
            self.assertEqual(load_room(path)['name'], 'Studio')
            path.write_text(json.dumps({'sensor_position':{'x':100,'y':1,'z':0}}))
            with self.assertRaisesRegex(ValueError, 'inside the room'):
                load_room(path)


class HttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.hub = TelemetryHub('fixture', 502, 1, 1, 1, True)
        cls.hub.process_reading(cls.hub.demo_read())
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), make_handler(cls.hub))
        cls.server.daemon_threads = True
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.hub.stop.set()
        with cls.hub.condition:
            cls.hub.condition.notify_all()
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(2)
        cls.hub.store.close()

    def request(self, method, path):
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=3)
        connection.request(method, path)
        response = connection.getresponse()
        body = response.read()
        status, headers = response.status, dict(response.getheaders())
        connection.close()
        return status, headers, body

    def stream(self, cursor=None, through='state'):
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=3)
        headers = {'Last-Event-ID':cursor} if cursor else {}
        connection.request('GET', '/api/events', headers=headers)
        response = connection.getresponse()
        packets, packet = [], {}
        while True:
            line = response.fp.readline().decode().strip()
            if line.startswith(('event:', 'id:', 'data:')):
                key, value = line.split(':', 1)
                packet[key] = value.strip()
            if not line and 'event' in packet:
                packets.append(packet)
                if packet['event'] == through:
                    break
                packet = {}
        connection.close()
        return packets

    def test_assets_history_csv_and_live_control_rejection(self):
        for path in ('/', '/app.js', '/telemetry.js', '/style.css', '/api/state', '/api/history'):
            self.assertEqual(self.request('GET', path)[0], 200, path)
        status, headers, body = self.request('GET', '/api/history.csv')
        self.assertEqual(status, 200)
        self.assertIn('attachment', headers['Content-Disposition'])
        self.assertIn(b'sampled_at', body)
        self.hub.demo = False
        try:
            self.assertEqual(self.request('POST', '/api/demo/toggle-alarm')[0], 403)
        finally:
            self.hub.demo = True
        self.assertEqual(self.request('GET', '/server.py')[0], 404)

    def test_projects_api_and_local_model_assets(self):
        status, _, body = self.request('GET', '/api/projects')
        self.assertEqual(status, 200)
        catalog = json.loads(body)
        self.assertEqual(len(catalog['projects']), 2)
        for route in ('/building-viewer.js', '/viewer-fullscreen.js', '/project-ui.js', '/vendor/three.module.js', '/vendor/three.core.js', '/vendor/OrbitControls.js', '/projects/meeting-room/model.js', '/projects/atrium-building/model.js', '/projects/atrium-building/layout.js', '/projects/atrium-building/interiors.js', '/projects/atrium-building/geometry.js', '/projects/atrium-building/architecture.js', '/projects/atrium-building/services.js', '/projects/atrium-building/visibility.js', '/projects/atrium-building/stairs.js', '/projects/atrium-building/egress.js', '/projects/atrium-building/egress-plan.js'):
            self.assertEqual(self.request('GET', route)[0], 200, route)
        status, headers, _ = self.request('GET', '/projects/atrium-building/preview.svg')
        self.assertEqual(status, 200)
        self.assertIn('image/svg+xml', headers['Content-Type'])
        status, headers, body = self.request('GET', '/projects/atrium-building/reference/means-of-egress-e01.pdf')
        self.assertEqual(status, 200)
        self.assertEqual(headers['Content-Type'], 'application/pdf')
        self.assertTrue(body.startswith(b'%PDF-'))
        self.assertEqual(self.request('GET', '/projects/../server.py')[0], 404)

    def test_initial_connection_skips_old_alarms_and_resume_only_replays_missed(self):
        initial_id = self.hub.payload['id']
        self.hub.toggle_demo_alarm()
        alarm_id = self.hub.events[-1][1]['id']
        fresh = self.stream()
        self.assertFalse(any(packet['event'] == 'alarm' for packet in fresh))
        self.assertEqual(fresh[-1]['id'], self.hub.payload['id'])
        resumed = self.stream(initial_id)
        self.assertEqual([packet['id'] for packet in resumed if packet['event'] == 'alarm'], [alarm_id])
        # If an alarm was already delivered before a disconnect, it isn't replayed.
        after_alarm = self.stream(alarm_id)
        self.assertFalse(any(packet['event'] == 'alarm' for packet in after_alarm))
        restarted = self.stream('old-server:123')
        self.assertFalse(any(packet['event'] == 'alarm' for packet in restarted))


if __name__ == '__main__':
    unittest.main()
