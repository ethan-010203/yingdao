#!/usr/bin/env python3
"""Run one isolated Yingdao cloud-to-cloud migration smoke test."""

from __future__ import annotations

import base64
import getpass
import json
import resource
import shutil
import sys
import tempfile
import time
import uuid
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any

import requests
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import padding


LOGIN_URL = "https://api.yingdao.com/oauth/token"
API_BASE_URL = "https://api.winrobot360.com"
MAX_BOT_BYTES = 50 * 1024 * 1024
MAX_PACKAGE_JSON_BYTES = 32 * 1024 * 1024
MAX_UNCOMPRESSED_BYTES = 300 * 1024 * 1024
MAX_ZIP_ENTRIES = 10_000

RSA_PUBLIC_KEY_PEM = b"""-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCte0XfPY9GUpQ3ZasH1kVbDhRw
yRAqWSeyxj290OqFHtyiZ+5SQjrEr79mk0hcZqV03fb5oYf385E3gopSERIKxVQy
GoloNeDgyLu7rHHWMPo8KPDpUBlpRpHlGMgBNzJZ2BI6p7LvGAhCoA7XRuetyTlA
W6EbSXBpSu1sNGBhkQIDAQAB
-----END PUBLIC KEY-----
"""

COMMON_HEADERS = {
    "Connection": "Keep-Alive",
    "Accept": "*/*",
    "Accept-Language": "zh-cn",
    "User-Agent": "Mozilla/4.0 (compatible; MSIE 9.0; Windows NT 6.1)",
}


class SmokeTestError(RuntimeError):
    pass


def mask_username(username: str) -> str:
    if len(username) <= 4:
        return "*" * len(username)
    return f"{username[:2]}{'*' * (len(username) - 4)}{username[-2:]}"


def parse_json_response(response: requests.Response, action: str) -> dict[str, Any]:
    try:
        response.raise_for_status()
        text = response.text.strip()
        if "}{" in text:
            text = text.split("}{", 1)[0] + "}"
        data = json.loads(text)
    except (requests.RequestException, json.JSONDecodeError) as exc:
        raise SmokeTestError(f"{action} failed: HTTP {response.status_code}") from exc
    if not isinstance(data, dict):
        raise SmokeTestError(f"{action} returned an unexpected response")
    return data


def encrypt_password(password: str) -> str:
    public_key = serialization.load_pem_public_key(RSA_PUBLIC_KEY_PEM)
    encrypted = public_key.encrypt(password.encode("utf-8"), padding.PKCS1v15())
    return base64.b64encode(encrypted).decode("ascii")


def login(session: requests.Session, username: str, password: str) -> str:
    headers = {
        **COMMON_HEADERS,
        "Content-Type": "application/x-www-form-urlencoded; Charset=UTF-8",
        "Authorization": "basic c25zOlQ3c3ZGY0lMNGZvUGoxajk=",
        "Referer": LOGIN_URL,
        "Host": "api.yingdao.com",
    }
    response = session.post(
        LOGIN_URL,
        headers=headers,
        data={
            "username": username,
            "password": encrypt_password(password),
            "crypt": "metal",
            "grant_type": "password",
            "scope": "all",
        },
        timeout=(10, 30),
    )
    result = parse_json_response(response, "Login")
    token = result.get("access_token")
    if not result.get("success") or not isinstance(token, str) or not token:
        raise SmokeTestError(f"Login rejected: {result.get('msg', 'unknown error')}")
    return token


def auth_headers(token: str) -> dict[str, str]:
    return {
        **COMMON_HEADERS,
        "Content-Type": "application/json; charset=utf-8",
        "Authorization": f"bearer {token}",
    }


def list_flows(session: requests.Session, token: str) -> list[dict[str, Any]]:
    flows: list[dict[str, Any]] = []
    page = 1
    pages = 1
    while page <= pages:
        response = session.post(
            f"{API_BASE_URL}/api/client/app/develop/list",
            headers=auth_headers(token),
            json={
                "groupId": None,
                "name": "",
                "pageType": 1,
                "pageDTO": {"page": page, "size": 30},
                "sortBy": "4",
            },
            timeout=(10, 30),
        )
        result = parse_json_response(response, "List flows")
        if not result.get("success"):
            raise SmokeTestError("The source account flow list request was rejected")
        page_flows = result.get("data") or []
        if not isinstance(page_flows, list):
            raise SmokeTestError("The source account returned an invalid flow list")
        flows.extend(flow for flow in page_flows if isinstance(flow, dict))
        page_info = result.get("page") or {}
        pages = int(page_info.get("pages") or 1)
        page += 1
    return flows


def get_app_detail(
    session: requests.Session, token: str, app_id: str
) -> dict[str, Any]:
    response = session.get(
        f"{API_BASE_URL}/api/client/app/develop/app/detail",
        headers=auth_headers(token),
        params={"appId": app_id, "checkAppRecycle": "True"},
        timeout=(10, 30),
    )
    result = parse_json_response(response, "Get app detail")
    detail = result.get("data")
    if not isinstance(detail, dict):
        raise SmokeTestError("The selected flow did not return app details")
    return detail


def download_bot(session: requests.Session, url: str, destination: Path) -> int:
    with session.get(url, headers=COMMON_HEADERS, stream=True, timeout=(10, 600)) as response:
        response.raise_for_status()
        advertised_size = int(response.headers.get("Content-Length") or 0)
        if advertised_size > MAX_BOT_BYTES:
            raise SmokeTestError(
                f"The test bot is {advertised_size / 1024 / 1024:.1f} MB; "
                "the smoke-test limit is 50 MB"
            )
        downloaded = 0
        with destination.open("wb") as output:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if not chunk:
                    continue
                downloaded += len(chunk)
                if downloaded > MAX_BOT_BYTES:
                    raise SmokeTestError("The downloaded bot exceeded the 50 MB test limit")
                output.write(chunk)
    return downloaded


def rewrite_bot(source: Path, destination: Path, new_app_id: str, new_name: str) -> dict[str, Any]:
    with zipfile.ZipFile(source, "r") as source_zip:
        entries = source_zip.infolist()
        if len(entries) > MAX_ZIP_ENTRIES:
            raise SmokeTestError("The bot contains too many ZIP entries")
        uncompressed_size = sum(entry.file_size for entry in entries)
        if uncompressed_size > MAX_UNCOMPRESSED_BYTES:
            raise SmokeTestError("The uncompressed bot exceeds the 300 MB test limit")

        package_entry = next(
            (entry for entry in entries if entry.filename.lstrip("./") == "package.json"),
            None,
        )
        if package_entry is None:
            raise SmokeTestError("package.json was not found in the bot")
        if package_entry.file_size > MAX_PACKAGE_JSON_BYTES:
            raise SmokeTestError("package.json exceeds the 32 MB test limit")

        with source_zip.open(package_entry, "r") as package_file:
            package_data = json.load(package_file)
        if not isinstance(package_data, dict):
            raise SmokeTestError("package.json is not a JSON object")

        package_data["uuid"] = new_app_id
        package_data["name"] = new_name
        package_data["encrypt_bot"] = False
        package_json = json.dumps(
            package_data, ensure_ascii=False, indent=2
        ).encode("utf-8")

        with zipfile.ZipFile(destination, "w", allowZip64=True) as target_zip:
            for entry in entries:
                if entry.is_dir():
                    target_zip.writestr(entry, b"")
                elif entry.filename == package_entry.filename:
                    target_zip.writestr(entry, package_json)
                else:
                    with source_zip.open(entry, "r") as source_file:
                        with target_zip.open(entry, "w", force_zip64=True) as target_file:
                            shutil.copyfileobj(source_file, target_file, length=1024 * 1024)
    return package_data


def get_upload_info(
    session: requests.Session, token: str, app_id: str, is_bot: bool
) -> dict[str, Any]:
    response = session.post(
        f"{API_BASE_URL}/api/client/app/file/assignUploadUrl",
        headers=auth_headers(token),
        json={
            "appId": app_id,
            "appType": "app",
            "version": "",
            "isBot": "true" if is_bot else "false",
        },
        timeout=(10, 30),
    )
    result = parse_json_response(response, "Assign upload URL")
    info = result.get("data")
    if not isinstance(info, dict) or not info.get("uploadUrl"):
        raise SmokeTestError("The target account did not return an upload URL")
    return info


def upload_file(session: requests.Session, url: str, path: Path) -> None:
    size = path.stat().st_size
    with path.open("rb") as body:
        response = session.put(
            url,
            headers={**COMMON_HEADERS, "Content-Length": str(size)},
            data=body,
            timeout=(10, 600),
        )
    if not response.ok:
        raise SmokeTestError(f"Bot upload failed: HTTP {response.status_code}")


def upload_json(session: requests.Session, url: str, package_data: dict[str, Any]) -> None:
    content = json.dumps(package_data, ensure_ascii=False, indent=2).encode("utf-8")
    response = session.put(
        url,
        headers={**COMMON_HEADERS, "Content-Length": str(len(content))},
        data=content,
        timeout=(10, 600),
    )
    if not response.ok:
        raise SmokeTestError(f"Package JSON upload failed: HTTP {response.status_code}")


def create_app(
    session: requests.Session,
    token: str,
    app_id: str,
    package_data: dict[str, Any],
    package_md5: str,
) -> None:
    flows = package_data.get("flows")
    flow_count = len(flows) if isinstance(flows, list) else 0
    response = session.post(
        f"{API_BASE_URL}/api/client/app/develop/create",
        headers=auth_headers(token),
        json={
            "appId": app_id,
            "appPackage": {
                "activities": [],
                "appFlowParamList": [],
                "appIcon": package_data.get("icon") or "",
                "appType": package_data.get("robot_type") or "app",
                "customItems": package_data.get("customItems")
                or {
                    "gifUrl": "",
                    "imageName": "",
                    "imageUrl": "",
                    "uiaType": "PC",
                    "videoUrl": "",
                },
                "description": package_data.get("description") or "",
                "elementLibraryCodes": [],
                "enableViewSource": "false",
                "externalDependencies": package_data.get("external_dependencies") or [],
                "instruction": package_data.get("instruction") or "",
                "internalDependencies": package_data.get("internaldependencies") or [],
                "internalautodependencies": package_data.get("internalautodependencies") or [],
                "ipaasDependencies": package_data.get("ipaasDependencies") or [],
                "name": package_data.get("name") or "Unnamed",
                "packageCode": "",
                "statistics": {
                    "blockCount": flow_count,
                    "flowCount": flow_count,
                    "magicBlockCount": 0,
                    "sourceLineCount": 0,
                },
                "uiTags": "",
                "uiaType": package_data.get("uia_type") or "PC",
                "videoUrl": package_data.get("videoName") or "",
            },
            "elementLibraryStatus": 0,
            "groupId": "",
            "packageMd5": package_md5,
        },
        timeout=(10, 60),
    )
    result = parse_json_response(response, "Create app")
    if not result.get("success") and str(result.get("code")) != "200":
        raise SmokeTestError(f"Create app rejected: {result.get('msg', 'unknown error')}")


def select_flow(flows: list[dict[str, Any]]) -> dict[str, Any]:
    if not flows:
        raise SmokeTestError("The source account has no cloud flows")
    print(f"\nSource account returned {len(flows)} flows:")
    for index, flow in enumerate(flows, start=1):
        name = flow.get("appName") or "Unnamed"
        updated = flow.get("updateTime") or "unknown time"
        print(f"  {index:>3}. {name} ({updated})")
    while True:
        raw = input("\nSelect exactly one flow number: ").strip()
        try:
            selected = int(raw)
        except ValueError:
            selected = 0
        if 1 <= selected <= len(flows):
            return flows[selected - 1]
        print("Invalid selection.")


def main() -> int:
    print("Yingdao server migration smoke test")
    print("Credentials and tokens are not written to disk or printed.")
    print("The test creates one new flow in the target account and never deletes data.\n")

    source_username = input("Source username: ").strip()
    source_password = getpass.getpass("Source password: ")
    if not source_username or not source_password:
        raise SmokeTestError("Source credentials are required")

    started_at = time.monotonic()
    with requests.Session() as session:
        source_token = login(session, source_username, source_password)
        source_password = ""
        print(f"Source login succeeded: {mask_username(source_username)}")

        flows = list_flows(session, source_token)
        selected_flow = select_flow(flows)
        source_app_id = str(selected_flow.get("appId") or "")
        source_name = str(selected_flow.get("appName") or "Unnamed")
        if not source_app_id:
            raise SmokeTestError("The selected flow has no appId")

        target_username = input("Target username: ").strip()
        target_password = getpass.getpass("Target password: ")
        if not target_username or not target_password:
            raise SmokeTestError("Target credentials are required")
        if source_username == target_username:
            raise SmokeTestError("Source and target accounts must be different for this test")

        target_token = login(session, target_username, target_password)
        target_password = ""
        print(f"Target login succeeded: {mask_username(target_username)}")

        new_app_id = str(uuid.uuid4())
        new_name = f"{source_name}_web_smoke_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        print(f"\nSelected flow: {source_name}")
        print(f"New target name: {new_name}")
        if input('Type MIGRATE to create this test flow: ').strip() != "MIGRATE":
            print("Cancelled. No flow was created.")
            return 2

        with tempfile.TemporaryDirectory(prefix="yingdao-smoke-") as temp_dir:
            source_path = Path(temp_dir) / "source.bot"
            target_path = Path(temp_dir) / "target.bot"

            detail = get_app_detail(session, source_token, source_app_id)
            bot_url = (
                detail.get("botReadUrl")
                or detail.get("packageBotUrl")
                or detail.get("packageSchemaUrl")
            )
            if not isinstance(bot_url, str) or not bot_url:
                raise SmokeTestError("The selected flow has no downloadable bot URL")

            download_started = time.monotonic()
            source_size = download_bot(session, bot_url, source_path)
            download_seconds = time.monotonic() - download_started
            print(
                f"Downloaded {source_size / 1024 / 1024:.2f} MB "
                f"in {download_seconds:.2f}s"
            )

            rewrite_started = time.monotonic()
            package_data = rewrite_bot(source_path, target_path, new_app_id, new_name)
            rewrite_seconds = time.monotonic() - rewrite_started
            target_size = target_path.stat().st_size
            print(
                f"Repacked {target_size / 1024 / 1024:.2f} MB "
                f"in {rewrite_seconds:.2f}s"
            )

            bot_upload = get_upload_info(session, target_token, new_app_id, True)
            json_upload = get_upload_info(session, target_token, new_app_id, False)
            upload_started = time.monotonic()
            upload_file(session, str(bot_upload["uploadUrl"]), target_path)
            upload_json(session, str(json_upload["uploadUrl"]), package_data)
            upload_seconds = time.monotonic() - upload_started

            package_md5 = str(json_upload.get("fileKeyMd5") or "")
            if not package_md5:
                raise SmokeTestError("The JSON upload assignment did not include fileKeyMd5")
            create_app(session, target_token, new_app_id, package_data, package_md5)
            verification = get_app_detail(session, target_token, new_app_id)
            if str(verification.get("appId") or "") != new_app_id:
                raise SmokeTestError("The target account could not verify the new flow")

        elapsed = time.monotonic() - started_at
        peak_rss_mb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024
        print("\nSMOKE TEST PASSED")
        print(f"Created flow: {new_name}")
        print(f"Uploaded in: {upload_seconds:.2f}s")
        print(f"Total time: {elapsed:.2f}s")
        print(f"Peak RSS: {peak_rss_mb:.1f} MB")
        print("Temporary files were removed.")
        return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("\nCancelled. Temporary files were removed.", file=sys.stderr)
        raise SystemExit(130)
    except SmokeTestError as exc:
        print(f"\nSMOKE TEST FAILED: {exc}", file=sys.stderr)
        raise SystemExit(1)
    except requests.RequestException as exc:
        print(f"\nSMOKE TEST FAILED: network error ({type(exc).__name__})", file=sys.stderr)
        raise SystemExit(1)
