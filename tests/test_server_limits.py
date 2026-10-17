import threading
import unittest
import urllib.request
from pathlib import Path

import server


class ServerProjectLimitTests(unittest.TestCase):
    def test_large_cube_projects_have_matching_frontend_and_backend_capacity(self) -> None:
        self.assertEqual(128 * 1024 * 1024, server.MAX_PROJECT_TEXT_BYTES)
        self.assertEqual(192 * 1024 * 1024, server.MAX_REQUEST_BYTES)
        self.assertGreater(server.MAX_REQUEST_BYTES, server.MAX_PROJECT_TEXT_BYTES)

    def test_browser_launch_defaults_to_borderless_kiosk_mode(self) -> None:
        arguments = server.parse_arguments(["--open-browser"])
        self.assertTrue(arguments.open_browser)
        self.assertTrue(arguments.browser_fullscreen)
        self.assertEqual(
            [
                "browser.exe",
                "--kiosk",
                "--disable-pinch",
                "--overscroll-history-navigation=0",
                "http://127.0.0.1:4173",
            ],
            server.fullscreen_browser_command("http://127.0.0.1:4173", Path("browser.exe")),
        )
        self.assertEqual(
            [
                "msedge.exe",
                "--kiosk",
                "--disable-pinch",
                "--overscroll-history-navigation=0",
                "--edge-kiosk-type=fullscreen",
                "http://127.0.0.1:4173",
            ],
            server.fullscreen_browser_command("http://127.0.0.1:4173", Path("msedge.exe")),
        )

    def test_windowed_browser_can_be_requested_explicitly(self) -> None:
        arguments = server.parse_arguments(["--open-browser", "--windowed-browser"])
        self.assertTrue(arguments.open_browser)
        self.assertFalse(arguments.browser_fullscreen)

    def test_local_preview_port_can_call_the_hal_api(self) -> None:
        httpd = server.AliceSIMHTTPServer(("127.0.0.1", 0), server.AliceSIMHandler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        try:
            url = f"http://127.0.0.1:{httpd.server_address[1]}/api/health"
            request = urllib.request.Request(url, headers={"Origin": "http://127.0.0.1:4175"})
            with urllib.request.urlopen(request, timeout=5) as response:
                self.assertEqual(response.status, 200)
                self.assertEqual(response.headers["Access-Control-Allow-Origin"], "http://127.0.0.1:4175")

            options = urllib.request.Request(
                url,
                method="OPTIONS",
                headers={"Origin": "http://127.0.0.1:4175", "Access-Control-Request-Method": "POST"},
            )
            with urllib.request.urlopen(options, timeout=5) as response:
                self.assertEqual(response.status, 204)
                self.assertEqual(response.headers["Access-Control-Allow-Methods"], "GET, POST, OPTIONS")
        finally:
            httpd.shutdown()
            httpd.server_close()
            thread.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
