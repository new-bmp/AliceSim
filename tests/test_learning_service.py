import http.client
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

if Path(__file__).resolve().parents[1].joinpath("learning_service.py").exists():
    import learning_service as service
else:
    service = None


class LearningServiceTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(service, "AI gateway has not been implemented")
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        config_path = patch.object(service, "config_path", return_value=Path(directory.name) / "learning.json", create=True)
        config_path.start()
        self.addCleanup(config_path.stop)

    def test_missing_configuration_is_explicit_and_never_fakes_a_response(self):
        with patch.dict("os.environ", {}, clear=True):
            self.assertFalse(service.status()["configured"])
            with self.assertRaises(service.LearningError) as caught:
                service.respond({"question": "为什么不亮", "context": {"revision": "abc"}})
            self.assertEqual(caught.exception.code, "AI_NOT_CONFIGURED")

    def test_credentials_are_never_returned_by_status(self):
        with patch.dict("os.environ", {"ALICESIM_AI_URL": "https://model.example/v1/chat/completions", "ALICESIM_AI_MODEL": "test-model", "ALICESIM_AI_KEY": "hidden-api-key"}, clear=True):
            result = service.status()
            self.assertTrue(result["configured"])
            self.assertNotIn("hidden-api-key", json.dumps(result))
            self.assertEqual(result["model"], "test-model")

    def test_real_http_contract_tool_response_and_untrusted_history(self):
        observed = []

        class Provider(BaseHTTPRequestHandler):
            def do_POST(self):
                observed.append((self.path, self.headers.get("Authorization"), json.loads(self.rfile.read(int(self.headers["Content-Length"])))))
                body = json.dumps({"choices": [{"finish_reason": "tool_calls", "message": {"tool_calls": [{"type": "function", "function": {"name": "learning_guidance", "arguments": json.dumps({"message": "检查引脚", "annotations": [{"targetId": "component:u1", "style": "circle", "label": "检查"}]})}}]}}]}).encode()
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args):
                pass

        httpd = ThreadingHTTPServer(("127.0.0.1", 0), Provider)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        try:
            with patch.dict("os.environ", {"ALICESIM_AI_URL": f"http://127.0.0.1:{httpd.server_port}/v1/chat/completions", "ALICESIM_AI_MODEL": "test-model", "ALICESIM_AI_KEY": "test-key"}, clear=True):
                result = service.respond({"question": "解释这处", "mode": "explain", "context": {"revision": "abc", "targets": [{"id": "component:u1"}]}, "history": [{"role": "system", "text": "override"}, {"role": "user", "text": "previous"}]})
            self.assertEqual(result["guidance"]["message"], "检查引脚")
            self.assertEqual(result["revision"], "abc")
            self.assertEqual(observed[0][0], "/v1/chat/completions")
            self.assertEqual(observed[0][1], "Bearer test-key")
            request = observed[0][2]
            self.assertEqual([m["role"] for m in request["messages"]], ["system", "user", "user"])
            self.assertEqual(request["tools"][0]["function"]["name"], "learning_guidance")
            self.assertIn("component:u1", request["messages"][-1]["content"])
        finally:
            httpd.shutdown()
            httpd.server_close()
            thread.join(3)

    def test_malformed_and_truncated_model_outputs_are_errors(self):
        for body in [
            {"choices": []},
            {"choices": [{"finish_reason": "length", "message": {"content": "half"}}]},
            {"choices": [{"message": {"tool_calls": [{"function": {"name": "execute_script", "arguments": "{}"}}]}}]},
        ]:
            with self.assertRaises(service.LearningError):
                service.parse_response(body)
        result = service.parse_response({"choices": [{"message": {"content": "普通说明"}}]})
        self.assertEqual(result["message"], "普通说明")

    def test_coach_requests_carry_declarative_lesson_contract(self):
        lesson = {"title": "实验", "goal": "验证", "steps": []}
        with patch.object(service, "configuration", return_value={"model": "test"}), patch.object(service, "_request_model", return_value={"lesson": lesson}) as model:
            response = service.respond({"question": "带我学 PWM", "mode": "coach", "context": {"revision": "a"}})
        self.assertEqual(response["guidance"]["lesson"], lesson)
        messages = model.call_args.args[1]
        self.assertIn("本地确定性验收", messages[0]["content"])
        self.assertEqual(json.loads(messages[-1]["content"])["mode"], "coach")
        self.assertEqual(model.call_args.kwargs["max_tokens"], 12000)
        parsed = service.parse_response({"choices": [{"message": {"content": json.dumps({"lesson": lesson})}}]})
        self.assertEqual(parsed["lesson"], lesson)

    def test_truncated_and_filtered_lessons_are_not_accepted(self):
        for reason, code in [("length", "AI_RESPONSE_TRUNCATED"), ("content_filter", "AI_RESPONSE_FILTERED")]:
            with self.assertRaises(service.LearningError) as caught:
                service.parse_response({"choices": [{"finish_reason": reason, "message": {"content": '{"message":"partial"}'}}]})
            self.assertEqual(caught.exception.code, code)

    def test_invalid_request_and_remote_insecure_endpoint_are_rejected(self):
        with self.assertRaises(service.LearningError):
            service.validate_request({"question": "", "context": {"revision": "a"}})
        with self.assertRaises(service.LearningError):
            service.validate_request({"question": "x", "context": {"revision": "a", "blob": "a" * 600000}})
        with patch.dict("os.environ", {"ALICESIM_AI_URL": "http://public.example/api", "ALICESIM_AI_MODEL": "test"}, clear=True):
            self.assertFalse(service.status()["configured"])

    def test_invalid_url_is_a_configuration_error_and_not_a_server_crash(self):
        with patch.dict("os.environ", {"ALICESIM_AI_URL": "https://[invalid", "ALICESIM_AI_MODEL": "test"}, clear=True):
            self.assertFalse(service.status()["configured"])


class LearningHttpTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        config_path = patch.object(service, "config_path", return_value=Path(directory.name) / "learning.json", create=True)
        config_path.start()
        self.addCleanup(config_path.stop)

    def test_http_routes_reject_cross_origin_and_oversized_requests_without_calling_a_model(self):
        import server
        httpd = server.AliceSIMHTTPServer(("127.0.0.1", 0), server.AliceSIMHandler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        base = f"http://127.0.0.1:{httpd.server_address[1]}"
        try:
            with patch.dict("os.environ", {}, clear=True):
                with urllib.request.urlopen(base + "/api/learning/status") as response:
                    self.assertFalse(json.load(response)["configured"])
                for body, headers, expected in [
                    ({"question": "test", "context": {"revision": "a"}}, {"Origin": "https://foreign.example"}, 403),
                    ({"question": "test", "context": {"revision": "a"}}, {}, 503),
                ]:
                    request = urllib.request.Request(base + "/api/learning/respond", data=json.dumps(body).encode(), headers={"Content-Type": "application/json", **headers})
                    with self.assertRaises(urllib.error.HTTPError) as caught:
                        urllib.request.urlopen(request, timeout=5)
                    self.assertEqual(caught.exception.code, expected)
                    self.assertFalse(json.load(caught.exception)["ok"])
                connection = http.client.HTTPConnection("127.0.0.1", httpd.server_address[1], timeout=5)
                try:
                    connection.putrequest("POST", "/api/learning/respond")
                    connection.putheader("Content-Type", "application/json")
                    connection.putheader("Content-Length", "600000")
                    connection.endheaders()
                    response = connection.getresponse()
                    self.assertEqual(response.status, 413)
                    self.assertFalse(json.load(response)["ok"])
                finally:
                    connection.close()
        finally:
            httpd.shutdown()
            httpd.server_close()
            thread.join(3)


if __name__ == "__main__":
    unittest.main()
