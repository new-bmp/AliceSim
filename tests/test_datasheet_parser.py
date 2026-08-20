import base64
import json
import threading
import unittest
import urllib.error
import urllib.request

import datasheet_parser
import server


def sample_pages() -> list[dict]:
    return [
        {
            "number": 1,
            "text": """
ACME1234 Datasheet
16-pin QFN package
I2C control up to 400 kHz
Addr = 10100
Last Two Bits of I2C Address
24-bit register address space with 8-bit data access
""",
            "tables": [],
        },
        {
            "number": 2,
            "text": "Pin Assignments and Descriptions\nPin Descriptions",
            "tables": [
                [
                    ["Pin Name", "QFN Pin #", "WLCSP Ball", "Power Supply", "I/O", "Pin Description"],
                    ["VDD", "1", "A1", "N/A", "I", "Digital power"],
                    ["GND", "2", "A2", "N/A", "I", "Ground"],
                    ["SCL", "3", "A3", "VDD", "I", "I2C clock"],
                    ["SDA", "4", "A4", "VDD", "I/O", "I2C data"],
                ]
            ],
        },
        {
            "number": 3,
            "text": "Recommended Operating Conditions",
            "tables": [
                [
                    ["Parameters", "Symbol", "Minimum", "Maximum", "Units"],
                    ["Digital power", "VDD", "1.7", "1.9", "V"],
                ]
            ],
        },
        {
            "number": 4,
            "text": "Absolute Maximum Ratings",
            "tables": [
                [
                    ["Parameters", "Symbol", "Minimum", "Maximum", "Units"],
                    ["Digital power", "VDD", "-0.3", "2.2", "V"],
                ]
            ],
        },
        {
            "number": 5,
            "text": "Register Quick Reference",
            "tables": [
                [
                    ["Address", "Function", "7", "6", "5", "4", "3", "2", "1", "0"],
                    ["0x010000\np.10", "Device ID (Read Only)", "DEVICE_ID\n1 0 1 0", None, None, None, None, None, None, None],
                    ["0x010001", "Control", "ENABLE\n0", None, None, None, None, None, None, None],
                    ["0x010002-0x01000F", "Reserved", "-", None, None, None, None, None, None, None],
                ]
            ],
        },
    ]


class DatasheetParserTests(unittest.TestCase):
    def test_structured_pages_generate_a_reviewable_peripheral_draft(self) -> None:
        draft = datasheet_parser.parse_datasheet_request(
            {
                "filename": "ACME1234.pdf",
                "pages": sample_pages(),
                "hints": {"partNumber": "ACME1234", "manufacturer": "Acme"},
            }
        )

        self.assertEqual("AliceSIMPeripheralDraft", draft["kind"])
        self.assertEqual("ACME1234", draft["identity"]["partNumber"])
        self.assertEqual("QFN", draft["packages"][0]["kind"])
        self.assertEqual(["0x50", "0x51", "0x52", "0x53"], draft["interfaces"][0]["addresses7Bit"])
        self.assertEqual(4, len(draft["pins"]))
        self.assertEqual(1, len(draft["electrical"]["recommendedOperatingConditions"]))
        self.assertEqual(1, len(draft["electrical"]["absoluteMaximumRatings"]))
        self.assertEqual(2, draft["registerMap"]["count"])
        self.assertFalse(draft["driver"]["installable"])
        self.assertIn("pinMapping:16-QFN:4/16", draft["review"]["unresolvedFields"])

    def test_validation_blocks_installation_until_required_review_is_complete(self) -> None:
        draft = datasheet_parser.parse_datasheet_request(
            {"filename": "ACME1234.pdf", "pages": sample_pages(), "hints": {"partNumber": "ACME1234"}}
        )
        result = datasheet_parser.validate_datasheet_draft(draft)
        self.assertTrue(result["ok"])
        self.assertFalse(result["installable"])
        self.assertEqual("review-draft", result["nextAction"])

        draft["review"]["unresolvedFields"] = []
        draft["review"]["confirmedFields"] = list(draft["review"]["requiredConfirmations"])
        result = datasheet_parser.validate_datasheet_draft(draft)
        self.assertTrue(result["installable"])
        self.assertEqual("generate-driver-and-run-tests", result["nextAction"])

    def test_required_confirmation_contract_cannot_be_removed_by_the_client(self) -> None:
        draft = datasheet_parser.parse_datasheet_request(
            {"filename": "ACME1234.pdf", "pages": sample_pages(), "hints": {"partNumber": "ACME1234"}}
        )
        draft["review"]["unresolvedFields"] = []
        draft["review"]["requiredConfirmations"] = []
        draft["review"]["confirmedFields"] = []
        result = datasheet_parser.validate_datasheet_draft(draft)
        self.assertFalse(result["ok"])
        self.assertFalse(result["installable"])
        self.assertTrue(any(error["path"] == "review.requiredConfirmations" for error in result["errors"]))

    def test_untrusted_pdf_payloads_are_bounded_and_must_be_real_pdf_data(self) -> None:
        with self.assertRaises(datasheet_parser.DatasheetError):
            datasheet_parser.parse_datasheet_request({"filename": "fake.pdf", "pdfBase64": "not-base64"})
        fake_pdf = base64.b64encode(b"this is not a pdf").decode("ascii")
        with self.assertRaises(datasheet_parser.DatasheetError):
            datasheet_parser.parse_datasheet_request({"filename": "fake.pdf", "pdfBase64": fake_pdf})


class DatasheetApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.httpd = server.AliceSIMHTTPServer(("127.0.0.1", 0), server.AliceSIMHandler)
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()
        cls.base_url = f"http://127.0.0.1:{cls.httpd.server_address[1]}"

    @classmethod
    def tearDownClass(cls) -> None:
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join(timeout=3)

    def post_json(self, path: str, payload: dict) -> tuple[int, dict]:
        request = urllib.request.Request(
            self.base_url + path,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                return response.status, json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read().decode("utf-8"))

    def test_health_advertises_the_draft_parser_contract(self) -> None:
        with urllib.request.urlopen(self.base_url + "/api/health", timeout=5) as response:
            payload = json.loads(response.read().decode("utf-8"))
        self.assertEqual("/api/datasheet/parse", payload["datasheetImport"]["endpoint"])
        self.assertEqual("/api/datasheet/validate", payload["datasheetImport"]["validationEndpoint"])

    def test_parse_and_validate_endpoints_return_json_without_clang_error_fields(self) -> None:
        status, draft = self.post_json(
            "/api/datasheet/parse",
            {"filename": "ACME1234.pdf", "pages": sample_pages(), "hints": {"partNumber": "ACME1234"}},
        )
        self.assertEqual(200, status)
        self.assertEqual("AliceSIMPeripheralDraft", draft["kind"])

        status, validation = self.post_json("/api/datasheet/validate", {"draft": draft})
        self.assertEqual(200, status)
        self.assertTrue(validation["ok"])

        status, error = self.post_json("/api/datasheet/parse", {"pdfBase64": "invalid"})
        self.assertEqual(400, status)
        self.assertFalse(error["ok"])
        self.assertNotIn("clang", error)


if __name__ == "__main__":
    unittest.main()
