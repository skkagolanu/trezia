"""Validate bounded gzip snapshots, society-scoped row content and immutable archive identity."""

import gzip
import hashlib
import io
import json
import math
import re
from decimal import Decimal, InvalidOperation
from datetime import datetime
from typing import Any
from urllib.parse import unquote_plus
from uuid import UUID

MAX_COMPRESSED = 1024 * 1024
MAX_EXPANDED = 8 * 1024 * 1024
FORMAT = "trezia-offboarding"
VERSION = 4


class InvalidSnapshot(ValueError):
    """A bounded archive fails a declared snapshot or society invariant."""


def object_identity(bucket: str, key: str, version: str) -> str:
    if not bucket or not key or not version or version == "null":
        raise InvalidSnapshot("An immutable S3 version is required")
    return hashlib.sha256(json.dumps([bucket, key, version], separators=(",", ":")).encode()).hexdigest()


def validate_key(encoded_key: str, prefix: str = "input/") -> tuple[str, str]:
    key = unquote_plus(encoded_key)
    if not key.startswith(prefix):
        raise InvalidSnapshot("Object is outside the allowed input prefix")
    parts = key[len(prefix):].split("/")
    if len(parts) != 2 or not re.fullmatch(r"[A-Za-z0-9_-]+\.json\.gz", parts[1]):
        raise InvalidSnapshot("Expected input/<society UUID>/<snapshot>.json.gz")
    try:
        society = str(UUID(parts[0]))
    except ValueError as exc:
        raise InvalidSnapshot("Object society is not a UUID") from exc
    if parts[0] != society:
        raise InvalidSnapshot("Society UUID must be canonical")
    return key, society


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise InvalidSnapshot("Duplicate JSON key")
        result[key] = value
    return result


def _bad_constant(value):
    raise InvalidSnapshot("Non-finite JSON number")


def _money(value: Any) -> Decimal:
    # Snapshot numeric values are a boundary: no floats are summed as money.
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        raise InvalidSnapshot("Invalid payment amount")
    if isinstance(value, float) and not math.isfinite(value):
        raise InvalidSnapshot("Invalid payment amount")
    try:
        result = Decimal(str(value))
    except InvalidOperation as exc:
        raise InvalidSnapshot("Invalid payment amount") from exc
    try:
        if not result.is_finite() or result != result.quantize(Decimal("0.01")):
            raise InvalidSnapshot("Payment amount must have at most two decimal places")
    except InvalidOperation as exc:
        raise InvalidSnapshot("Payment amount exceeds supported precision") from exc
    return result


def verify_archive(raw: bytes, society: str, expected_wire_sha256: str) -> dict[str, Any]:
    if not raw or len(raw) > MAX_COMPRESSED:
        raise InvalidSnapshot("Compressed archive is empty or oversized")
    if not re.fullmatch(r"[0-9a-f]{64}", expected_wire_sha256):
        raise InvalidSnapshot("Missing wire SHA-256")
    digest = hashlib.sha256(raw).hexdigest()
    if digest != expected_wire_sha256:
        raise InvalidSnapshot("Archive checksum mismatch")
    try:
        with gzip.GzipFile(fileobj=io.BytesIO(raw)) as archive:
            expanded = archive.read(MAX_EXPANDED + 1)
        if len(expanded) > MAX_EXPANDED:
            raise InvalidSnapshot("Expanded archive exceeds the size bound")
        data = json.loads(expanded.decode("utf-8"), object_pairs_hook=_unique_object, parse_constant=_bad_constant)
    except (OSError, EOFError, UnicodeError, json.JSONDecodeError) as exc:
        raise InvalidSnapshot("Invalid gzip/UTF-8/JSON archive") from exc
    if not isinstance(data, dict):
        raise InvalidSnapshot("Snapshot must be an object")
    manifest = data.get("manifest")
    if not isinstance(manifest, dict) or manifest.get("format") != FORMAT or type(manifest.get("version")) is not int:
        raise InvalidSnapshot("Unsupported snapshot manifest")
    if manifest["version"] != VERSION or manifest.get("society_id") != society:
        raise InvalidSnapshot("Unsupported version or wrong manifest society")
    for field, identity in (("society", "id"), ("society_config", "society_id")):
        if not isinstance(data.get(field), dict) or data[field].get(identity) != society:
            raise InvalidSnapshot("Wrong or missing society/config record")
    try:
        cutoff = datetime.fromisoformat(str(data.get("exported_at", "")).replace("Z", "+00:00"))
        if cutoff.tzinfo is None:
            raise ValueError("Missing timezone")
        source_epoch = int(cutoff.timestamp())
    except ValueError as exc:
        raise InvalidSnapshot("Missing or invalid snapshot source time") from exc
    required = ("units", "residents", "payments", "expenditures", "bills", "audit_log")
    if any(not isinstance(data.get(field), list) for field in required):
        raise InvalidSnapshot("Missing required accounting table arrays")
    counts = {}
    for table, rows in data.items():
        if not isinstance(rows, list):
            continue
        if any(not isinstance(row, dict) for row in rows):
            raise InvalidSnapshot("Snapshot table arrays must contain records")
        identities = [row["id"] for row in rows if "id" in row]
        # Trezia audit_log uses PostgreSQL bigint identity; ordinary entity IDs
        # are UUID strings. bool is deliberately excluded from the integer case.
        if table == "audit_log":
            valid_ids = all(type(value) is int and 0 < value < 2**63 for value in identities)
        else:
            valid_ids = all(isinstance(value, str) for value in identities)
        if not valid_ids or len(set(identities)) != len(identities):
            raise InvalidSnapshot("Invalid or duplicate row IDs")
        if any("society_id" in row and row["society_id"] != society for row in rows):
            raise InvalidSnapshot("Cross-society row")
        counts[table] = len(rows)
    for table in required:
        if any(row.get("society_id") != society for row in data[table]):
            raise InvalidSnapshot("Accounting row lacks its owning society")
    total = sum((_money(row.get("amount_paid")) for row in data["payments"]), Decimal("0.00"))
    return {
        "society_id": society,
        "source_epoch": source_epoch,
        "wire_sha256": digest,
        "compressed_bytes": len(raw),
        "expanded_bytes": len(expanded),
        "table_counts": counts,
        "payment_total": format(total, ".2f"),
        "validation_scope": "archive checksum and declared accounting-row scope; not full restore certification",
    }
