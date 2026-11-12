import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const deploy=readFileSync(new URL('../.github/workflows/deploy-worker.yml',import.meta.url),'utf8');
const checks=readFileSync(new URL('../.github/workflows/pr-checks.yml',import.meta.url),'utf8');
test('production needs successful same-commit validation and main ref',()=>{
  assert.match(deploy,/validate:\s+if: github\.repository == 'nning00\/sexytw-site' && github\.ref == 'refs\/heads\/main'\s+uses: \.\/\.github\/workflows\/pr-checks\.yml/);
  assert.match(deploy,/deploy:\s+needs: validate\s+# RELEASE HOLD:[^\n]+\s+if: github\.repository == 'nning00\/sexytw-site' && github\.ref == 'refs\/heads\/main'/);
  assert(!/continue-on-error|always\(\)/.test(deploy));
  assert.match(deploy,/group: sexytw-production-deploy\s+cancel-in-progress: false/);
});
test('shared validation runs tests/typecheck/build without secrets or deploy',()=>{
  assert.match(checks,/workflow_call:/);
  assert.match(checks,/pull_request:/);
  assert.match(checks,/ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
  assert.match(checks,/node --test scripts\/\*\.test\.mjs/);
  assert.match(checks,/unshare --net/);
  assert.match(checks,/--ignore-scripts/);
  assert(!/secrets\.|wrangler-action|command: deploy|workflow_dispatch:|pull_request_target:/.test(checks));
});
test('production artifact cannot be the fixture artifact',()=>{
  assert.match(deploy,/SEXYTW_CI_FIXTURE_BUILD: "0"/);
  assert.match(deploy,/assert.equal\(config.name, "sexytw-site"\)/);
  assert(deploy.indexOf('Guard production artifact')<deploy.indexOf('name: Deploy Worker'));
});

test('stale main reruns are refused before production deployment',()=>{
  assert.match(deploy,/EXPECTED_SHA: \$\{\{ github\.sha \}\}/);
  assert.match(deploy,/git ls-remote https:\/\/github\.com\/nning00\/sexytw-site\.git refs\/heads\/main/);
  assert(deploy.includes('test "$current_main" = "$EXPECTED_SHA"'));
  assert(deploy.indexOf('Refuse stale main')<deploy.indexOf('name: Deploy Worker'));
});

test('production release is held until rollback and failure-stop are verified',()=>{
  assert.match(deploy,/if: github\.repository == 'nning00\/sexytw-site' && github\.ref == 'refs\/heads\/main' && false/);
});
