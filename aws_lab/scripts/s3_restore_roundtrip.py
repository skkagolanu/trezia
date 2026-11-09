"""Upload a real captured Trezia archive, await verification, fetch its exact version."""

import gzip
import hashlib
import json
import sys
from pathlib import Path
import time

from aws_lab.scripts.campaign import Lab, write


def main():
    path=Path(sys.argv[1])
    mode=sys.argv[2]
    receipt=path.with_name('cloud-receipt.json')
    lab=Lab()
    if mode=='download':
        record=json.loads(receipt.read_text()); row=record['archive']
        started=time.time()
        response=lab.s3.get_object(Bucket=lab.bucket, Key=row['key'], VersionId=row['version'])
        with response['Body'] as body:
            fetched=body.read()
        fetched_hash=hashlib.sha256(fetched).hexdigest()
        if record['upload_sha256']!=fetched_hash:
            raise AssertionError('Downloaded snapshot differs from captured bytes')
        path.write_bytes(fetched)
        record.update({'download_sha256': fetched_hash, 'download_seconds': time.time()-started,
                       'download_started_epoch': started, 'download_ended_epoch': time.time(),
                       'scope': 'exact immutable S3 version retrieved after database wipe, before restore'})
        receipt.write_text(json.dumps(record,indent=2))
        return
    if mode!='upload':
        raise ValueError('Expected upload or download')
    raw=path.read_bytes()
    data=json.loads(gzip.decompress(raw))
    society=data['manifest']['society_id']
    # The real rehearsal uses a fresh random society; all fixtures are synthetic.
    started=time.time()
    row=lab.put(society, raw, 'genuine-restore')
    missing=lab.observe([row])
    if missing:
        write('restore-cloud-failure-'+society+'.json', row)
        raise AssertionError('Real Trezia snapshot did not verify')
    original_hash=hashlib.sha256(raw).hexdigest()
    record={'archive': row, 'upload_sha256': original_hash, 'backup_verify_seconds': time.time()-started}
    receipt.write_text(json.dumps(record,indent=2))


if __name__=='__main__':
    main()
