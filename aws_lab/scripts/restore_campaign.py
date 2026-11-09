"""Run a financial snapshot restore rehearsal with an S3 roundtrip."""

import json
import os
from pathlib import Path
import subprocess
import time

from aws_lab.scripts.campaign import write


def run(command, **kwargs):
    subprocess.run(command, check=True, **kwargs)


def main():
    run(['npm', 'ci', '--no-fund'])
    with Path('evidence/application-unit-tests.log').open('w') as log:
        unit=subprocess.run(['npm','test','--','--runInBand','--json','--outputFile','evidence/application-unit-tests.json'],
                            stdout=log,stderr=subprocess.STDOUT)
    if unit.returncode:
        print(Path('evidence/application-unit-tests.log').read_text()[-10000:],flush=True)
        raise RuntimeError('Application tests failed with the patched dependency lock')
    with Path('evidence/database-tenant-isolation.log').open('w') as log:
        isolation=subprocess.run(['npm','run','test:rls:local'],stdout=log,stderr=subprocess.STDOUT)
    if isolation.returncode:
        print(Path('evidence/database-tenant-isolation.log').read_text()[-16000:],flush=True)
        raise RuntimeError('Real database authorization suite failed')
    original_test=Path('__tests__/integration/snapshot-roundtrip.test.ts').read_text()
    scale_marker='    const snapshot = await buildBackupSnapshot(societyId, { includeAttachmentInventory: false });'
    if original_test.count(scale_marker)!=1:
        raise AssertionError('Original snapshot capture changed; fixture injection needs review')
    scaled_test=original_test.replace(
        scale_marker,Path('aws_lab/scale-fixture.tsfrag').read_text()+'\n'+scale_marker)
    counts_marker='    const totalRows = Object.values(rowCounts).reduce((sum, n) => sum + n, 0);'
    if scaled_test.count(counts_marker)!=1:
        raise AssertionError('Original row-count assertion changed')
    accounting_assertions="""
    expect(rowCounts.units).toBe(55);
    expect(rowCounts.payments).toBe(1004);
    const auditCount = await svc.from('audit_log').select('*', {count: 'exact', head: true}).eq('society_id', societyId);
    expect(auditCount.error).toBeNull();
    expect(rowCounts.audit_log).toBe(auditCount.count);
"""
    scaled_test=scaled_test.replace(counts_marker,counts_marker+'\n'+accounting_assertions)
    Path('__tests__/integration/aws-recovery-roundtrip.test.ts').write_text(scaled_test)
    Path('aws_lab/jest.restore.config.cjs').write_text(
        "const base = require('../jest.restore.config.cjs');\n"
        "module.exports = {...base, rootDir: '..', testMatch: ['**/__tests__/integration/aws-recovery-roundtrip.test.ts']};\n")
    source=Path('scripts/rehearse-restore.mjs').read_text()
    source=source.replace("'--config', 'jest.restore.config.cjs'", "'--config', 'aws_lab/jest.restore.config.cjs'")
    reset_end="    fail('Could not reset the disposable local database.');\n  }"
    if source.count(reset_end)!=1:
        raise AssertionError('Reset readiness insertion requires review')
    readiness="""
  // supabase/cli#6016: reset can leave Kong with stale upstream container IPs.
  // Only the disposable worker's known gateway is restarted; no data is bypassed.
  const gateway = run('docker', ['restart', 'supabase_kong_trezia-local'], { stdio: 'inherit' });
  if (gateway.status !== 0) fail('Could not refresh disposable gateway routing after reset.');
  const schema = run(process.execPath, ['aws_lab/wait-schema.mjs'], {
    stdio: 'inherit', env: { ...jestEnv, DATABASE_URL: env.DB_URL },
  });
  if (schema.status !== 0) fail('Database/API schema readiness failed.');
"""
    source=source.replace(reset_end,reset_end+'\n'+readiness)
    marker="reset('4/6  Wiping — this is the simulated disaster');"
    if source.count(marker)!=1:
        raise AssertionError('Original restore flow changed; refusing an unreviewed rewrite')
    # Capture, reset, restore and verify the financial snapshot.
    insertion="""
const cloud = run('python', ['-m', 'aws_lab.scripts.s3_restore_roundtrip', snapshotPath, 'upload'], { stdio: 'inherit' });
if (cloud.status !== 0) fail('Cloud snapshot roundtrip failed.');
"""
    target=Path('aws_lab/cloud-rehearse.mjs')
    download_marker="step('5/6  Restoring the snapshot into the empty database');"
    if source.count(download_marker)!=1:
        raise AssertionError('Original restore marker changed')
    download="""
const fetched = run('python', ['-m', 'aws_lab.scripts.s3_restore_roundtrip', snapshotPath, 'download'], { stdio: 'inherit' });
if (fetched.status !== 0) fail('Could not retrieve cloud backup after disaster.');
"""
    instrumented=source.replace(marker,insertion+'\n'+marker).replace(download_marker,download_marker+'\n'+download)
    instrumented=instrumented.replace('function step(label) {',
        'function step(label) {\n  process.stdout.write("\\nTIMING " + JSON.stringify({label, epoch_ms: Date.now()}) + "\\n");')
    final_marker="jest('verifies', 'verify');"
    if instrumented.count(final_marker)!=1:
        raise AssertionError('Post-restore write verification insertion requires review')
    postcheck="""
const writable = run(process.execPath, ['aws_lab/check-restored-writes.mjs'], {
  stdio: 'inherit', env: { ...jestEnv, DATABASE_URL: env.DB_URL },
});
if (writable.status !== 0) fail('Restored database cannot accept a new audited financial write.');
"""
    instrumented=instrumented.replace(final_marker,final_marker+'\n'+postcheck)
    target.write_text(instrumented)
    reports=[]
    try:
        for iteration in range(3):
            destination=Path('evidence')/f'genuine-restore-r{iteration}'
            env={**os.environ, 'REHEARSAL_DIR': str(destination.resolve())}
            started=time.time()
            with Path(f'evidence/restore-r{iteration}.log').open('w') as log:
                result=subprocess.run(['node', str(target)], env=env, stdout=log, stderr=subprocess.STDOUT)
            record={'iteration': iteration, 'started_epoch': started, 'ended_epoch': time.time(),
                    'duration_seconds': time.time()-started, 'exit_code': result.returncode,
                    'boundary': 'rehearsal process incl capture, migrations/reset, S3 verification/download and DB restore/hash validation; excludes npm install and initial CodeBuild provisioning',
                    'exclusions': ['working production auth identities', 'private attachment bytes', 'production provider settings']}
            for phase in ['capture', 'verify']:
                p=destination/f'jest-{phase}.json'
                if p.exists():
                    d=json.loads(p.read_text()); record[phase]={k: d.get(k) for k in [
                        'numPassedTests', 'numFailedTests', 'numTotalTests', 'success', 'startTime']}
            p=destination/'expected.json'
            if p.exists(): record['expected']=json.loads(p.read_text())
            events=[]
            for line in Path(f'evidence/restore-r{iteration}.log').read_text().splitlines():
                if line.startswith('TIMING '):events.append(json.loads(line[len('TIMING '):]))
            record['stage_timestamps']=events
            markers={e['label'][:3]: e['epoch_ms']/1000 for e in events}
            if '5/6' in markers and '6/6' in markers:
                record['download_and_restore_seconds']=markers['6/6']-markers['5/6']
            if '4/6' in markers:
                record['disaster_wipe_to_verified_seconds']=record['ended_epoch']-markers['4/6']
            reports.append(record); write('genuine-restore-summary.json', reports)
            if result.returncode:
                print(Path(f'evidence/restore-r{iteration}.log').read_text()[-16000:], flush=True)
                raise RuntimeError('Genuine restore failed; full evidence retained')
    finally:
        names=subprocess.check_output(['docker','ps','--format','{{.Names}}'],text=True).splitlines()
        for name in names:
            if name.startswith(('supabase_auth_','supabase_rest_','supabase_kong_','supabase_db_')):
                with Path('evidence/'+name+'-diagnostic.log').open('w') as log:
                    subprocess.run(['docker','logs','--tail','80',name],stdout=log,stderr=subprocess.STDOUT)
        subprocess.run(['npx', 'supabase', 'stop', '--no-backup'])


if __name__=='__main__':
    main()
