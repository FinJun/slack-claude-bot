/**
 * Memory benchmark for slack-claude-bot SDK sessions.
 *
 * Measures:
 *  A) RSS memory of a single persistent subprocess at idle
 *  B) RSS memory of a single subprocess while active (receiving a message)
 *  C) RSS memory with 3 concurrent sessions
 *
 * Run with: npx tsx benchmarks/memory-profile.ts
 * Requires ANTHROPIC_API_KEY to be set.
 *
 * NOTE: These are process-level RSS measurements (via process.memoryUsage().rss).
 * They include the Node.js heap, native modules, and the spawned claude subprocess.
 * Each sdk query() call spawns a child process; memory numbers reflect the
 * parent Node process only. Subprocess memory is separate.
 */

import { query } from '@anthropic-ai/claude-code';
import type { SDKUserMessage, Options } from '@anthropic-ai/claude-code';

function mbRss(): number {
  return Math.round(process.memoryUsage().rss / 1024 / 1024);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function* singleMsg(text: string): AsyncIterable<SDKUserMessage> {
  yield { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null, session_id: '' };
}

const BASE_OPTS: Options = {
  permissionMode: 'bypassPermissions',
  maxTurns: 1,
};

/** Drain a query and return elapsed ms */
async function drain(q: ReturnType<typeof query>): Promise<{ elapsedMs: number; cost: number }> {
  const start = Date.now();
  let cost = 0;
  for await (const msg of q) {
    if (msg.type === 'result' && msg.subtype === 'success') {
      cost = msg.total_cost_usd;
    }
  }
  return { elapsedMs: Date.now() - start, cost };
}

// ─── Benchmark A: Baseline (no sessions) ─────────────────────────────────────

async function benchmarkBaseline(): Promise<number> {
  console.log('\n=== Benchmark A: Baseline RSS (no sessions) ===');
  // Force GC if available
  if (typeof (globalThis as any).gc === 'function') (globalThis as any).gc();
  await sleep(200);
  const rss = mbRss();
  console.log(`  Baseline RSS: ${rss} MB`);
  return rss;
}

// ─── Benchmark B: Single session idle / active ───────────────────────────────

async function benchmarkSingleSession(baselineRss: number): Promise<void> {
  console.log('\n=== Benchmark B: Single session ===');

  const beforeRss = mbRss();
  console.log(`  RSS before session start: ${beforeRss} MB`);

  // Start session
  const q = query({
    prompt: singleMsg('Reply with exactly: "memory benchmark ok"'),
    options: BASE_OPTS,
  });

  const duringRss = mbRss();
  console.log(`  RSS after query() call (subprocess spawning): ${duringRss} MB`);
  console.log(`  Delta from baseline: +${duringRss - baselineRss} MB`);

  const { elapsedMs, cost } = await drain(q);

  if (typeof (globalThis as any).gc === 'function') (globalThis as any).gc();
  await sleep(300);
  const afterRss = mbRss();
  console.log(`  RSS after session completed + GC: ${afterRss} MB`);
  console.log(`  Delta from baseline: +${afterRss - baselineRss} MB`);
  console.log(`  Session elapsed: ${elapsedMs}ms, cost: $${cost.toFixed(6)}`);
}

// ─── Benchmark C: 3 concurrent sessions ──────────────────────────────────────

async function benchmarkConcurrentSessions(baselineRss: number): Promise<void> {
  console.log('\n=== Benchmark C: 3 concurrent sessions ===');

  const beforeRss = mbRss();
  console.log(`  RSS before: ${beforeRss} MB`);

  // Launch 3 sessions concurrently
  const sessions = Array.from({ length: 3 }, (_, i) =>
    query({
      prompt: singleMsg(`Session ${i + 1}: Reply with exactly: "concurrent session ${i + 1} ok"`),
      options: BASE_OPTS,
    })
  );

  const duringRss = mbRss();
  console.log(`  RSS with 3 sessions spawned: ${duringRss} MB`);
  console.log(`  Delta from baseline: +${duringRss - baselineRss} MB`);

  // Drain all concurrently
  const start = Date.now();
  const results = await Promise.all(sessions.map(drain));
  const totalMs = Date.now() - start;

  if (typeof (globalThis as any).gc === 'function') (globalThis as any).gc();
  await sleep(500);
  const afterRss = mbRss();

  const totalCost = results.reduce((sum, r) => sum + r.cost, 0);
  console.log(`  RSS after all sessions done + GC: ${afterRss} MB`);
  console.log(`  Delta from baseline: +${afterRss - baselineRss} MB`);
  console.log(`  All 3 sessions completed in ${totalMs}ms (wall clock)`);
  console.log(`  Total cost: $${totalCost.toFixed(6)}`);
  results.forEach((r, i) =>
    console.log(`  Session ${i + 1}: ${r.elapsedMs}ms`)
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('Memory Profile Benchmark - slack-claude-bot');
  console.log('=============================================');
  console.log(`Node.js: ${process.version}`);

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ERROR: ANTHROPIC_API_KEY not set');
    process.exit(1);
  }

  try {
    const baselineRss = await benchmarkBaseline();
    await benchmarkSingleSession(baselineRss);
    await benchmarkConcurrentSessions(baselineRss);
  } catch (err) {
    console.error('Benchmark error:', err);
    process.exit(1);
  }

  console.log('\n=== Complete ===');
  console.log('Note: RSS includes Node.js heap + native modules.');
  console.log('Each query() spawns a child process; child RSS is not reflected here.');
  console.log('Run with --expose-gc for more accurate post-GC numbers:');
  console.log('  node --expose-gc $(which tsx) benchmarks/memory-profile.ts');
}

main();
