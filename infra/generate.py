"""Generate reviewable CloudFormation for a bounded, isolated AWS experiment."""

import json
from pathlib import Path


def ref(name):
    return {"Ref": name}


def sub(value):
    return {"Fn::Sub": value}


def arn(name):
    return {"Fn::GetAtt": [name, "Arn"]}


def policy(statements):
    return {"Version": "2012-10-17", "Statement": statements}


def allow(actions, resource, **extra):
    return {"Effect": "Allow", "Action": actions, "Resource": resource, **extra}


def resource(kind, props, why, must=None, **extra):
    return {"Type": kind, "Properties": props, "Metadata": {
        "com.aws.cloudformation.Context": {"why": why, "must": must or ["Lab resources only"]}}, **extra}


def template(description):
    return {"AWSTemplateFormatVersion": "2010-09-09", "Description": description,
            "Metadata": {},
            "Resources": {}, "Outputs": {}}


def bucket():
    return {"PublicAccessBlockConfiguration": {key: True for key in [
        "BlockPublicAcls", "IgnorePublicAcls", "BlockPublicPolicy", "RestrictPublicBuckets"]},
        "BucketEncryption": {"ServerSideEncryptionConfiguration": [
            {"ServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]},
        "VersioningConfiguration": {"Status": "Enabled"},
        "LifecycleConfiguration": {"Rules": [{"Id": "BoundedLabRetention", "Status": "Enabled",
            "ExpirationInDays": 7, "NoncurrentVersionExpiration": {"NoncurrentDays": 1},
            "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 1}}]}}


def tls_bucket(name):
    return {"Bucket": ref(name), "PolicyDocument": policy([{
        "Effect": "Deny", "Principal": "*", "Action": "s3:*",
        "Resource": [arn(name), sub('${' + name + '.Arn}/*')],
        "Condition": {"Bool": {"aws:SecureTransport": "false"}}}])}


def trust(service):
    return policy([{"Effect": "Allow", "Principal": {"Service": service},
                    "Action": "sts:AssumeRole"}])


def main():
    root = Path(__file__).parent
    boot = template("Private lab artifacts and finite CodeBuild workers; isolated from production")
    r = boot['Resources']
    r['Artifacts'] = resource('AWS::S3::Bucket', bucket(), 'Temporary synthetic source and evidence',
        ['Export evidence before deletion'], DeletionPolicy='Retain', UpdateReplacePolicy='Retain')
    r['ArtifactPolicy'] = resource('AWS::S3::BucketPolicy', tls_bucket('Artifacts'), 'HTTPS-only artifact access')
    r['BuildLogs'] = resource('AWS::Logs::LogGroup', {
        'LogGroupName': sub('/aws/codebuild/${AWS::StackName}'), 'RetentionInDays': 7}, 'Bounded worker logs')
    r['BuildRole'] = resource('AWS::IAM::Role', {
        'AssumeRolePolicyDocument': trust('codebuild.amazonaws.com'),
        'Policies': [{'PolicyName': 'LabArtifactsAndLogs', 'PolicyDocument': policy([
            allow(['s3:GetObject', 's3:GetObjectVersion', 's3:PutObject'], sub('${Artifacts.Arn}/*')),
            allow(['s3:ListBucket', 's3:GetBucketLocation'], arn('Artifacts')),
            allow(['logs:CreateLogStream', 'logs:PutLogEvents'], arn('BuildLogs'))])}]},
        'Finite builds can only read and write the lab artifact bucket')
    r['Worker'] = resource('AWS::CodeBuild::Project', {
        'ServiceRole': arn('BuildRole'), 'TimeoutInMinutes': 45, 'QueuedTimeoutInMinutes': 10,
        'ConcurrentBuildLimit': 1, 'Artifacts': {'Type': 'NO_ARTIFACTS'},
        'Source': {'Type': 'S3', 'Location': sub('${Artifacts}/source.zip'),
                   'BuildSpec': 'aws_lab/buildspec.yml'},
        'Environment': {'Type': 'LINUX_CONTAINER', 'ComputeType': 'BUILD_GENERAL1_MEDIUM',
                        'Image': 'aws/codebuild/standard:7.0', 'PrivilegedMode': True,
                        'EnvironmentVariables': [{'Name': 'LAB_ARTIFACT_BUCKET', 'Value': ref('Artifacts')}]},
        'LogsConfig': {'CloudWatchLogs': {'Status': 'ENABLED', 'GroupName': ref('BuildLogs')}},
        'Tags': [{'Key': 'Purpose', 'Value': 'TreziaSyntheticRecoveryLab'}]},
        'Cloud-only restore and validation worker; no production credentials',
        ['No VPC or NAT gateway', 'No scheduled builds', 'Finite timeout'])
    for key, value in [('ArtifactBucket', ref('Artifacts')), ('Worker', ref('Worker')),
                       ('BuildRoleArn', arn('BuildRole'))]:
        boot['Outputs'][key] = {'Value': value, 'Description': key + ' for the isolated lab'}
    (root/'bootstrap.json').write_text(json.dumps(boot, indent=2)+'\n')

    app = template('Synthetic snapshot verification with immutable identities and bounded queue retries')
    app['Parameters'] = {
        'ArtifactBucket': {'Type': 'String', 'AllowedPattern': '[a-z0-9.-]+'},
        'CodeKey': {'Type': 'String', 'AllowedPattern': 'code/[a-zA-Z0-9._-]+.zip'},
        'WorkerRoleArn': {'Type': 'String', 'AllowedPattern': 'arn:aws:iam::[0-9]{12}:role/.+'},
        'Memory': {'Type': 'Number', 'AllowedValues': [128, 256, 512, 1024], 'Default': 128},
        'Batch': {'Type': 'Number', 'AllowedValues': [1, 5, 10], 'Default': 1},
        'FreshnessSeconds': {'Type': 'Number', 'AllowedValues': [0, 1800], 'Default': 1800},
    }
    r = app['Resources']
    r['Records'] = resource('AWS::DynamoDB::Table', {
        'BillingMode': 'PAY_PER_REQUEST', 'AttributeDefinitions': [{'AttributeName': 'object_id', 'AttributeType': 'S'}],
        'KeySchema': [{'AttributeName': 'object_id', 'KeyType': 'HASH'}],
        'TimeToLiveSpecification': {'AttributeName': 'expires_at', 'Enabled': True},
        'SSESpecification': {'SSEEnabled': True}}, 'Per-version durable verification state',
        ['Immutable identity includes object version'], DeletionPolicy='Retain', UpdateReplacePolicy='Retain')
    r['DeadLetters'] = resource('AWS::SQS::Queue', {
        'SqsManagedSseEnabled': True, 'MessageRetentionPeriod': 86400}, 'Isolate invalid archives after finite retries')
    r['Queue'] = resource('AWS::SQS::Queue', {'SqsManagedSseEnabled': True,
        'VisibilityTimeout': 60, 'ReceiveMessageWaitTimeSeconds': 20, 'MessageRetentionPeriod': 86400,
        'RedrivePolicy': {'deadLetterTargetArn': arn('DeadLetters'), 'maxReceiveCount': 3}},
        'Durable buffering during consumer failure', ['Visibility >= six function timeouts'])
    r['QueuePolicy'] = resource('AWS::SQS::QueuePolicy', {'Queues': [ref('Queue')],
        'PolicyDocument': policy([
            allow('sqs:SendMessage', arn('Queue'), Principal={'Service': 's3.amazonaws.com'},
                Condition={'ArnEquals': {'aws:SourceArn': sub('arn:${AWS::Partition}:s3:::${AWS::StackName}-${AWS::AccountId}')},
                           'StringEquals': {'aws:SourceAccount': ref('AWS::AccountId')}}),
            {'Effect': 'Deny', 'Principal': '*', 'Action': 'sqs:*',
             'Resource': arn('Queue'),
             'Condition': {'Bool': {'aws:SecureTransport': 'false'}}}])}, 'Only lab S3 may publish service notifications')
    r['DeadLetterPolicy'] = resource('AWS::SQS::QueuePolicy', {'Queues': [ref('DeadLetters')],
        'PolicyDocument': policy([{'Effect': 'Deny', 'Principal': '*', 'Action': 'sqs:*',
            'Resource': arn('DeadLetters'), 'Condition': {'Bool': {'aws:SecureTransport': 'false'}}}])},
        'Deny plaintext DLQ access; SQS requires a single resource per policy statement')
    b = bucket(); b['BucketName'] = sub('${AWS::StackName}-${AWS::AccountId}')
    b['NotificationConfiguration'] = {'QueueConfigurations': [{'Event': 's3:ObjectCreated:*',
        'Queue': arn('Queue'), 'Filter': {'S3Key': {'Rules': [{'Name': 'prefix', 'Value': 'input/'}]}}}]}
    r['Snapshots'] = resource('AWS::S3::Bucket', b, 'Private versioned synthetic archives',
        ['Never hold production data'], DependsOn='QueuePolicy', DeletionPolicy='Retain', UpdateReplacePolicy='Retain')
    r['SnapshotPolicy'] = resource('AWS::S3::BucketPolicy', tls_bucket('Snapshots'), 'Deny plaintext transport')
    r['FunctionRole'] = resource('AWS::IAM::Role', {'AssumeRolePolicyDocument': trust('lambda.amazonaws.com'),
        'Policies': [{'PolicyName': 'LabVerificationOnly', 'PolicyDocument': policy([
            allow('s3:GetObjectVersion', sub('${Snapshots.Arn}/input/*')),
            allow(['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem'], arn('Records')),
            allow(['sqs:ReceiveMessage', 'sqs:DeleteMessage', 'sqs:GetQueueAttributes'], arn('Queue')),
            allow(['logs:CreateLogStream', 'logs:PutLogEvents'], sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:/aws/lambda/${AWS::StackName}-*:*')),
            allow('cloudwatch:PutMetricData', '*', Condition={'StringEquals': {'cloudwatch:namespace': 'TreziaRecoveryLab'}})
        ])}]}, 'Verifier cannot mutate snapshots or access other databases')
    env = {'LAB_BUCKET': ref('Snapshots'), 'LAB_TABLE': ref('Records'), 'LAB_QUEUE_ARN': arn('Queue'),
        'LAB_NAME': ref('AWS::StackName'), 'LAB_SOCIETIES': '["11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222"]',
        'LAB_MAX_AGE_SECONDS': ref('FreshnessSeconds')}
    for logical, suffix, handler in [('Verifier', 'verify', 'lambda_handler'), ('Watchdog', 'watchdog', 'freshness_handler')]:
        name = sub('${AWS::StackName}-'+suffix)
        r[logical+'Logs'] = resource('AWS::Logs::LogGroup', {'LogGroupName': sub('/aws/lambda/${AWS::StackName}-'+suffix),
                                                            'RetentionInDays': 7}, 'Bounded structured runtime evidence')
        r[logical] = resource('AWS::Lambda::Function', {'FunctionName': name, 'Runtime': 'python3.12',
            'Handler': 'aws_lab.src.handlers.'+handler, 'Role': arn('FunctionRole'),
            'MemorySize': ref('Memory') if logical=='Verifier' else 128, 'Timeout': 10,
            'Code': {'S3Bucket': ref('ArtifactBucket'), 'S3Key': ref('CodeKey')},
            'Environment': {'Variables': env}}, 'Real AWS processing with synthetic data',
            ['No provisioned concurrency'], DependsOn=logical+'Logs')
    r['Mapping'] = resource('AWS::Lambda::EventSourceMapping', {'EventSourceArn': arn('Queue'),
        'FunctionName': ref('Verifier'), 'BatchSize': ref('Batch'), 'MaximumBatchingWindowInSeconds': 0,
        'FunctionResponseTypes': ['ReportBatchItemFailures'], 'ScalingConfig': {'MaximumConcurrency': 2},
        'Enabled': True}, 'Finite concurrency and per-message retry isolation')
    r['FreshnessRule'] = resource('AWS::Events::Rule', {'ScheduleExpression': 'rate(1 minute)', 'State': 'ENABLED',
        'Targets': [{'Arn': arn('Watchdog'), 'Id': 'Watchdog',
                     'RetryPolicy': {'MaximumEventAgeInSeconds': 60, 'MaximumRetryAttempts': 0}}]},
        'Short-lived freshness detection experiment; remove after campaign')
    r['WatchdogPermission'] = resource('AWS::Lambda::Permission', {'FunctionName': ref('Watchdog'),
        'Action': 'lambda:InvokeFunction', 'Principal': 'events.amazonaws.com', 'SourceArn': arn('FreshnessRule'),
        'SourceAccount': ref('AWS::AccountId')}, 'Only this schedule may invoke the watchdog')
    r['AlertKey'] = resource('AWS::KMS::Key', {'Description': 'Short-lived lab alarm notification encryption',
        'EnableKeyRotation': True, 'PendingWindowInDays': 7,
        'KeyPolicy': policy([
            {'Effect': 'Allow', 'Principal': {'AWS': sub('arn:${AWS::Partition}:iam::${AWS::AccountId}:root')},
             'Action': 'kms:*', 'Resource': '*'},
            {'Effect': 'Allow', 'Principal': {'Service': 'cloudwatch.amazonaws.com'},
             'Action': ['kms:Decrypt','kms:GenerateDataKey*'], 'Resource': '*',
             'Condition': {'StringEquals': {'aws:SourceAccount': ref('AWS::AccountId')},
                 'ArnLike': {'aws:SourceArn': sub('arn:${AWS::Partition}:cloudwatch:${AWS::Region}:${AWS::AccountId}:alarm:${AWS::StackName}*')}}}
        ])}, 'CloudWatch encrypted SNS publishing requires a customer-managed key',
        ['Key encrypts only synthetic alarm notifications', 'Schedule deletion during teardown'])
    r['AlertTopic'] = resource('AWS::SNS::Topic', {'KmsMasterKeyId': ref('AlertKey')},
        'Encrypted machine-to-machine alarm notifications; no email or SMS recipients')
    r['AlertQueue'] = resource('AWS::SQS::Queue', {'SqsManagedSseEnabled': True,
        'MessageRetentionPeriod': 86400, 'ReceiveMessageWaitTimeSeconds': 20},
        'Receipt sink proves actual SNS delivery without contacting people')
    r['AlertQueuePolicy'] = resource('AWS::SQS::QueuePolicy', {'Queues': [ref('AlertQueue')],
        'PolicyDocument': policy([
            allow('sqs:SendMessage',arn('AlertQueue'),Principal={'Service':'sns.amazonaws.com'},
                Condition={'ArnEquals':{'aws:SourceArn':ref('AlertTopic')},
                           'StringEquals':{'aws:SourceAccount':ref('AWS::AccountId')}}),
            {'Effect':'Deny','Principal':'*','Action':'sqs:*','Resource':arn('AlertQueue'),
             'Condition':{'Bool':{'aws:SecureTransport':'false'}}}])},
        'Only the lab alert topic may deliver service notifications')
    r['AlertSubscription'] = resource('AWS::SNS::Subscription', {'TopicArn':ref('AlertTopic'),
        'Protocol':'sqs','Endpoint':arn('AlertQueue'),'RawMessageDelivery':True},
        'Observable encrypted SNS-to-SQS alert delivery',DependsOn='AlertQueuePolicy')
    r['FreshnessAlarm'] = resource('AWS::CloudWatch::Alarm', {'Namespace': 'TreziaRecoveryLab',
        'MetricName': 'StaleSocieties', 'Dimensions': [{'Name': 'Lab', 'Value': ref('AWS::StackName')}],
        'Statistic': 'Maximum', 'Period': 60, 'EvaluationPeriods': 1, 'Threshold': 0,
        'ComparisonOperator': 'GreaterThanThreshold', 'TreatMissingData': 'breaching',
        'AlarmActions':[ref('AlertTopic')], 'OKActions':[ref('AlertTopic')]},
        'Visible stale and absent-watchdog alarm; notifications stay in the lab')
    r['AlertTopicPolicy'] = resource('AWS::SNS::TopicPolicy', {'Topics':[ref('AlertTopic')],
        'PolicyDocument':policy([allow('sns:Publish',ref('AlertTopic'),Principal={'Service':'cloudwatch.amazonaws.com'},
            Condition={'ArnEquals':{'aws:SourceArn':arn('FreshnessAlarm')},
                       'StringEquals':{'aws:SourceAccount':ref('AWS::AccountId')}})])},
        'Only this lab alarm can publish notifications')
    r['WorkerAccess'] = resource('AWS::IAM::Policy', {'PolicyName': 'FiniteLabCampaign',
        'Roles': [{'Fn::Select': [1, {'Fn::Split': ['role/', ref('WorkerRoleArn')]}]}],
        'PolicyDocument': policy([
            allow(['s3:GetObject', 's3:GetObjectVersion', 's3:PutObject'], sub('${Snapshots.Arn}/*')),
            allow(['s3:GetBucketVersioning', 's3:GetBucketPublicAccessBlock'], arn('Snapshots')),
            allow(['dynamodb:BatchGetItem', 'dynamodb:GetItem', 'dynamodb:Scan'], arn('Records')),
            allow(['sqs:SendMessage', 'sqs:ReceiveMessage', 'sqs:DeleteMessage', 'sqs:GetQueueAttributes'], [arn('Queue'), arn('DeadLetters')]),
            allow(['lambda:InvokeFunction', 'lambda:GetFunctionConfiguration'], [arn('Verifier'), arn('Watchdog')]),
            allow(['lambda:GetEventSourceMapping', 'lambda:UpdateEventSourceMapping'], sub('arn:${AWS::Partition}:lambda:${AWS::Region}:${AWS::AccountId}:event-source-mapping:${Mapping}')),
            allow(['cloudwatch:DescribeAlarms', 'cloudwatch:GetMetricStatistics'], '*'),
            allow('sts:AssumeRole', arn('TenantReader')),
            allow(['logs:FilterLogEvents', 'logs:GetLogEvents', 'logs:DescribeLogStreams'], [arn('VerifierLogs'), arn('WatchdogLogs')])
        ])}, 'Runner can exercise only the deployed lab and collect evidence')
    r['TenantReader'] = resource('AWS::IAM::Role', {
        'AssumeRolePolicyDocument': policy([{'Effect': 'Allow', 'Principal': {'AWS': ref('WorkerRoleArn')},
                                            'Action': 'sts:AssumeRole'}]),
        'Policies': [{'PolicyName': 'SingleSyntheticSocietyRead', 'PolicyDocument': policy([
            allow('s3:GetObjectVersion', sub('${Snapshots.Arn}/input/11111111-1111-4111-8111-111111111111/*'))])}]},
        'Actual scoped tenant-read identity for positive and negative integration tests')
    for key, value in [('Bucket', ref('Snapshots')), ('Table', ref('Records')), ('QueueUrl', ref('Queue')),
        ('QueueArn', arn('Queue')), ('DLQUrl', ref('DeadLetters')), ('Verifier', ref('Verifier')),
        ('Watchdog', ref('Watchdog')), ('Mapping', ref('Mapping')), ('Alarm', ref('FreshnessAlarm')),
        ('TenantReaderRole', arn('TenantReader')),('AlertQueueUrl',ref('AlertQueue')),
        ('AlertTopicArn',ref('AlertTopic')),('AlertKeyId',ref('AlertKey'))]:
        app['Outputs'][key] = {'Value': value, 'Description': key+' for the isolated experiment'}
    (root/'runtime.json').write_text(json.dumps(app, indent=2)+'\n')
    for p in root.glob('*.json'):
        print(p.name, p.stat().st_size, 'bytes')


if __name__ == '__main__':
    main()
