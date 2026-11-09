"""Recompute historical archive and recovery metrics; no AWS access required."""
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent

def main():
    result = json.loads((ROOT / "reference_results.json").read_text())
    runs = json.loads((ROOT / "evidence/archive_samples.json").read_text())["runs"]
    for name, expected in result["configurations"].items():
        selected = [r for r in runs if f'{r["configuration"]}-payments{r["receipts_per_archive"]}' == name]
        assert len(selected) == 3
        samples = sorted(x for r in selected for x in r["completion_observed_ms"])
        assert len(samples) == expected["completed_archives"] == 300
        assert all(r["offered_archives"] == r["accepted_archives"] == r["completed_archives"] == 100 for r in selected)
        for p, key in [(0.5, "p50"), (0.95, "p95"), (0.99, "p99")]:
            assert math.isclose(samples[math.ceil(p * len(samples)) - 1], expected["completion_observed_ms"][key])
        rate = len(samples) / sum(r["campaign_seconds"] for r in selected)
        assert math.isclose(rate, expected["observed_completed_archives_per_second"])
    for size in [100, 1000]:
        before = result["configurations"][f"baseline-128-batch1-payments{size}"]["completion_observed_ms"]["p99"]
        after = result["configurations"][f"candidate-512-batch5-payments{size}"]["completion_observed_ms"]["p99"]
        assert math.isclose(100 * (1 - after / before), result["comparisons"][str(size)]["pooled_completion_observed_p99_reduction_percent"])
    observations = json.loads((ROOT / "evidence/restore_observations.json").read_text())["drills"]
    assert len(observations) == 3
    for observed, expected in zip(observations, result["restore_drills"], strict=True):
        seconds = observed["ended_epoch"] - observed["wipe_started_epoch_ms"] / 1000
        assert math.isclose(seconds, expected["wipe_to_verified_seconds"])
        assert seconds < 53 and observed["exit_code"] == 0
        assert observed["capture_passed"] and observed["verify_passed"]
        assert observed["expected_row_counts"] == expected["row_counts"]
    print("All 1,200 archive observations, paired percentiles and three recovery timings are consistent.")

if __name__ == "__main__":
    main()
