import copy
import gzip
import hashlib
import json
import unittest
from datetime import datetime, timezone
from uuid import uuid4

from aws_lab.src.recovery import InvalidSnapshot, MAX_EXPANDED, object_identity, validate_key, verify_archive
from aws_lab.scripts.plan_gate import validate


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.society = str(uuid4())
        self.data = {
            "exported_at": "2026-10-29T00:00:00Z",
            "manifest": {"format": "trezia-offboarding", "version": 4, "society_id": self.society},
            "society": {"id": self.society}, "society_config": {"society_id": self.society},
            "units": [], "residents": [], "payments": [
                {"id": str(uuid4()), "society_id": self.society, "amount_paid": "0.10"},
                {"id": str(uuid4()), "society_id": self.society, "amount_paid": "0.20"}],
            "expenditures": [], "bills": [], "audit_log": [],
        }

    def archive(self, data=None):
        raw = gzip.compress(json.dumps(self.data if data is None else data).encode())
        return raw, hashlib.sha256(raw).hexdigest()

    def test_valid_archive_has_exact_financial_total(self):
        raw, digest = self.archive()
        result = verify_archive(raw, self.society, digest)
        self.assertEqual(result["payment_total"], "0.30")
        self.assertEqual(result["table_counts"]["payments"], 2)

    def test_bad_checksum_is_rejected(self):
        raw, _ = self.archive()
        with self.assertRaises(InvalidSnapshot): verify_archive(raw, self.society, "0" * 64)

    def test_generic_amount_is_not_the_trezia_receipt_contract(self):
        row=self.data["payments"][0]
        row["amount"]=row.pop("amount_paid")
        raw,digest=self.archive()
        with self.assertRaises(InvalidSnapshot): verify_archive(raw,self.society,digest)

    def test_postgres_audit_bigint_identity_is_accepted(self):
        self.data['audit_log']=[{'id': 123, 'society_id': self.society}]
        raw,digest=self.archive()
        self.assertEqual(verify_archive(raw,self.society,digest)['table_counts']['audit_log'],1)

    def test_audit_duplicate_and_boolean_ids_are_rejected(self):
        for values in [[123,123],[True],[0],[2**63]]:
            with self.subTest(values=values):
                self.data['audit_log']=[{'id':v,'society_id':self.society} for v in values]
                raw,digest=self.archive()
                with self.assertRaises(InvalidSnapshot): verify_archive(raw,self.society,digest)

    def test_wrong_society_is_rejected(self):
        raw, digest = self.archive()
        with self.assertRaises(InvalidSnapshot): verify_archive(raw, str(uuid4()), digest)

    def test_cross_society_row_is_rejected(self):
        self.data["payments"][0]["society_id"] = str(uuid4())
        raw, digest = self.archive()
        with self.assertRaises(InvalidSnapshot): verify_archive(raw, self.society, digest)

    def test_missing_row_society_is_rejected(self):
        del self.data["payments"][0]["society_id"]
        raw, digest = self.archive()
        with self.assertRaises(InvalidSnapshot): verify_archive(raw, self.society, digest)

    def test_duplicate_row_is_rejected(self):
        self.data["payments"].append(copy.deepcopy(self.data["payments"][0]))
        raw, digest = self.archive()
        with self.assertRaises(InvalidSnapshot): verify_archive(raw, self.society, digest)

    def test_unknown_format_is_rejected(self):
        self.data["manifest"]["format"] = "toy-format"
        raw, digest = self.archive()
        with self.assertRaises(InvalidSnapshot): verify_archive(raw, self.society, digest)

    def test_unsupported_version_is_rejected(self):
        self.data["manifest"]["version"] = 999
        raw, digest = self.archive()
        with self.assertRaises(InvalidSnapshot): verify_archive(raw, self.society, digest)

    def test_missing_accounting_array_is_rejected(self):
        del self.data["bills"]
        raw, digest = self.archive()
        with self.assertRaises(InvalidSnapshot): verify_archive(raw, self.society, digest)

    def test_bad_payment_precision_is_rejected(self):
        self.data["payments"][0]["amount_paid"] = "0.001"
        raw, digest = self.archive()
        with self.assertRaises(InvalidSnapshot): verify_archive(raw, self.society, digest)

    def test_bool_money_is_rejected(self):
        self.data["payments"][0]["amount_paid"] = True
        raw, digest = self.archive()
        with self.assertRaises(InvalidSnapshot): verify_archive(raw, self.society, digest)

    def test_decompression_bomb_is_bounded(self):
        raw = gzip.compress(b" " * (MAX_EXPANDED + 1))
        with self.assertRaises(InvalidSnapshot): verify_archive(raw, self.society, hashlib.sha256(raw).hexdigest())

    def test_duplicate_json_key_is_rejected(self):
        raw = gzip.compress(b'{"a": 1, "a": 2}')
        with self.assertRaises(InvalidSnapshot): verify_archive(raw, self.society, hashlib.sha256(raw).hexdigest())

    def test_key_scope_and_version_identity(self):
        key = f"input/{self.society}/snapshot.json.gz"
        self.assertEqual(validate_key(key), (key, self.society))
        self.assertNotEqual(object_identity("bucket", key, "v1"), object_identity("bucket", key, "v2"))
        with self.assertRaises(InvalidSnapshot): validate_key(f"outside/{self.society}/snapshot.json.gz")
        with self.assertRaises(InvalidSnapshot): validate_key(f"input/{self.society}/../snapshot.json.gz")
        with self.assertRaises(InvalidSnapshot): object_identity("bucket", key, "null")


class GateTests(unittest.TestCase):
    def setUp(self):
        self.account = "111122223333"
        self.identity = {"Account": self.account}
        self.plan = {"accountId": self.account, "accountPlanType": "FREE", "accountPlanStatus": "ACTIVE",
                     "accountPlanRemainingCredits": {"amount": 10, "unit": "USD"},
                     "accountPlanExpirationDate": "2030-01-01T00:00:00Z"}
        self.now = datetime(2026, 10, 29, tzinfo=timezone.utc)

    def test_active_free_plan_is_accepted(self):
        self.assertEqual(validate(self.identity, self.plan, self.account, self.now)["eligible"], "true")

    def test_paid_even_with_credits_is_rejected(self):
        self.plan["accountPlanType"] = "PAID"
        with self.assertRaises(ValueError): validate(self.identity, self.plan, self.account, self.now)

    def test_wrong_account_is_rejected(self):
        with self.assertRaises(ValueError): validate(self.identity, self.plan, "999900001111", self.now)

    def test_no_remaining_credits_is_rejected(self):
        self.plan["accountPlanRemainingCredits"]["amount"] = 0
        with self.assertRaises(ValueError): validate(self.identity, self.plan, self.account, self.now)

    def test_expired_plan_is_rejected(self):
        self.plan["accountPlanExpirationDate"] = "2020-01-01T00:00:00Z"
        with self.assertRaises(ValueError): validate(self.identity, self.plan, self.account, self.now)

    def test_unknown_plan_status_is_rejected(self):
        self.plan["accountPlanStatus"] = "NOT_STARTED"
        with self.assertRaises(ValueError): validate(self.identity, self.plan, self.account, self.now)


if __name__ == "__main__":
    unittest.main()
