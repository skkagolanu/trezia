import gzip
import hashlib
import io
import json
import os
import unittest
from unittest.mock import patch

from aws_lab.src.handlers import lambda_handler, process_object
from aws_lab.src.recovery import InvalidSnapshot


SOCIETY = '11111111-1111-4111-8111-111111111111'


class MemoryTable:
    def __init__(self):
        self.items = {}
        self.puts = 0
        self.updates = []

    def get_item(self, **kwargs):
        row = self.items.get(kwargs['Key']['object_id'])
        return {'Item': row} if row else {}

    def put_item(self, **kwargs):
        self.puts += 1
        row = kwargs['Item']; self.items[row['object_id']] = row

    def update_item(self, **kwargs):
        self.updates.append(kwargs)


class HandlerTests(unittest.TestCase):
    def setUp(self):
        self.table = MemoryTable()
        self.env = {'LAB_BUCKET': 'lab-only', 'LAB_QUEUE_ARN': 'queue-only'}
        self.event = {'eventSource': 'aws:s3', 'eventName': 'ObjectCreated:Put',
                      's3': {'bucket': {'name': 'lab-only'}, 'object': {
                          'key': 'input/'+SOCIETY+'/test.json.gz', 'versionId': 'immutable-v1'}}}
        data = {'manifest': {'format': 'trezia-offboarding', 'version': 4, 'society_id': SOCIETY},
                'exported_at': '2026-10-29T00:00:00Z', 'society': {'id': SOCIETY},
                'society_config': {'society_id': SOCIETY},
                **{name: [] for name in ['units', 'residents', 'payments', 'expenditures', 'bills', 'audit_log']}}
        self.raw = gzip.compress(json.dumps(data).encode())

    def storage(self):
        raw = self.raw
        class Storage:
            reads = 0
            def get_object(self, **kwargs):
                self.reads += 1
                return {'Body': io.BytesIO(raw), 'ContentLength': len(raw),
                        'Metadata': {'wire-sha256': hashlib.sha256(raw).hexdigest()}}
        return Storage()

    def test_duplicate_avoids_object_read_and_repairs_latest_pointer(self):
        s3 = self.storage()
        first = process_object(self.event, s3, self.table, bucket='lab-only', now=1793270000)
        second = process_object(self.event, s3, self.table, bucket='lab-only', now=1793270001)
        self.assertEqual(first['status'], 'COMPLETED')
        self.assertEqual(second['status'], 'DUPLICATE_COMPLETED')
        self.assertEqual(s3.reads, 1)
        self.assertEqual(self.table.puts, 1)
        self.assertEqual(len(self.table.updates), 2)

    def test_other_bucket_rejected_before_io(self):
        with self.assertRaises(InvalidSnapshot):
            process_object(self.event, self.storage(), self.table, bucket='other', now=1793270000)
        self.assertEqual(self.table.puts, 0)

    def message(self, identity, body):
        return {'messageId': identity, 'eventSource': 'aws:sqs', 'eventSourceARN': 'queue-only',
                'body': json.dumps(body)}

    def test_mixed_batch_only_failed_item_is_retried(self):
        event = {'Records': [self.message('bad', {'Records': []}),
                             self.message('good', {'Records': [self.event]})]}
        with patch.dict(os.environ, self.env), patch('aws_lab.src.handlers._clients',
                                                    return_value=(self.storage(), self.table, None)):
            result = lambda_handler(event, None)
        self.assertEqual(result, {'batchItemFailures': [{'itemIdentifier': 'bad'}]})
        self.assertEqual(self.table.puts, 1)

    def test_configuration_notification_is_not_poison(self):
        body = {'Event': 's3:TestEvent', 'Service': 'Amazon S3', 'Bucket': 'lab-only'}
        with patch.dict(os.environ, self.env), patch('aws_lab.src.handlers._clients',
                                                    return_value=(self.storage(), self.table, None)):
            result = lambda_handler({'Records': [self.message('config', body)]}, None)
        self.assertEqual(result, {'batchItemFailures': []})
        self.assertEqual(self.table.puts, 0)


if __name__ == '__main__':
    unittest.main()
