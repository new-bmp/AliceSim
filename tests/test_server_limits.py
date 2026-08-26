import unittest
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


if __name__ == "__main__":
    unittest.main()
