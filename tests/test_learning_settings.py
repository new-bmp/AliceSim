import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

import learning_service as service
import server


class LearningSettingsTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.directory = Path(directory.name)
        environment = patch.dict(os.environ, {"ALICESIM_CONFIG_DIR": directory.name}, clear=True)
        environment.start()
        self.addCleanup(environment.stop)

    def save(self, **changes):
        self.assertTrue(callable(getattr(service, "save_configuration", None)), "The settings interface must persist a model configuration")
        return service.save_configuration({"url": "https://model.example/v1/chat/completions", "model": "first", "key": "local-secret", "keyAction": "replace", "tools": True, **changes})

    def test_saved_configuration_takes_effect_now_and_in_a_new_process_without_exposing_key(self):
        result = self.save()
        self.assertTrue(result["configured"])
        self.assertTrue(result["hasKey"])
        self.assertEqual(result["source"], "saved")
        self.assertNotIn("local-secret", json.dumps(result))
        self.assertNotIn("local-secret", json.dumps(service.status()))
        self.assertEqual(service.configuration()["key"], "local-secret")
        script = "import learning_service as s; c=s.configuration(); print(c['model'], c['key']=='local-secret', c['tools'])"
        child = subprocess.run([sys.executable, "-c", script], cwd=Path(__file__).resolve().parents[1], capture_output=True, text=True, check=True)
        self.assertEqual(child.stdout.strip(), "first True True")

    def test_blank_key_preserves_existing_key_and_explicit_clear_removes_it(self):
        self.save()
        result = self.save(model="second", key="", keyAction="keep", tools=False)
        self.assertTrue(result["hasKey"])
        self.assertEqual(service.configuration()["key"], "local-secret")
        self.assertEqual(service.configuration()["model"], "second")
        self.assertFalse(service.configuration()["tools"])
        result = self.save(key="", keyAction="clear")
        self.assertFalse(result["hasKey"])
        self.assertEqual(service.configuration()["key"], "")

    def test_changing_endpoint_cannot_forward_the_old_secret_and_invalid_save_keeps_old_config(self):
        self.save()
        for changes in [
            {"url": "https://different.example/v1/chat/completions", "key": "", "keyAction": "keep"},
            {"url": "http://public.example/v1/chat/completions"},
            {"url": "https://model.example/v1/chat/completions?api_key=secret"},
            {"model": ""}, {"tools": "yes"}, {"key": "bad\r\nheader"},
        ]:
            with self.subTest(changes=changes), self.assertRaises(service.LearningError):
                self.save(**changes)
            self.assertEqual(service.configuration()["model"], "first")
            self.assertEqual(service.configuration()["key"], "local-secret")
        self.save(url="http://127.0.0.1:9999/v1/chat/completions", key="", keyAction="clear")
        self.assertEqual(service.configuration()["key"], "")

    def test_environment_is_a_fallback_and_ui_settings_override_it_as_a_whole(self):
        with patch.dict(os.environ, {"ALICESIM_AI_URL": "https://env.example/v1/chat/completions", "ALICESIM_AI_MODEL": "env-model", "ALICESIM_AI_KEY": "env-key"}):
            self.assertEqual(service.configuration()["model"], "env-model")
            self.save(key="", keyAction="clear")
            self.assertEqual(service.configuration()["model"], "first")
            self.assertEqual(service.configuration()["key"], "")

    def test_endpoint_can_include_api_version_without_putting_credentials_in_the_url(self):
        url = "https://model.example/chat/completions?api-version=2024-06-01"
        self.save(url=url)
        self.assertEqual(service.configuration()["url"], url)

    def test_connection_test_uses_draft_without_saving_or_sending_project_data(self):
        self.save()
        requests = []

        class Provider(BaseHTTPRequestHandler):
            def do_POST(self):
                requests.append((self.headers.get("Authorization"), json.loads(self.rfile.read(int(self.headers["Content-Length"])))))
                data = json.dumps({"choices": [{"message": {"content": '{"message":"OK","annotations":[]}'}}]}).encode()
                self.send_response(200)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *args):
                pass

        httpd = ThreadingHTTPServer(("127.0.0.1", 0), Provider)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        try:
            self.assertTrue(callable(getattr(service, "test_connection", None)))
            result = service.test_connection({"url": f"http://127.0.0.1:{httpd.server_port}/v1/chat/completions", "model": "draft", "key": "draft-secret", "keyAction": "replace", "tools": False})
            self.assertTrue(result["ok"])
            self.assertNotIn("draft-secret", json.dumps(result))
            self.assertEqual(requests[0][0], "Bearer draft-secret")
            self.assertEqual(requests[0][1]["model"], "draft")
            self.assertNotIn("tools", requests[0][1])
            self.assertNotIn("context", requests[0][1]["messages"][-1]["content"])
            self.assertEqual(service.configuration()["model"], "first")
            self.assertEqual(service.configuration()["key"], "local-secret")
        finally:
            httpd.shutdown()
            httpd.server_close()
            thread.join(3)

    def test_http_settings_are_local_only_and_never_return_the_secret(self):
        httpd = server.AliceSIMHTTPServer(("127.0.0.1", 0), server.AliceSIMHandler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        base = f"http://127.0.0.1:{httpd.server_port}"
        body = {"url": "https://model.example/v1/chat/completions", "model": "http", "key": "http-secret", "keyAction": "replace", "tools": True}
        try:
            request = urllib.request.Request(base + "/api/learning/config", data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "Origin": base})
            try:
                with urllib.request.urlopen(request, timeout=5) as response:
                    saved = json.load(response)
            except urllib.error.HTTPError as exc:
                self.fail(f"Saving settings must succeed, got HTTP {exc.code}")
            self.assertEqual(saved["model"], "http")
            self.assertNotIn("http-secret", json.dumps(saved))
            with urllib.request.urlopen(base + "/api/learning/config", timeout=5) as response:
                reopened = json.load(response)
            self.assertTrue(reopened["hasKey"])
            self.assertNotIn("http-secret", json.dumps(reopened))
            for route in ["/api/learning/config", "/api/learning/test"]:
                for headers in [{"Origin": "https://evil.example"}, {"Host": "evil.example", "Origin": "http://evil.example"}]:
                    denied = urllib.request.Request(base + route, data=json.dumps(body).encode(), headers={"Content-Type": "application/json", **headers})
                    with self.assertRaises(urllib.error.HTTPError) as caught:
                        urllib.request.urlopen(denied, timeout=5)
                    self.assertEqual(caught.exception.code, 403)
            self.assertEqual(service.configuration()["key"], "http-secret")
        finally:
            httpd.shutdown()
            httpd.server_close()
            thread.join(3)


if __name__ == "__main__":
    unittest.main()
