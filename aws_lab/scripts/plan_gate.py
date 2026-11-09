"""Read-only, fail-closed Free-plan gate. No resource mutation is performed."""

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from decimal import Decimal


def validate(identity, plan, expected_account, now):
    if not re.fullmatch(r"[0-9]{12}", expected_account):
        raise ValueError("Expected a configured lab account ID")
    if identity.get("Account") != expected_account or plan.get("accountId") != expected_account:
        raise ValueError("AWS identity/plan does not match the allowed lab account")
    if plan.get("accountPlanType") != "FREE" or plan.get("accountPlanStatus") != "ACTIVE":
        raise ValueError("An active Free account plan is required; no Paid-plan exception is enabled")
    credit = plan.get("accountPlanRemainingCredits", {})
    if credit.get("unit") != "USD" or Decimal(str(credit.get("amount", 0))) <= 0:
        raise ValueError("Positive verified Free-plan credits are required")
    expiry = datetime.fromisoformat(str(plan.get("accountPlanExpirationDate", "")).replace("Z", "+00:00"))
    if expiry.tzinfo is None or expiry <= now:
        raise ValueError("Free plan expiry is invalid or has passed")
    return {"eligible": "true", "account_suffix": expected_account[-4:], "plan": "FREE"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", default="default")
    parser.add_argument("--region", required=True)
    parser.add_argument("--expected-account", required=True)
    args = parser.parse_args()
    cli = [os.environ.get("AWS_CLI", "aws"), "--profile", args.profile, "--region", args.region,
           "--no-cli-pager", "--output", "json", "--cli-connect-timeout", "5", "--cli-read-timeout", "10"]
    def read(*command):
        result = subprocess.run([*cli, *command], capture_output=True, text=True, check=True, timeout=30)
        return json.loads(result.stdout)
    try:
        result = validate(read("sts", "get-caller-identity"), read("freetier", "get-account-plan-state"),
                          args.expected_account, datetime.now(timezone.utc))
    except (ValueError, KeyError, TypeError, ArithmeticError, subprocess.SubprocessError) as exc:
        print(f"Deployment gate blocked: {type(exc).__name__}; confirm lab identity and active Free plan.", file=sys.stderr)
        return 1
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
