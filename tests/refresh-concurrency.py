"""CI-only: independent Postgres sessions race for the singleton lease."""
import concurrent.futures
import json
import subprocess
import uuid

def claim(_):
    owner = str(uuid.uuid4())
    output = subprocess.check_output([
        'psql', '-X', '-tA', '-v', 'ON_ERROR_STOP=1', '-c',
        f"set role service_role; select public.tsr_refresh_claim('{owner}'::uuid);"
    ], text=True)
    return json.loads(output.strip().splitlines()[-1])['status']

with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    results = list(pool.map(claim, range(8)))
assert results.count('ACQUIRED') == 1, results
assert results.count('COOLDOWN') == 7, results
print('Postgres concurrent lease acquisition: PASS (one winner, seven denied)')
