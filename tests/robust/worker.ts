/**
 * Robust Test Worker
 * 
 * Executed as a separate process to simulate concurrent plugin instances.
 */

import { tokenManager } from '../../src/plugin/token-manager.js';
import { appendFileSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const workerId = process.argv[2] || 'unknown';
const testType = process.argv[3] || 'standard';
const sharedLogPath = process.argv[4];

async function logResult(data: any) {
  if (!sharedLogPath) {
    console.log(JSON.stringify(data));
    return;
  }

  const result = {
    workerId,
    timestamp: Date.now(),
    pid: process.pid,
    ...data
  };

  appendFileSync(sharedLogPath, JSON.stringify(result) + '\n');
}

async function runTest() {
  try {
    switch (testType) {
      case 'race':
        // Scenario: Multi-process race for refresh
        const creds = await tokenManager.getValidCredentials(true);
        await logResult({
          status: 'success',
          token: creds?.accessToken
        });
        break;

      case 'corrupt':
        // This worker just tries to get credentials while the file is corrupted
        const c3 = await tokenManager.getValidCredentials();
        await logResult({ status: 'success', token: c3?.accessToken?.substring(0, 10) });
        break;

      case 'stress':
        // High frequency requests
        for (let i = 0; i < 5; i++) {
          await tokenManager.getValidCredentials(i === 0);
          await new Promise(r => setTimeout(r, Math.random() * 200));
        }
        await logResult({ status: 'completed_stress' });
        break;

      default:
        const c2 = await tokenManager.getValidCredentials();
        await logResult({ status: 'success', token: c2?.accessToken?.substring(0, 10) });
    }
  } catch (error: any) {
    await logResult({ status: 'error', error: error.message });
    process.exit(1);
  }
}

runTest().catch(async (e) => {
  await logResult({ status: 'fatal', error: e.message });
  process.exit(1);
});
