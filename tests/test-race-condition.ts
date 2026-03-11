/**
 * Race Condition Test
 * 
 * Simulates 2 processes trying to refresh token simultaneously
 * Tests if file locking prevents concurrent refreshes
 * 
 * Usage:
 *   bun run tests/test-race-condition.ts
 */

import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { existsSync, writeFileSync, unlinkSync, readFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';

const TEST_DIR = join(homedir(), '.qwen-test-race');
const CREDENTIALS_PATH = join(TEST_DIR, 'oauth_creds.json');
const LOG_PATH = join(TEST_DIR, 'refresh-log.json');

/**
 * Helper script that performs token refresh using TokenManager (with file locking)
 */
function createRefreshScript(): string {
  const scriptPath = join(TEST_DIR, 'do-refresh.ts');
  
  const script = `import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tokenManager } from '../src/plugin/token-manager.js';
import { getCredentialsPath } from '../src/plugin/auth.js';

const LOG_PATH = '${LOG_PATH}';
const CREDS_PATH = '${CREDENTIALS_PATH}';

async function logRefresh(token: string) {
  const logEntry = {
    processId: process.pid,
    timestamp: Date.now(),
    token: token.substring(0, 20) + '...'
  };
  
  let log: any = { attempts: [] };
  if (existsSync(LOG_PATH)) {
    log = JSON.parse(readFileSync(LOG_PATH, 'utf8'));
  }
  
  log.attempts.push(logEntry);
  writeFileSync(LOG_PATH, JSON.stringify(log, null, 2));
  console.log('[Refresh]', logEntry);
}

async function main() {
  writeFileSync(CREDS_PATH, JSON.stringify({
    access_token: 'old_token_' + Date.now(),
    refresh_token: 'test_refresh_token',
    token_type: 'Bearer',
    resource_url: 'portal.qwen.ai',
    expiry_date: Date.now() - 1000,
    scope: 'openid'
  }, null, 2));
  
  const creds = await tokenManager.getValidCredentials(true);
  if (creds) {
    logRefresh(creds.accessToken);
  } else {
    logRefresh('FAILED');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
`;

  writeFileSync(scriptPath, script);
  return scriptPath;
}

/**
 * Setup test environment
 */
function setup(): void {
  if (!existsSync(TEST_DIR)) {
    mkdirSync(TEST_DIR, { recursive: true });
  }
  if (existsSync(LOG_PATH)) unlinkSync(LOG_PATH);
  const lockPath = CREDENTIALS_PATH + '.lock';
  if (existsSync(lockPath)) unlinkSync(lockPath);
}

/**
 * Cleanup test environment
 */
function cleanup(): void {
  try {
    if (existsSync(LOG_PATH)) unlinkSync(LOG_PATH);
    if (existsSync(CREDENTIALS_PATH)) unlinkSync(CREDENTIALS_PATH);
    const scriptPath = join(TEST_DIR, 'do-refresh.ts');
    if (existsSync(scriptPath)) unlinkSync(scriptPath);
    const lockPath = CREDENTIALS_PATH + '.lock';
    if (existsSync(lockPath)) unlinkSync(lockPath);
  } catch (e) {
    console.warn('Cleanup warning:', e);
  }
}

/**
 * Run 2 processes simultaneously
 */
async function runConcurrentRefreshes(): Promise<void> {
  return new Promise((resolve, reject) => {
    const scriptPath = createRefreshScript();
    let completed = 0;
    let errors = 0;

    for (let i = 0; i < 2; i++) {
      const proc = spawn('bun', [scriptPath], {
        cwd: process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe']
      });

      proc.stdout.on('data', (data) => {
        console.log(`[Proc ${i}]`, data.toString().trim());
      });

      proc.stderr.on('data', (data) => {
        console.error(`[Proc ${i} ERR]`, data.toString().trim());
        errors++;
      });

      proc.on('close', (code) => {
        completed++;
        if (completed === 2) {
          resolve();
        }
      });
    }

    setTimeout(() => {
      reject(new Error('Test timeout'));
    }, 10000);
  });
}

/**
 * Analyze results
 */
function analyzeResults(): boolean {
  if (!existsSync(LOG_PATH)) {
    console.error('❌ Log file not created');
    return false;
  }

  const log = JSON.parse(readFileSync(LOG_PATH, 'utf8'));
  const attempts = log.attempts || [];

  console.log('\n=== RESULTS ===');
  console.log(`Total refresh attempts: ${attempts.length}`);

  if (attempts.length === 0) {
    console.error('❌ No refresh attempts recorded');
    return false;
  }

  if (attempts.length === 1) {
    console.log('✅ PASS: Only 1 refresh happened (file locking worked!)');
    return true;
  }

  const timeDiff = Math.abs(attempts[1].timestamp - attempts[0].timestamp);
  
  if (timeDiff < 500) {
    console.log(`❌ FAIL: ${attempts.length} concurrent refreshes (race condition!)`);
    console.log(`Time difference: ${timeDiff}ms`);
    return false;
  }

  console.log(`⚠️  ${attempts.length} refreshes, but spaced ${timeDiff}ms apart`);
  return true;
}

/**
 * Main test runner
 */
async function main(): Promise<void> {
  console.log('╔════════════════════════════════════════════╗');
  console.log('║  Race Condition Test - File Locking       ║');
  console.log('╚════════════════════════════════════════════╝\n');

  try {
    console.log('Setting up test environment...');
    setup();

    console.log('Running 2 concurrent refresh processes...\n');
    await runConcurrentRefreshes();

    const passed = analyzeResults();

    if (passed) {
      console.log('\n✅ TEST PASSED: File locking prevents race condition\n');
      process.exit(0);
    } else {
      console.log('\n❌ TEST FAILED: Race condition detected\n');
      process.exit(1);
    }
  } catch (error) {
    console.error('\n❌ TEST ERROR:', error);
    process.exit(1);
  } finally {
    cleanup();
  }
}

main();
