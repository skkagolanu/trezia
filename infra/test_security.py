"""Deterministic template safety checks supplement schema validation."""

import json
from pathlib import Path
import unittest


class InfrastructureSafety(unittest.TestCase):
    def test_storage_encryption_and_public_access(self):
        for name in ['bootstrap', 'runtime']:
            resources=json.loads((Path(__file__).parent/(name+'.json')).read_text())['Resources']
            for logical, item in resources.items():
                p=item['Properties']; kind=item['Type']
                with self.subTest(template=name, resource=logical):
                    if kind=='AWS::S3::Bucket':
                        self.assertTrue(all(p['PublicAccessBlockConfiguration'].values()))
                        self.assertEqual(len(p['PublicAccessBlockConfiguration']),4)
                        self.assertIn('BucketEncryption',p)
                        self.assertEqual(p['VersioningConfiguration']['Status'],'Enabled')
                        self.assertEqual(item['DeletionPolicy'],'Retain')
                    if kind=='AWS::SQS::Queue':
                        self.assertTrue(p['SqsManagedSseEnabled'])
                    if kind=='AWS::SNS::Topic':
                        self.assertIn('KmsMasterKeyId',p)
                    if kind=='AWS::SQS::QueuePolicy':
                        self.assertEqual(len(p['Queues']),1)
                        for statement in p['PolicyDocument']['Statement']:
                            self.assertNotIsInstance(statement['Resource'],list)
                    if kind=='AWS::Logs::LogGroup':
                        self.assertLessEqual(p['RetentionInDays'],7)
                    if kind=='AWS::CodeBuild::Project':
                        self.assertEqual(p['ConcurrentBuildLimit'],1)
                        self.assertLessEqual(p['TimeoutInMinutes'],45)
                        self.assertNotIn('VpcConfig',p)

    def test_retry_and_execution_limits(self):
        r=json.loads((Path(__file__).parent/'runtime.json').read_text())['Resources']
        self.assertGreaterEqual(r['Queue']['Properties']['VisibilityTimeout'],
                                6*r['Verifier']['Properties']['Timeout'])
        self.assertEqual(r['Mapping']['Properties']['ScalingConfig']['MaximumConcurrency'],2)
        self.assertEqual(r['Mapping']['Properties']['FunctionResponseTypes'],['ReportBatchItemFailures'])
        self.assertEqual(r['Queue']['Properties']['RedrivePolicy']['maxReceiveCount'],3)
        for item in r.values():
            self.assertNotIn('ProvisionedConcurrencyConfig',item['Properties'])
            self.assertNotIn(item['Type'],['AWS::EC2::NatGateway','AWS::RDS::DBInstance','AWS::EKS::Cluster'])


if __name__=='__main__':
    unittest.main()
