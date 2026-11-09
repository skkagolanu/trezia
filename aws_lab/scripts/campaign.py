"""Finite real-AWS verification campaign; never targets production resources."""

import argparse
import base64
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from decimal import Decimal
import gzip
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import time
import threading
from uuid import UUID, uuid4, uuid5

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from aws_lab.src.recovery import object_identity

SOCIETIES = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']
CONFIG = Config(connect_timeout=5, read_timeout=30, retries={'mode': 'standard', 'total_max_attempts': 3}, max_pool_connections=24)


def serial(value):
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    raise TypeError(type(value).__name__)


def write(name, value):
    p = Path('evidence')/name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(value, indent=2, default=serial)+'\n')


def distribution(values):
    values = sorted(values)
    if not values:
        return {'count': 0}
    return {'count': len(values), 'min': values[0], 'mean': sum(values)/len(values),
            'p50': values[math.ceil(.50*len(values))-1], 'p95': values[math.ceil(.95*len(values))-1],
            'p99': values[math.ceil(.99*len(values))-1], 'max': values[-1], 'method': 'nearest-rank'}


def fixture(society, payments, *, stale=False, cross_tenant=False):
    ns = UUID(society)
    identity = lambda text: str(uuid5(ns, text))
    now = time.time()-7200 if stale else time.time()
    data = {'manifest': {'format': 'trezia-offboarding', 'version': 4, 'society_id': society},
            'exported_at': datetime.fromtimestamp(now, timezone.utc).isoformat(),
            'society': {'id': society, 'name': 'Synthetic fixture'}, 'society_config': {'society_id': society},
            'units': [{'id': identity('unit'+str(i)), 'society_id': society, 'flat_number': str(i)} for i in range(55)],
            'residents': [], 'bills': [], 'expenditures': [], 'audit_log': [],
            'payments': [{'id': identity('payment'+str(i)), 'society_id': society,
                          'unit_id': identity('unit'+str(i % 55)), 'amount_paid': '1234.56'} for i in range(payments)]}
    if cross_tenant:
        data['payments'][0]['society_id'] = SOCIETIES[1]
    return gzip.compress(json.dumps(data, separators=(',', ':')).encode(), mtime=0)


class Lab:
    def __init__(self):
        self.outputs = json.loads(os.environ['LAB_OUTPUTS'])
        self.session = boto3.Session(region_name='ap-south-1')
        self.s3 = self.session.client('s3', config=CONFIG)
        self.ddb = self.session.client('dynamodb', config=CONFIG)
        self.sqs = self.session.client('sqs', config=CONFIG)
        self.functions = self.session.client('lambda', config=CONFIG)
        self.metrics = self.session.client('cloudwatch', config=CONFIG)
        self.logs = self.session.client('logs', config=CONFIG)
        self.bucket = self.outputs['Bucket']
        if not self.bucket.startswith('trezia-recovery-run-'):
            raise ValueError('Refusing non-lab bucket')
        actual = self.session.client('sts', config=CONFIG).get_caller_identity()['Account']
        if actual != os.environ['LAB_EXPECTED_ACCOUNT']:
            raise ValueError('AWS account is not the authorised lab account')

    def put(self, society, raw, label, *, digest=None, key=None):
        key = key or f'input/{society}/{label}-{uuid4().hex}.json.gz'
        start = time.time()
        response = self.s3.put_object(Bucket=self.bucket, Key=key, Body=raw, ContentType='application/gzip',
            Metadata={'wire-sha256': digest or hashlib.sha256(raw).hexdigest()})
        end = time.time()
        return {'object_id': object_identity(self.bucket, key, response['VersionId']), 'key': key,
                'version': response['VersionId'], 'society': society, 'wire_bytes': len(raw),
                'put_started_epoch': start, 'put_ack_epoch': end,
                'put_latency_ms': (end-start)*1000}

    def observe(self, uploaded, timeout=300):
        remaining = {row['object_id']: row for row in uploaded}
        deadline = time.monotonic()+timeout
        while remaining and time.monotonic()<deadline:
            ids = list(remaining)
            for offset in range(0, len(ids), 100):
                response = self.ddb.batch_get_item(RequestItems={self.outputs['Table']: {
                    'Keys': [{'object_id': {'S': value}} for value in ids[offset:offset+100]], 'ConsistentRead': True}})
                observed = time.time()
                for record in response.get('Responses', {}).get(self.outputs['Table'], []):
                    identity = record['object_id']['S']
                    if identity in remaining and record.get('status', {}).get('S')=='COMPLETED':
                        remaining[identity]['completion_observed_epoch'] = observed
                        remaining[identity]['completion_observed_ms'] = (observed-remaining[identity]['put_started_epoch'])*1000
                        remaining[identity]['verification_record'] = record
                        del remaining[identity]
            if remaining:
                time.sleep(.25)
        return list(remaining)

    def notification(self, row):
        return json.dumps({'Records': [{'eventSource': 'aws:s3', 'eventName': 'ObjectCreated:Put',
            's3': {'bucket': {'name': self.bucket}, 'object': {'key': row['key'], 'versionId': row['version']}}}]})

    def invoke(self, function, event):
        response = self.functions.invoke(FunctionName=function, Payload=json.dumps(event).encode(), LogType='Tail')
        with response['Payload'] as body:
            payload = json.loads(body.read())
        if response.get('FunctionError'):
            raise RuntimeError(payload)
        return payload, base64.b64decode(response.get('LogResult', '')).decode()

    def mapping(self, enabled):
        self.functions.update_event_source_mapping(UUID=self.outputs['Mapping'], Enabled=enabled)
        deadline=time.monotonic()+90
        target='Enabled' if enabled else 'Disabled'
        while time.monotonic()<deadline:
            if self.functions.get_event_source_mapping(UUID=self.outputs['Mapping'])['State']==target:
                return
            time.sleep(2)
        raise TimeoutError('Event-source mapping did not reach '+target)

    def inventory(self, label):
        config = self.functions.get_function_configuration(FunctionName=self.outputs['Verifier'])
        # Deliberately retain no AWS environment variables or arbitrary configuration secrets.
        write(label+'-runtime.json', {k: config.get(k) for k in ['Runtime', 'MemorySize', 'Timeout',
            'CodeSha256', 'RevisionId', 'Architectures', 'LastModified', 'Version']})


def load_run(lab, label, payments, count=100):
    payloads = {s: fixture(s, payments) for s in SOCIETIES}
    rows=[]; errors=[]; started=time.time()
    lock=threading.Lock(); finished=threading.Event()
    observer_errors=[]
    def observe_during_upload():
        try:
            while not finished.is_set():
                with lock:
                    pending=[row for row in rows if 'completion_observed_epoch' not in row]
                if pending:
                    lab.observe(pending, timeout=.3)
                else:
                    time.sleep(.05)
        except Exception as exc:
            observer_errors.append(str(exc))
    def upload(index):
        society=SOCIETIES[index % 2]
        return lab.put(society, payloads[society], label)
    observer=threading.Thread(target=observe_during_upload)
    observer.start()
    try:
        with ThreadPoolExecutor(max_workers=8) as pool:
            futures=[pool.submit(upload, i) for i in range(count)]
            for future in as_completed(futures):
                try:
                    row=future.result()
                    with lock: rows.append(row)
                except Exception as exc: errors.append({'type': type(exc).__name__, 'message': str(exc)})
    finally:
        upload_done=time.time(); finished.set(); observer.join()
    missing=lab.observe([r for r in rows if 'completion_observed_epoch' not in r])
    ended=time.time()
    mismatches=[]
    expected_total=format(Decimal('1234.56')*payments, '.2f')
    for row in rows:
        record=row.get('verification_record')
        if record and (record['society_id']['S']!=row['society'] or record['payment_total']['S']!=expected_total
                       or int(record['table_counts']['M']['payments']['N'])!=payments):
            mismatches.append(row['object_id'])
    report={'name': label, 'fixture_contract': 'synthetic accounting subset; not a restore fixture',
        'payments_per_archive': payments, 'units_per_archive': 55, 'societies': 2,
        'upload_concurrency': 8, 'offered_archives': count, 'accepted_archives': len(rows),
        'completed_archives': len(rows)-len(missing), 'missing_at_deadline': missing,
        'upload_errors': errors, 'observer_errors': observer_errors, 'financial_or_tenant_mismatches': mismatches,
        'upload_phase_seconds': upload_done-started, 'campaign_seconds': ended-started,
        'observed_completed_archives_per_second': (len(rows)-len(missing))/(ended-started),
        'put_latency_ms': distribution([r['put_latency_ms'] for r in rows]),
        'completion_observed_ms': distribution([r['completion_observed_ms'] for r in rows if 'completion_observed_ms' in r]),
        'latency_boundary': 'same CodeBuild clock: before PutObject to first strongly consistent completed-record observation; includes upload and 250ms polling plus batch observation lag',
        'rows': rows, 'started_epoch': started, 'ended_epoch': ended}
    write(label+'.json', report)
    print(json.dumps({k:v for k,v in report.items() if k not in ['rows','latency_boundary']}), flush=True)
    if missing or errors or mismatches or observer_errors:
        raise AssertionError('Campaign has incomplete or incorrect archives; evidence retained')
    return rows


def reliability(lab, *, outage_only=False):
    label='reliability-'+uuid4().hex[:8]
    report={}
    lab.mapping(False)
    try:
        # Drain in-flight long polls/invocations after the control-plane state changes.
        report['disabled_mapping']=lab.functions.get_event_source_mapping(UUID=lab.outputs['Mapping'])
        report['quiescence_seconds']=35
        time.sleep(35)
        rows=[lab.put(SOCIETIES[i % 2], fixture(SOCIETIES[i % 2], 100), label) for i in range(20)]
        outage_started=time.time(); time.sleep(20)
        before=lab.observe(rows, timeout=1)
        report['consumer_outage']={'seconds': time.time()-outage_started, 'accepted': len(rows),
                                  'uncompleted_before_restart': len(before)}
    finally:
        recovery_started=time.time(); lab.mapping(True)
    missing=lab.observe(rows)
    report['consumer_outage'].update({'missing_after_restart': missing,
        'recovery_seconds_including_mapping_enable': time.time()-recovery_started, 'rows': rows})
    report['consumer_outage']['fault_injection_valid']=(len(before)==len(rows))
    write(label+'.json', report)
    if len(before)!=len(rows) or missing:
        raise AssertionError('Outage must hold every archive pending, then recover every archive')
    if outage_only:
        return
    # Actual duplicate queue deliveries; the direct replay also captures deterministic handler outcomes.
    replay=rows[0]
    for _ in range(20):
        lab.sqs.send_message(QueueUrl=lab.outputs['QueueUrl'], MessageBody=lab.notification(replay))
    msg={'Records': [{'messageId': 'explicit-replay', 'eventSource': 'aws:sqs',
                      'eventSourceARN': lab.outputs['QueueArn'], 'body': lab.notification(replay)}]}
    payload, tail=lab.invoke(lab.outputs['Verifier'], msg)
    report['duplicate_replay']={'injected_sqs_deliveries': 20, 'direct_replay_result': payload,
                                'direct_replay_log': tail, 'identity': replay['object_id']}
    if payload.get('batchItemFailures') or 'DUPLICATE_COMPLETED' not in tail:
        write(label+'.json', report)
        raise AssertionError('Completed duplicate did not take the idempotent path')
    lab.mapping(False)
    try:
        immutable=lab.put(SOCIETIES[0],fixture(SOCIETIES[0],100),label+'-immutable')
        superseding=lab.put(SOCIETIES[0],fixture(SOCIETIES[0],100),label+'-invalid-newer',
                            digest='0'*64,key=immutable['key'])
    finally:
        lab.mapping(True)
    immutable_missing=lab.observe([immutable])
    report['immutable_version_test']={'valid_older_version':immutable,'invalid_newer_version':superseding,
                                      'older_version_missing':immutable_missing}
    write(label+'.json', report)
    # Real poison objects reach DLQ; valid neighbours must remain processable.
    corrupt=lab.put(SOCIETIES[0], fixture(SOCIETIES[0], 100), label+'-bad-checksum', digest='0'*64)
    cross=lab.put(SOCIETIES[0], fixture(SOCIETIES[0], 100, cross_tenant=True), label+'-cross-tenant')
    healthy=lab.put(SOCIETIES[1], fixture(SOCIETIES[1], 100), label+'-healthy')
    missing_healthy=lab.observe([healthy])
    dlq=[]; deadline=time.monotonic()+300
    target_keys={corrupt['key'], cross['key'],superseding['key']}; found=set()
    while time.monotonic()<deadline and found!=target_keys:
        response=lab.sqs.receive_message(QueueUrl=lab.outputs['DLQUrl'], MaxNumberOfMessages=10,
                                       WaitTimeSeconds=10, MessageSystemAttributeNames=['All'])
        for message in response.get('Messages', []):
            body=json.loads(message['Body'])
            for rec in body.get('Records', []):
                key=rec.get('s3',{}).get('object',{}).get('key')
                if key in target_keys: found.add(key)
            dlq.append({'message_id': message['MessageId'], 'body': body, 'attributes': message.get('Attributes')})
            lab.sqs.delete_message(QueueUrl=lab.outputs['DLQUrl'], ReceiptHandle=message['ReceiptHandle'])
    report['poison_isolation']={'expected_poison_objects': [corrupt, cross], 'dlq': dlq,
        'found_poison_keys': sorted(found), 'healthy_missing': missing_healthy,
        'interpretation': 'invalid immutable versions quarantined, not successfully recovered backups'}
    # Anonymously accessing the exact version must fail despite valid signed access above.
    from botocore import UNSIGNED
    anonymous=lab.session.client('s3', config=Config(signature_version=UNSIGNED, connect_timeout=5, read_timeout=10))
    try:
        result=anonymous.get_object(Bucket=lab.bucket, Key=replay['key'], VersionId=replay['version'])
        result['Body'].close(); report['anonymous_read']='UNEXPECTED_ALLOWED'
    except ClientError as exc:
        report['anonymous_read']={'code': exc.response['Error']['Code'],
                                  'status': exc.response['ResponseMetadata']['HTTPStatusCode']}
    report['public_access_block']=lab.s3.get_public_access_block(Bucket=lab.bucket)['PublicAccessBlockConfiguration']
    credentials=lab.session.client('sts', config=CONFIG).assume_role(
        RoleArn=lab.outputs['TenantReaderRole'], RoleSessionName='synthetic-tenant-denial-test')['Credentials']
    tenant=lab.session.client('s3', config=CONFIG, aws_access_key_id=credentials['AccessKeyId'],
        aws_secret_access_key=credentials['SecretAccessKey'], aws_session_token=credentials['SessionToken'])
    a=next(row for row in rows if row['society']==SOCIETIES[0])
    b=next(row for row in rows if row['society']==SOCIETIES[1])
    result=tenant.get_object(Bucket=lab.bucket, Key=a['key'], VersionId=a['version'])
    with result['Body'] as body: body.read()
    report['tenant_allowed_read']='PASSED'
    try:
        result=tenant.get_object(Bucket=lab.bucket, Key=b['key'], VersionId=b['version'])
        result['Body'].close(); report['cross_tenant_read']='UNEXPECTED_ALLOWED'
    except ClientError as exc:
        report['cross_tenant_read']=exc.response['Error']['Code']
    write(label+'.json', report)
    if (missing or missing_healthy or immutable_missing or found!=target_keys or report['anonymous_read']=='UNEXPECTED_ALLOWED'
            or report['cross_tenant_read']!='AccessDenied'):
        raise AssertionError('Reliability/isolation failure; raw evidence retained')
    print('Reliability evidence:', label, flush=True)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--label', required=True)
    parser.add_argument('--reliability', action='store_true')
    parser.add_argument('--outage-only', action='store_true')
    args=parser.parse_args()
    lab=Lab(); lab.inventory(args.label)
    write(args.label+'-runner.json', {'python': platform.python_version(), 'platform': platform.platform(),
        'logical_cpus': os.cpu_count(), 'build_arn': os.environ.get('CODEBUILD_BUILD_ARN'),
        'region': 'ap-south-1', 'started_at': datetime.now(timezone.utc)})
    if not args.outage_only:
        for payments in [100, 1000]:
            for repetition in range(3):
                load_run(lab, f'{args.label}-payments{payments}-r{repetition}', payments)
    if args.outage_only:
        reliability(lab,outage_only=True)
    if args.reliability:
        reliability(lab)


if __name__=='__main__':
    main()
