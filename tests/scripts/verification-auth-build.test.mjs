import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {buildEnvironment} from '../../scripts/build-verification-web.mjs';

const configuration = {
  VITE_AUTH_MODE: 'cognito',
  VITE_COGNITO_ISSUER: 'https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_mock',
  VITE_COGNITO_CLIENT_ID: 'mockclient',
  VITE_COGNITO_ORIGIN: 'https://mock-login.auth.ap-northeast-1.amazoncognito.com',
  VITE_COGNITO_REDIRECT_URI: 'https://dexample.cloudfront.net/auth/callback',
  VITE_API_BASE_URL: 'https://api.example.test',
  VITE_WS_BASE_URL: 'wss://api.example.test',
};

test('passes only the declared public inputs and ignores inherited Vite variables', () => {
  assert.deepEqual(buildEnvironment(configuration, {
    PATH: '/bin', VITE_AUTH_MODE: 'local', VITE_UNEXPECTED: 'not-for-bundle', NODE_ENV: 'development',
  }), {PATH: '/bin', ...configuration});
});

test('rejects missing, extra, local and mismatched verification settings before the build', () => {
  for (const invalid of [
    null, {}, {...configuration, VITE_LEAK: 'private-marker'},
    {...configuration, VITE_AUTH_MODE: 'local'},
    {...configuration, VITE_WS_BASE_URL: 'wss://api.example.test/ws'},
    {...configuration, VITE_WS_BASE_URL: 'wss://other.example.test'},
    {...configuration, VITE_API_BASE_URL: 'https://a.localhost', VITE_WS_BASE_URL: 'wss://a.localhost'},
    {...configuration, VITE_API_BASE_URL: 'https://api.example.test:443'},
    {...configuration, VITE_API_BASE_URL: 'https://x.ap-northeast-1.elb.amazonaws.com'},
    {...configuration, VITE_COGNITO_ORIGIN: configuration.VITE_COGNITO_ISSUER},
    {...configuration, VITE_COGNITO_REDIRECT_URI: 'https://dexample.cloudfront.net/auth/callback?next=/'},
  ]) assert.throws(() => buildEnvironment(invalid, {}), /Invalid verification web configuration/);
});

test('the EC2 guard rejects collisions without printing any Runtime Secret values', () => {
  const guard = new URL('../../infra/terraform/modules/private_runtime/verification-runtime-guard.sh', import.meta.url);
  const directory = mkdtempSync(join(tmpdir(), 'bidflow-runtime-env-test-'));
  try {
    const envFile = join(directory, 'runtime.env');
    for (const [line, allowed] of [
      ['BIDFLOW_DATABASE_URL=not-real', true],
      ['  # SPRING_PROFILES_ACTIVE=local', true],
      ['SPRING_PROFILES_ACTIVE=local-marker', false],
      ['SPRING_PROFILES_INCLUDE=e2e-marker', false],
      ['SPRING_PROFILES_GROUP_verification=local-marker', false],
      ['BIDFLOW_VERIFICATION_WEB_ORIGIN=secret-marker', false],
      ['  bidflow.cognito.issuer-uri =secret-marker', false],
      ['\uFEFFSPRING_PROFILES_ACTIVE=local-marker', false],
      ['BIDFLOW_COGNITO_CLIENTID=secret-marker', false],
      ['BIDFLOW_STORAGE_VERIFICATION_BUCKET=secret-marker', false],
      ['bidflow.storage.verification-region=secret-marker', false],
      ['BIDFLOW_COGNITO_CLIENT_ID', false],
      ['SPRING_APPLICATION_JSON=secret-marker', false],
    ]) {
      writeFileSync(envFile, line + '\n', {mode: 0o600});
      const result = spawnSync('bash', ['-c', '. "$1"; check_verification_runtime_env "$2"', 'bash', guard.pathname, envFile],
        {encoding: 'utf8'});
      assert.equal(result.status, allowed ? 0 : 1, line);
      assert.equal(result.stdout, '');
      assert.doesNotMatch(result.stderr, /marker|not-real/);
    }
  } finally { rmSync(directory, {recursive: true}); }
});
