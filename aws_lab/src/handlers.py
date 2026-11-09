"""AWS adapters. Credentials/configuration belong exclusively to the lab roles."""

import json
import os
import time
from functools import lru_cache

from aws_lab.src.recovery import InvalidSnapshot, MAX_COMPRESSED, object_identity, validate_key, verify_archive


def _conditional(error):
    return getattr(error, "response", {}).get("Error", {}).get("Code") == "ConditionalCheckFailedException"


@lru_cache(maxsize=1)
def _clients():
    import boto3  # Provided by the Lambda Python runtime; imported lazily for pure unit tests.
    return boto3.client("s3"), boto3.resource("dynamodb").Table(os.environ["LAB_TABLE"]), boto3.client("cloudwatch")


def _latest(table, record):
    # Duplicate delivery repairs a crash between the completed row and this pointer.
    try:
        table.update_item(
            Key={"object_id": "LATEST#" + record["society_id"]},
            UpdateExpression="SET source_epoch=:source, verified_epoch=:verified, version_identity=:identity, expires_at=:expiry",
            ConditionExpression="attribute_not_exists(source_epoch) OR source_epoch <= :source",
            ExpressionAttributeValues={":source": record["source_epoch"], ":verified": record["verified_epoch"],
                                       ":identity": record["object_id"], ":expiry": record["expires_at"]},
        )
    except Exception as error:
        if not _conditional(error):
            raise


def process_object(event, s3, table, *, bucket, now):
    started = time.perf_counter()
    cpu_started = time.process_time()
    if event.get("eventSource") != "aws:s3" or not str(event.get("eventName", "")).startswith("ObjectCreated:"):
        raise InvalidSnapshot("Expected an S3 ObjectCreated notification")
    item = event.get("s3", {})
    if item.get("bucket", {}).get("name") != bucket:
        raise InvalidSnapshot("Unexpected bucket")
    obj = item.get("object", {})
    key, society = validate_key(obj.get("key", ""))
    identity = object_identity(bucket, key, obj.get("versionId", ""))
    previous = table.get_item(Key={"object_id": identity}, ConsistentRead=True).get("Item")
    if previous:
        if previous.get("status") != "COMPLETED" or previous.get("society_id") != society:
            raise InvalidSnapshot("Existing verification identity is inconsistent")
        _latest(table, previous)
        return {"object_id": identity, "status": "DUPLICATE_COMPLETED",
                "processing_ms": (time.perf_counter() - started) * 1000,
                "process_cpu_ms": (time.process_time() - cpu_started) * 1000}
    response = s3.get_object(Bucket=bucket, Key=key, VersionId=obj["versionId"])
    body = response["Body"]
    try:
        if response.get("ContentLength", MAX_COMPRESSED + 1) > MAX_COMPRESSED:
            raise InvalidSnapshot("Compressed archive exceeds the bound")
        raw = body.read(MAX_COMPRESSED + 1)
    finally:
        body.close()
    summary = verify_archive(raw, society, response.get("Metadata", {}).get("wire-sha256", ""))
    source_epoch = summary["source_epoch"]
    if source_epoch > now + 300:
        raise InvalidSnapshot("Snapshot source time is in the future")
    record = {"object_id": identity, "status": "COMPLETED", "source_epoch": source_epoch,
              "verified_epoch": now, "expires_at": now + 7 * 86400, **summary}
    try:
        table.put_item(Item=record, ConditionExpression="attribute_not_exists(object_id)")
    except Exception as error:
        if not _conditional(error):
            raise
        stored = table.get_item(Key={"object_id": identity}, ConsistentRead=True).get("Item", {})
        if stored.get("status") != "COMPLETED" or stored.get("wire_sha256") != summary["wire_sha256"]:
            raise InvalidSnapshot("Concurrent verification result is inconsistent") from error
        record = stored
    _latest(table, record)
    return {"object_id": identity, "status": "COMPLETED",
            "processing_ms": (time.perf_counter() - started) * 1000,
            "process_cpu_ms": (time.process_time() - cpu_started) * 1000,
            "completed_epoch_ms": time.time_ns() // 1_000_000}


def lambda_handler(event, context):
    s3, table, _ = _clients()
    failures = []
    for message in event.get("Records", []):
        message_id = message.get("messageId")
        if not message_id:
            raise InvalidSnapshot("Missing SQS message identity")
        try:
            if message.get("eventSource") != "aws:sqs" or message.get("eventSourceARN") != os.environ["LAB_QUEUE_ARN"]:
                raise InvalidSnapshot("Unexpected queue")
            body = message.get("body", "")
            if len(body.encode()) > 256 * 1024:
                raise InvalidSnapshot("Notification is oversized")
            notification = json.loads(body)
            if (notification.get("Event") == "s3:TestEvent"
                    and notification.get("Service") == "Amazon S3"
                    and notification.get("Bucket") == os.environ["LAB_BUCKET"]):
                print(json.dumps({"status": "S3_CONFIGURATION_TEST"}))
                continue
            records = notification.get("Records")
            if not isinstance(records, list) or not 1 <= len(records) <= 10:
                raise InvalidSnapshot("Missing/bounded S3 notifications")
            for record in records:
                result = process_object(record, s3, table, bucket=os.environ["LAB_BUCKET"], now=int(time.time()))
                print(json.dumps(result))
        except Exception as error:
            # Never log the snapshot, contact/financial data or exception body.
            print(json.dumps({"status": "RETRY", "message_id": message_id, "error_type": type(error).__name__}))
            failures.append({"itemIdentifier": message_id})
    return {"batchItemFailures": failures}


def freshness_handler(event, context):
    _, table, metrics = _clients()
    now = int(time.time())
    societies = json.loads(os.environ["LAB_SOCIETIES"])
    if not societies:
        raise InvalidSnapshot("Watchdog requires explicitly configured societies")
    max_age = int(os.environ.get("LAB_MAX_AGE_SECONDS", "64800"))
    stale = 0
    for society in societies:
        row = table.get_item(Key={"object_id": "LATEST#" + society}, ConsistentRead=True).get("Item", {})
        source = row.get("source_epoch")
        if not isinstance(source, (int, float)):
            # DynamoDB numeric values are Decimal at the boto3 resource boundary.
            from decimal import Decimal
            if not isinstance(source, Decimal):
                stale += 1
                continue
        if source > now + 300 or now - source > max_age:
            stale += 1
    metrics.put_metric_data(Namespace="TreziaRecoveryLab", MetricData=[{
        "MetricName": "StaleSocieties", "Value": stale, "Unit": "Count",
        "Dimensions": [{"Name": "Lab", "Value": os.environ["LAB_NAME"]}],
    }])
    print(json.dumps({"checked_societies": len(societies), "stale_societies": stale}))
    return {"checked_societies": len(societies), "stale_societies": stale}
