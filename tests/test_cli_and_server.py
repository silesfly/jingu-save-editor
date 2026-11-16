from collections import OrderedDict
import base64
import hashlib
from http.server import ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.parse
import urllib.request

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

import jingu_editor  # noqa: E402

HANZI_RE = re.compile(r"[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]")
HANGUL_RE = re.compile(r"[\uAC00-\uD7A3]")
SCRIPT_PATH = ROOT_DIR / "jingu_editor.py"


def make_sample_save(money: int = 5000) -> OrderedDict:
    data = jingu_editor.default_save_data()
    jingu_editor.sdict_set(data["m_itemDic"], 10001, money)
    return data


def _run_cli(*args, cwd=None, env=None):
    cmd = [sys.executable, "-B", str(SCRIPT_PATH), *args]
    return subprocess.run(
        cmd,
        cwd=str(cwd or ROOT_DIR),
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=30,
    )


class TestCryptoAndValidation(unittest.TestCase):
    def test_roundtrip_serialize_encrypt_decrypt(self):
        for factory in (lambda: make_sample_save(77777), jingu_editor.default_global_data):
            original = factory()
            raw_json = jingu_editor.serialize_json_bytes(original)
            encrypted = jingu_editor.encrypt_bytes(raw_json)
            self.assertNotEqual(encrypted, raw_json)

            decrypted = jingu_editor.decrypt_bytes(encrypted)
            parsed = json.loads(decrypted.decode("utf-8-sig"), object_pairs_hook=OrderedDict)
            self.assertEqual(parsed, original)
            self.assertEqual(jingu_editor.validate_data(parsed), [])

    def test_lossless_int64_preservation(self):
        save_time_val = 638990123456789012
        item_time_val = 638990987654321987
        data = make_sample_save(5000)
        data["m_saveTime"] = save_time_val
        jingu_editor.sdict_set(data["m_itemTimeDic"], 1001, item_time_val)

        raw_1 = jingu_editor.encrypt_bytes(jingu_editor.serialize_json_bytes(data))
        dec_1 = json.loads(jingu_editor.decrypt_bytes(raw_1).decode("utf-8-sig"), object_pairs_hook=OrderedDict)
        self.assertEqual(dec_1["m_saveTime"], save_time_val)
        self.assertIsInstance(dec_1["m_saveTime"], int)
        self.assertEqual(jingu_editor.sdict_get(dec_1["m_itemTimeDic"], 1001, 0), item_time_val)

        jingu_editor.sdict_set(dec_1["m_itemDic"], 10001, 777888)
        raw_2 = jingu_editor.encrypt_bytes(jingu_editor.serialize_json_bytes(dec_1))
        dec_2 = json.loads(jingu_editor.decrypt_bytes(raw_2).decode("utf-8-sig"), object_pairs_hook=OrderedDict)
        self.assertEqual(dec_2["m_saveTime"], save_time_val)
        self.assertEqual(jingu_editor.sdict_get(dec_2["m_itemTimeDic"], 1001, 0), item_time_val)
        self.assertEqual(jingu_editor.sdict_get(dec_2["m_itemDic"], 10001, 0), 777888)

    def test_sdict_get_and_set_uses_uppercase_keys(self):
        dic = OrderedDict([("m_Keys", [10002]), ("m_Values", [5])])
        self.assertEqual(jingu_editor.sdict_get(dic, 10001, 0), 0)
        self.assertEqual(jingu_editor.sdict_get(dic, 10002, 0), 5)

        jingu_editor.sdict_set(dic, 10001, 12345)
        self.assertEqual(jingu_editor.sdict_get(dic, 10001, 0), 12345)
        self.assertEqual(len(dic["m_Keys"]), len(dic["m_Values"]))

    def test_validate_catches_errors_and_yangcheng_bool(self):
        data = make_sample_save(1200)
        self.assertIsInstance(data["m_yangCheng"], bool)
        self.assertEqual(jingu_editor.validate_data(data), [])

        missing = make_sample_save(1200)
        del missing["m_saveTime"]
        errs_m = jingu_editor.validate_data(missing)
        self.assertTrue(len(errs_m) > 0)
        for err in errs_m:
            self.assertIsNone(HANZI_RE.search(err))
            self.assertIsNotNone(HANGUL_RE.search(err))

        bad_items = make_sample_save(1200)
        bad_items["m_itemDic"] = OrderedDict([("m_Keys", [10001, 10002]), ("m_Values", [1200])])
        errs_i = jingu_editor.validate_data(bad_items)
        self.assertTrue(len(errs_i) > 0)

        bad_global = jingu_editor.default_global_data()
        del bad_global["m_guideHash"]
        errs_g = jingu_editor.validate_data(bad_global)
        self.assertTrue(len(errs_g) > 0)


class TestCLISubprocess(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmpdir = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def _assert_clean_stdout(self, proc):
        self.assertEqual(proc.returncode, 0, f"rc={proc.returncode}\n{proc.stdout}\n{proc.stderr}")
        self.assertIsNone(HANZI_RE.search(proc.stdout), f"Hanzi in stdout: {proc.stdout}")
        self.assertIsNone(HANZI_RE.search(proc.stderr), f"Hanzi in stderr: {proc.stderr}")

    def test_presets_demo_validate_inspect_edit(self):
        self._assert_clean_stdout(_run_cli("--help"))
        self._assert_clean_stdout(_run_cli("presets"))

        s_path = self.tmpdir / "Save1.bytes"
        g_path = self.tmpdir / "Setting.bytes"

        self._assert_clean_stdout(_run_cli("demo", str(s_path)))
        self._assert_clean_stdout(_run_cli("demo", str(g_path), "--global"))
        self.assertTrue(s_path.exists())
        self.assertTrue(g_path.exists())

        self._assert_clean_stdout(_run_cli("validate", str(s_path)))
        self._assert_clean_stdout(_run_cli("validate", str(g_path)))
        self._assert_clean_stdout(_run_cli("inspect", str(s_path)))
        self._assert_clean_stdout(_run_cli("inspect", str(g_path)))

        self._assert_clean_stdout(_run_cli(
            "edit", str(s_path),
            "--money", "500000", "--points", "250", "--set-effect", "101=555", "--max-wuxue"
        ))
        self.assertTrue(len(list(self.tmpdir.glob("Save1.bytes*.bak"))) >= 1)

        edited = json.loads(
            jingu_editor.decrypt_bytes(s_path.read_bytes()).decode("utf-8-sig"),
            object_pairs_hook=OrderedDict,
        )
        self.assertEqual(jingu_editor.sdict_get(edited["m_itemDic"], 10001, 0), 500000)
        self.assertEqual(jingu_editor.sdict_get(edited["m_itemDic"], 10002, 0), 250)

        self._assert_clean_stdout(_run_cli("edit", str(g_path), "--unlock-all-global"))
        self.assertTrue(len(list(self.tmpdir.glob("Setting.bytes*.bak"))) >= 1)


class TestServerAPI(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmpdir = self._tmp.name
        self.token = "test-jingu-token-12345"

        self.save_path = Path(self.tmpdir) / "SaveData1.bytes"
        self.initial_money = 4321
        sample = make_sample_save(money=self.initial_money)
        self.initial_bytes = jingu_editor.encrypt_bytes(jingu_editor.serialize_json_bytes(sample))
        self.save_path.write_bytes(self.initial_bytes)
        self.initial_sha256 = hashlib.sha256(self.initial_bytes).hexdigest()

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), jingu_editor.JinGuHandler)
        self.server.jingu_token = self.token
        self.server.save_dir_override = Path(self.tmpdir)
        self.port = self.server.server_address[1]
        self.base_url = f"http://127.0.0.1:{self.port}"

        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        os.environ.pop("JGSE_SIMULATE_GAME_RUNNING", None)
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)
        self._tmp.cleanup()

    def _request(self, method: str, path: str, body=None, headers=None):
        req_headers = dict(headers or {})
        data = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            req_headers.setdefault("Content-Type", "application/json")
        req = urllib.request.Request(
            f"{self.base_url}{path}",
            data=data,
            headers=req_headers,
            method=method,
        )
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                return resp.status, resp.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            try:
                return exc.code, exc.read().decode("utf-8")
            finally:
                exc.close()

    def test_index_exposes_meta_token_and_no_hanzi(self):
        status, html = self._request("GET", "/")
        self.assertEqual(status, 200)
        match = re.search(r'<meta\s+name="jingu-token"\s+content="([^"]+)"', html)
        self.assertIsNotNone(match)
        self.assertEqual(match.group(1), self.token)
        self.assertIsNone(HANZI_RE.search(html))

    def test_read_endpoints_with_token(self):
        headers = {jingu_editor.TOKEN_HEADER: self.token}
        for ep in ("/api/info", "/api/saves", "/api/list"):
            status, raw = self._request("GET", ep, headers=headers)
            self.assertEqual(status, 200)
            parsed = json.loads(raw)
            self.assertTrue(parsed.get("ok"))

    def test_unauthenticated_save_returns_401(self):
        payload = {
            "path": str(self.save_path),
            "expectedSha256": self.initial_sha256,
            "data": make_sample_save(money=9999),
        }
        status, _ = self._request("POST", "/api/save", body=payload)
        self.assertEqual(status, 401)
        self.assertEqual(self.save_path.read_bytes(), self.initial_bytes)

    def test_get_and_post_load_return_expected_structure(self):
        headers = {jingu_editor.TOKEN_HEADER: self.token}
        encoded_path = urllib.parse.quote(str(self.save_path), safe="")

        for method, url, body in [
            ("GET", f"/api/load?path={encoded_path}", None),
            ("POST", "/api/load", {"path": str(self.save_path)}),
        ]:
            status, raw = self._request(method, url, body=body, headers=headers)
            self.assertEqual(status, 200)
            parsed = json.loads(raw, object_pairs_hook=OrderedDict)
            self.assertTrue(parsed.get("ok"))
            self.assertIn("info", parsed)
            self.assertEqual(parsed["info"]["sha256"], self.initial_sha256)
            self.assertEqual(parsed["info"]["name"], "SaveData1.bytes")
            self.assertEqual(parsed["info"]["size"], len(self.initial_bytes))
            self.assertEqual(
                jingu_editor.sdict_get(parsed["data"]["m_itemDic"], 10001, 0),
                self.initial_money,
            )
            self.assertEqual(base64.b64decode(parsed["rawBase64"]), self.initial_bytes)

    def test_save_with_stale_sha256_rejected(self):
        headers = {jingu_editor.TOKEN_HEADER: self.token}
        payload = {
            "path": str(self.save_path),
            "expectedSha256": "0" * 64,
            "data": make_sample_save(money=88888),
        }
        status, raw = self._request("POST", "/api/save", body=payload, headers=headers)
        self.assertGreaterEqual(status, 400)
        self.assertIn(status, (400, 409))
        parsed = json.loads(raw)
        self.assertFalse(parsed.get("ok"))
        self.assertIn("SHA-256", parsed.get("error", ""))
        self.assertEqual(self.save_path.read_bytes(), self.initial_bytes)

    def test_save_rejects_invalid_paths_and_symlink(self):
        headers = {jingu_editor.TOKEN_HEADER: self.token}
        invalid_paths = [
            str(Path(self.tmpdir) / "bad.txt"),
            str(Path(self.tmpdir) / "foo.bytes:stream"),
            str(Path(self.tmpdir) / "NUL.bytes"),
        ]

        symlink_path = Path(self.tmpdir) / "link_save.bytes"
        try:
            os.symlink(self.save_path, symlink_path)
            invalid_paths.append(str(symlink_path))
        except OSError:
            pass

        for bad_path in invalid_paths:
            payload = {
                "path": bad_path,
                "expectedSha256": self.initial_sha256,
                "data": make_sample_save(money=777),
            }
            status, _ = self._request("POST", "/api/save", body=payload, headers=headers)
            self.assertEqual(status, 400, f"Expected 400 for {bad_path}, got {status}")

    def test_save_blocked_when_game_running_simulated(self):
        headers = {jingu_editor.TOKEN_HEADER: self.token}
        payload = {
            "path": str(self.save_path),
            "expectedSha256": self.initial_sha256,
            "data": make_sample_save(money=55555),
        }
        os.environ["JGSE_SIMULATE_GAME_RUNNING"] = "1"
        try:
            status, _ = self._request("POST", "/api/save", body=payload, headers=headers)
        finally:
            os.environ.pop("JGSE_SIMULATE_GAME_RUNNING", None)

        self.assertGreaterEqual(status, 400)
        self.assertEqual(self.save_path.read_bytes(), self.initial_bytes)

    def test_save_with_matching_sha256_succeeds_and_creates_backup(self):
        headers = {jingu_editor.TOKEN_HEADER: self.token}
        new_money = 987654
        payload = {
            "path": str(self.save_path),
            "expectedSha256": self.initial_sha256,
            "data": make_sample_save(money=new_money),
        }
        status, raw = self._request("POST", "/api/save", body=payload, headers=headers)
        self.assertEqual(status, 200)
        parsed = json.loads(raw)
        self.assertTrue(parsed.get("ok"))

        backups = list(Path(self.tmpdir).glob("SaveData1.bytes.backup-*.bak"))
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_bytes(), self.initial_bytes)

        updated_decrypted = jingu_editor.decrypt_bytes(self.save_path.read_bytes())
        updated_data = json.loads(
            updated_decrypted.decode("utf-8-sig"),
            object_pairs_hook=OrderedDict,
        )
        self.assertEqual(
            jingu_editor.sdict_get(updated_data["m_itemDic"], 10001, 0),
            new_money,
        )

    def test_06_yangcheng_bool_and_concurrent_sha_guard(self):
        bad_save = make_sample_save()
        bad_save["m_yangCheng"] = 0
        errs = jingu_editor.validate_data(bad_save)
        self.assertTrue(any("m_yangCheng" in e for e in errs), f"Expected bool check error, got {errs}")

        missing = Path(self.tmpdir) / "nonexistent.bytes"
        with self.assertRaises(FileNotFoundError):
            jingu_editor.write_encrypted_json(
                str(missing),
                make_sample_save(),
                expected_sha256="0" * 64,
            )

        headers = {"X-JinGu-Token": self.token}
        barrier = threading.Barrier(2)
        results = []
        results_lock = threading.Lock()

        def worker(val):
            barrier.wait()
            st, raw = self._request(
                "POST",
                "/api/save",
                body={
                    "path": str(self.save_path),
                    "expectedSha256": self.initial_sha256,
                    "data": make_sample_save(money=val),
                },
                headers=headers,
            )
            with results_lock:
                results.append((st, json.loads(raw)))

        t1 = threading.Thread(target=worker, args=(777777,))
        t2 = threading.Thread(target=worker, args=(888888,))
        t1.start()
        t2.start()
        t1.join(timeout=10)
        t2.join(timeout=10)

        statuses = sorted(st for st, _ in results)
        self.assertEqual(statuses, [200, 409], f"Expected one 200 and one 409, got {results}")

    def test_07_multiprocess_write_lock_conflict(self):
        import time

        target = Path(self.tmpdir) / "mp_race.bytes"
        seed = make_sample_save(money=100)
        seed_info = jingu_editor.write_encrypted_json(str(target), seed)
        go_flag = Path(self.tmpdir) / "go.flag"

        child_code = "\n".join([
            "import pathlib, sys, time",
            f"sys.path.insert(0, {str(ROOT_DIR)!r})",
            "import jingu_editor",
            "go = pathlib.Path(sys.argv[1])",
            "while not go.exists():",
            "    time.sleep(0.01)",
            "data = jingu_editor.default_save_data()",
            "jingu_editor.sdict_set(data['m_itemDic'], 10001, int(sys.argv[4]))",
            "jingu_editor.write_encrypted_json(sys.argv[2], data, expected_sha256=sys.argv[3])",
            "print('OK')",
        ])
        p1 = subprocess.Popen(
            [sys.executable, "-c", child_code, str(go_flag), str(target), seed_info["sha256"], "111"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        p2 = subprocess.Popen(
            [sys.executable, "-c", child_code, str(go_flag), str(target), seed_info["sha256"], "222"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        time.sleep(0.15)
        go_flag.write_text("1", encoding="utf-8")
        out1, err1 = p1.communicate(timeout=15)
        out2, err2 = p2.communicate(timeout=15)

        rcs = sorted([p1.returncode, p2.returncode])
        self.assertEqual(rcs, [0, 1], f"Expected one 0 and one 1, got rc1={p1.returncode} ({err1}), rc2={p2.returncode} ({err2})")
        dec = jingu_editor.decrypt_bytes(target.read_bytes())
        final_obj = json.loads(dec.decode("utf-8-sig"), object_pairs_hook=OrderedDict)
        self.assertIn(jingu_editor.sdict_get(final_obj["m_itemDic"], 10001, 0), (111, 222))


if __name__ == "__main__":
    unittest.main()
