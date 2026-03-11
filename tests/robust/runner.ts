/**
 * Robust Test Runner
 * 
 * Orchestrates multi-process tests for TokenManager and FileLock.
 */

import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { existsSync, writeFileSync, unlinkSync, readFileSync, mkdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { FileLock } from '../../src/utils/file-lock.js';
import { getCredentialsPath } from '../../src/plugin/auth.js';

const TEST_TMP_DIR = join(tmpdir(), 'qwen-robust-tests');
const SHARED_LOG = join(TEST_TMP_DIR, 'results.log');
const WORKER_SCRIPT = join(process.cwd(), 'tests/robust/worker.ts');

function setup() {
  if (!existsSync(TEST_TMP_DIR)) mkdirSync(TEST_TMP_DIR, { recursive: true });
  if (existsSync(SHARED_LOG)) unlinkSync(SHARED_LOG);
  
  // Cleanup stale locks from previous failed runs
  const credPath = getCredentialsPath();
  if (existsSync(credPath + '.lock')) unlinkSync(credPath + '.lock');
}

async function runWorker(id: string, type: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn('bun', [WORKER_SCRIPT, id, type, SHARED_LOG], {
      stdio: 'inherit',
      env: { ...process.env, OPENCODE_QWEN_DEBUG: '1' }
    });
    child.on('close', resolve);
  });
}

async function testRaceCondition() {
  console.log('\n--- 🏁 TEST: Concurrent Race Condition (2 Processes) ---');
  setup();
  
  // Start 2 workers that both try to force refresh
  const p1 = runWorker('W1', 'race');
  const p2 = runWorker('W2', 'race');
  
  await Promise.all([p1, p2]);
  
  if (!existsSync(SHARED_LOG)) {
    console.error('❌ FAIL: No log file created');
    return;
  }

  const logContent = readFileSync(SHARED_LOG, 'utf8').trim();
  if (!logContent) {
    console.error('❌ FAIL: No results in log');
    return;
  }
  const results = logContent.split('\n').map(l => JSON.parse(l));
  console.log(`Results collected: ${results.length}`);
  
  const tokens = results.map(r => r.token);
  const uniqueTokens = new Set(tokens);
  
  console.log(`Unique tokens: ${uniqueTokens.size}`);

  if (uniqueTokens.size === 1 && results.every(r => r.status === 'success')) {
    console.log('✅ PASS: Both processes ended up with the SAME token. Locking worked!');
  } else {
    console.error('❌ FAIL: Processes have different tokens or failed.');
    console.error('Tokens:', tokens);
  }
}

async function testStressConcurrency() {
  console.log('\n--- 🔥 TEST: Stress Concurrency (10 Processes) ---');
  setup();
  
  const workers = [];
  for (let i = 0; i < 10; i++) {
    workers.push(runWorker(`STRESS_${i}`, 'stress'));
  }
  
  const start = Date.now();
  await Promise.all(workers);
  const elapsed = Date.now() - start;
  
  if (!existsSync(SHARED_LOG)) {
    console.error('❌ FAIL: No log file created');
    return;
  }

  const logContent = readFileSync(SHARED_LOG, 'utf8').trim();
  if (!logContent) {
    console.error('❌ FAIL: No results in log');
    return;
  }
  const results = logContent.split('\n').map(l => JSON.parse(l));
  const successCount = results.filter(r => r.status === 'completed_stress').length;
  
  console.log(`Successes: ${successCount}/10 in ${elapsed}ms`);
  
  if (successCount === 10) {
    console.log('✅ PASS: High concurrency handled successfully.');
  } else {
    console.error('❌ FAIL: Some workers failed during stress test.');
  }
}

async function testStaleLockRecovery() {
  console.log('\n--- 🛡️ TEST: Stale Lock Recovery (Wait for timeout) ---');
  setup();
  
  const credPath = getCredentialsPath();
  
  // Manually create a lock file to simulate a crash
  writeFileSync(credPath + '.lock', 'stale-lock-data');
  console.log('Created stale lock file manually...');
  
  const start = Date.now();
  console.log('Starting worker that must force refresh and hit the lock...');
  
  // Force refresh ('race' type) to ensure it tries to acquire the lock
  await runWorker('RECOVERY_W1', 'race');
  
  const elapsed = Date.now() - start;
  console.log(`Worker finished in ${elapsed}ms`);
  
  if (!existsSync(SHARED_LOG)) {
    console.error('❌ FAIL: No log file created');
    return;
  }

  const logContent = readFileSync(SHARED_LOG, 'utf8').trim();
  const results = logContent ? logContent.split('\n').map(l => JSON.parse(l)) : [];
  
  if (results.length > 0 && results[0].status === 'success' && elapsed >= 5000) {
    console.log('✅ PASS: Worker recovered from stale lock after timeout (>= 5s).');
  } else {
    console.error(`❌ FAIL: Worker finished in ${elapsed}ms (expected >= 5000ms) or failed.`);
    if (results.length > 0) console.error('Worker result:', results[0]);
  }
}

async function testCorruptedFileRecovery() {
  console.log('\n--- ☣️ TEST: Corrupted File Recovery ---');
  setup();
  
  const credPath = getCredentialsPath();
  // Write invalid JSON to credentials file
  writeFileSync(credPath, 'NOT_JSON_DATA_CORRUPTED_{{{');
  console.log('Corrupted credentials file manually...');
  
  // Worker should handle JSON parse error and ideally trigger re-auth or return null safely
  await runWorker('CORRUPT_W1', 'corrupt');
  
  if (!existsSync(SHARED_LOG)) {
    console.error('❌ FAIL: No log file created');
    return;
  }

  const logContent = readFileSync(SHARED_LOG, 'utf8').trim();
  const results = logContent ? logContent.split('\n').map(l => JSON.parse(l)) : [];
  
  if (results.length > 0) {
    console.log('Worker finished. Status:', results[0].status);
    console.log('✅ PASS: Worker handled corrupted file without crashing.');
  } else {
    console.error('❌ FAIL: Worker crashed or produced no log.');
  }
}

async function main() {
  try {
    await testRaceCondition();
    await testStressConcurrency();
    await testStaleLockRecovery();
    await testCorruptedFileRecovery();
    console.log('\n🌟 ALL ROBUST TESTS COMPLETED 🌟');
  } catch (error) {
    console.error('Test Runner Error:', error);
    process.exit(1);
  }
}

main();
