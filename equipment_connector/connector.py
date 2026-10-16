"""User-mode, transient FAM Equipment Connector for a Windows VDI.

No service, elevated privilege, listening port, token, or local credential file
is required. The operator signs in with their normal FAM account each run; the
process keeps the HTTPS session only in memory and polls FAM over outbound TLS.
"""
from __future__ import annotations

import getpass
import http.cookiejar
import json
import os
from pathlib import Path
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request

from equipment_probe import execute

DEFAULT_ORIGIN = "https://communication-02.toosbank.corp"


class ConnectorError(RuntimeError):
    pass


def origin(value: str) -> str:
    parsed = urllib.parse.urlparse(value.strip())
    if parsed.scheme != "https" or not parsed.netloc or parsed.path not in {"", "/"} or parsed.params or parsed.query or parsed.fragment or parsed.username or parsed.password:
        raise ConnectorError("آدرس FAM باید HTTPS origin باشد؛ مانند https://communication-02.toosbank.corp")
    return parsed.geturl().rstrip("/")


def trusted_context():
    """Use normal CA validation plus the Windows Root certificate store."""
    context = ssl.create_default_context()
    if os.name == "nt":
        for certificate, encoding, _trust in ssl.enum_certificates("ROOT"):
            if encoding == "x509_asn":
                try:
                    context.load_verify_locations(cadata=ssl.DER_cert_to_PEM_cert(certificate))
                except ssl.SSLError:
                    pass
    return context


class FAM:
    def __init__(self, base: str):
        self.base = base
        self.csrf = ""
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()),
            urllib.request.HTTPSHandler(context=trusted_context()),
        )

    def request(self, method: str, path: str, body=None, timeout=40):
        data = None if body is None else json.dumps(body, separators=(",", ":")).encode("utf-8")
        headers = {"Accept": "application/json", "User-Agent": "FAM-Equipment-Connector/1"}
        if data is not None:
            headers.update({"Content-Type": "application/json", "Origin": self.base, "X-FAM-CSRF": self.csrf})
        request = urllib.request.Request(self.base + path, data=data, headers=headers, method=method)
        try:
            with self.opener.open(request, timeout=timeout) as response:
                raw = response.read(65536)
        except urllib.error.HTTPError as exc:
            try:
                message = json.loads(exc.read(65536).decode("utf-8")).get("error")
            except (UnicodeDecodeError, json.JSONDecodeError):
                message = None
            raise ConnectorError(message or "پاسخ معتبر از FAM دریافت نشد.") from None
        except (urllib.error.URLError, TimeoutError, ssl.SSLError):
            raise ConnectorError("اتصال HTTPS امن به FAM برقرار نشد؛ آدرس، شبکه و گواهی VDI را بررسی کنید.") from None
        try:
            value = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ConnectorError("پاسخ FAM معتبر نیست.") from None
        if not isinstance(value, dict):
            raise ConnectorError("پاسخ FAM معتبر نیست.")
        return value

    def login(self, username: str, password: str):
        result = self.request("POST", "/api/login", {"username": username, "password": password})
        self.csrf = result.get("csrf", "")
        if not isinstance(self.csrf, str) or not self.csrf:
            raise ConnectorError("ورود Connector به FAM تأیید نشد.")
        return result.get("user", {})


def main():
    print("FAM Equipment Connector — بدون نصب و بدون دسترسی Administrator")
    entered = input(f"آدرس FAM [{DEFAULT_ORIGIN}]: ").strip() or DEFAULT_ORIGIN
    base = origin(entered)
    username = input("نام کاربری FAM: ").strip()
    password = getpass.getpass("رمز FAM: ")
    if not username or not password:
        raise ConnectorError("نام کاربری و رمز FAM لازم است.")
    client = FAM(base)
    user = client.login(username, password)
    print("Connector برای «{}» متصل شد. این پنجره را باز نگه دارید.".format(user.get("name") or username))
    print("برای توقف امن Ctrl+C را بزنید. هیچ رمز تجهیزی ذخیره نمی‌شود.")
    while True:
        try:
            claimed = client.request("POST", "/api/equipment/connector/claim", {}, timeout=35)
            job = claimed.get("job")
            if job is None:
                continue
            if not isinstance(job, dict) or not isinstance(job.get("jobId"), str):
                raise ConnectorError("درخواست Connector معتبر نیست.")
            job_id = job.pop("jobId")
            # execute() exposes only bounded Netmiko status/recovery operations.
            result = execute(job)
            client.request("POST", "/api/equipment/connector/complete", {"jobId": job_id, "result": result}, timeout=35)
        except ConnectorError as exc:
            print("Connector متوقف شد: " + str(exc))
            return 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("\nConnector متوقف شد.")
        raise SystemExit(0)
    except ConnectorError as exc:
        print("Connector اجرا نشد: " + str(exc))
        raise SystemExit(1)
