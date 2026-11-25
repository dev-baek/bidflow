import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';

const keys = ['VITE_AUTH_MODE', 'VITE_COGNITO_ISSUER', 'VITE_COGNITO_CLIENT_ID', 'VITE_COGNITO_ORIGIN',
  'VITE_COGNITO_REDIRECT_URI', 'VITE_API_BASE_URL', 'VITE_WS_BASE_URL'];
const dns = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9]{1,62}$/;
const invalid = () => Error('Invalid verification web configuration');

export function buildEnvironment(input, inherited) {
  if (!input || Object.keys(input).length !== keys.length || keys.some(key => !Object.hasOwn(input, key)
    || typeof input[key] !== 'string' || /[\r\n]/.test(input[key]))) throw invalid();
  const host = input.VITE_API_BASE_URL.slice('https://'.length);
  if (input.VITE_AUTH_MODE !== 'cognito'
    || !/^https:\/\/cognito-idp\.ap-northeast-1\.amazonaws\.com\/ap-northeast-1_[A-Za-z0-9]+$/.test(input.VITE_COGNITO_ISSUER)
    || !/^[a-zA-Z0-9]{1,128}$/.test(input.VITE_COGNITO_CLIENT_ID)
    || !/^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.auth\.ap-northeast-1\.amazoncognito\.com$/.test(input.VITE_COGNITO_ORIGIN)
    || !/^https:\/\/d[a-z0-9]{1,62}\.cloudfront\.net\/auth\/callback$/.test(input.VITE_COGNITO_REDIRECT_URI)
    || input.VITE_API_BASE_URL !== `https://${host}` || !dns.test(host)
    || /\.(?:localhost|local|internal|elb\.amazonaws\.com)$/.test(host)
    || input.VITE_WS_BASE_URL !== `wss://${host}`) throw invalid();
  return {...Object.fromEntries(Object.entries(inherited).filter(([key]) => !/^VITE_|^NODE_ENV$/i.test(key))),
    ...Object.fromEntries(keys.map(key => [key, input[key]]))};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) throw Error('Usage: node scripts/build-verification-web.mjs PUBLIC_OUTPUT_JSON');
    let input;
    try { input = JSON.parse(readFileSync(process.argv[2], 'utf8')); } catch { throw invalid(); }
    const env = buildEnvironment(input, process.env);
    const cwd = fileURLToPath(new URL('../apps/web/', import.meta.url));
    const build = spawnSync('npm', ['run', 'build', '--', '--mode', 'verification'], {cwd, env, stdio: 'inherit'});
    process.exitCode = build.status ?? 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
