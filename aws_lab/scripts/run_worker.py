"""Run only an explicitly selected cloud workload; default to pure validation."""
import os
import subprocess
import sys

def main():
    mode=os.environ.get('LAB_MODE','validate')
    if mode=='validate':
        return
    if mode=='restore':
        command=[sys.executable,'-m','aws_lab.scripts.restore_campaign']
    elif mode=='benchmark':
        command=[sys.executable,'-m','aws_lab.scripts.campaign','--label',os.environ['LAB_RUN_LABEL']]
    else:
        raise ValueError('LAB_MODE must be validate, restore or benchmark')
    subprocess.run(command,check=True)

if __name__=='__main__':main()
