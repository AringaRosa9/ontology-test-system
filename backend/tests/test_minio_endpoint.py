import os
import sys

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from main import _format_minio_error, _normalize_minio_connection


def test_normalize_plain_minio_endpoint_preserves_secure_flag():
    endpoint, secure = _normalize_minio_connection("aicoe.chinasoftinc.com:9000", False)
    assert endpoint == "aicoe.chinasoftinc.com:9000"
    assert secure is False


def test_normalize_http_url_strips_scheme_and_forces_http():
    endpoint, secure = _normalize_minio_connection("http://aicoe.chinasoftinc.com:9000", True)
    assert endpoint == "aicoe.chinasoftinc.com:9000"
    assert secure is False


def test_normalize_https_url_strips_scheme_and_forces_https():
    endpoint, secure = _normalize_minio_connection("https://aicoe.chinasoftinc.com:9000", False)
    assert endpoint == "aicoe.chinasoftinc.com:9000"
    assert secure is True


def test_rejects_endpoint_paths():
    with pytest.raises(HTTPException) as excinfo:
        _normalize_minio_connection("http://aicoe.chinasoftinc.com:9000/minio", False)
    assert excinfo.value.status_code == 400
    assert "不要包含路径" in excinfo.value.detail


def test_formats_sdk_path_error_message():
    message = _format_minio_error(ValueError("path in endpoint is not allowed"))
    assert "主机:端口" in message
