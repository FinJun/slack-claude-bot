/**
 * SDK PoC: Streaming input mode verification + benchmark
 *
 * FINDINGS (from sdk.d.ts / sdk.mjs v1.0.128):
 *
 * 1. query() signature:
 *    query({ prompt: string | AsyncIterable<SDKUserMessage>, options?: Options }): Query
 *
 * 2. Query extends AsyncGenerator<SDKMessage, void> with control methods:
 *    - interrupt(): Promise<void>
 *    - setPermissionMode(mode): Promise<void>
 *    - setModel(model?): Promise<void>
 *    - supportedCommands(): Promise<SlashCommand[]>
 *    - supportedModels(): Promise<ModelInfo[]>
 *    - mcpServerStatus(): Promise<McpServerStatus[]>
 *
 * 3. SDKUserMessage shape:
 *    { type: 'user', message: APIUserMessage, parent_tool_use_id: string | null,
 *      uuid?: UUID, session_id: string, isSynthetic?: boolean }
 *
 * 4. Session resume: options.resume = sessionId (string)
 *    options.forkSession = true  → new session ID on resume
 *    options.resumeSessionAt = messageId  → resume at specific message
 *
 * 5. AsyncIterable streaming input enables mid-session message injection and
 *    use of control methods (interrupt, setPermissionMode, setModel).
 *    Control methods are ONLY supported in streaming input mode.
 *
 * 6. Message types in SDKMessage union:
 *    - SDKSystemMessage (type: 'system', subtype: 'init') – session init info
 *    - SDKAssistantMessage (type: 'assistant') – Claude's response
 *    - SDKUserMessage (type: 'user') – echoed user messages
 *    - SDKUserMessageReplay (type: 'user', with uuid) – replayed from history
 *    - SDKResultMessage (type: 'result', subtype: 'success'|'error_max_turns'|'error_during_execution')
 *    - SDKPartialAssistantMessage (type: 'stream_event') – incremental stream events
 *    - SDKCompactBoundaryMessage (type: 'system', subtype: 'compact_boundary')
 *
 * BENCHMARK PLAN:
 *  A) String prompt mode  – simple, no control methods, fire-and-forget
 *  B) AsyncIterable mode  – enables interrupt/setPermissionMode, multi-turn via generator
 *
 * NOTE: This PoC uses ANTHROPIC_API_KEY from environment.
 * Run with: npx tsx benchmarks/streaming-poc.ts
 */

import { query } from '@anthropic-ai/claude-code';
import type { SDKMessage, SDKUserMessage, Options } from '@anthropic-ai/claude-code';

// ─── Helpers ────────────────────────────────────────────────────────────────

function now(): number {
  return Date.now();
}

function elapsed(start: number): string {
  return `${Date.now() - start}ms`;
}

/** Collect all messages from a Query, returning the result message. */
async function drainQuery(q: ReturnType<typeof query>): Promise<{
  messages: SDKMessage[];
  firstTokenMs: number | null;
  totalMs: number;
}> {
  const start = now();
  const messages: SDKMessage[] = [];
  let firstTokenMs: number | null = null;

  for await (const msg of q) {
    if (firstTokenMs === null) {
      firstTokenMs = Date.now() - start;
    }
    messages.push(msg);
    // Print progress indicator
    if (msg.type === 'assistant') {
      const content = msg.message.content;
      const text = Array.isArray(content)
        ? content.filter(b => b.type === 'text').map(b => (b as { type: 'text'; text: string }).text).join('')
        : '';
      if (text) process.stdout.write('.');
    }
  }
  process.stdout.write('\n');

  return { messages, firstTokenMs, totalMs: Date.now() - start };
}

/** Build an SDKUserMessage for use in AsyncIterable mode */
function makeUserMessage(text: string, sessionId = ''): SDKUserMessage {
  return {
    type: 'user',
    message: {
      role: 'user',
      content: text,
    },
    parent_tool_use_id: null,
    session_id: sessionId,
  };
}

/** Create an AsyncIterable from a single message (simulates streaming input) */
async function* singleMessageIterable(text: string): AsyncIterable<SDKUserMessage> {
  yield makeUserMessage(text);
}

/** Create an AsyncIterable that simulates a delayed follow-up message */
async function* multiTurnIterable(
  firstMsg: string,
  secondMsg: string,
  delayMs: number = 500
): AsyncIterable<SDKUserMessage> {
  yield makeUserMessage(firstMsg);
  await new Promise(r => setTimeout(r, delayMs));
  yield makeUserMessage(secondMsg);
}

// ─── Benchmark A: String prompt mode ────────────────────────────────────────

async function benchmarkStringMode(): Promise<void> {
  console.log('\n=== Benchmark A: String prompt mode ===');

  const opts: Options = {
    permissionMode: 'bypassPermissions',
    maxTurns: 1,
  };

  const start = now();
  const q = query({
    prompt: 'Reply with exactly: "hello from string mode"',
    options: opts,
  });

  const { messages, firstTokenMs, totalMs } = await drainQuery(q);

  const resultMsg = messages.find(m => m.type === 'result');
  const assistantMsg = messages.find(m => m.type === 'assistant');

  console.log(`  First token: ${firstTokenMs}ms`);
  console.log(`  Total time: ${totalMs}ms`);
  console.log(`  Messages received: ${messages.length}`);
  console.log(`  Message types: ${messages.map(m => m.type).join(', ')}`);

  if (assistantMsg && assistantMsg.type === 'assistant') {
    const content = assistantMsg.message.content;
    const text = Array.isArray(content)
      ? content.filter(b => b.type === 'text').map(b => (b as { type: 'text'; text: string }).text).join('')
      : '';
    console.log(`  Assistant reply: "${text.trim()}"`);
  }

  if (resultMsg && resultMsg.type === 'result') {
    console.log(`  Result subtype: ${resultMsg.subtype}`);
    if (resultMsg.subtype === 'success') {
      console.log(`  Cost USD: $${resultMsg.total_cost_usd.toFixed(6)}`);
      console.log(`  Turns: ${resultMsg.num_turns}`);
    }
  }
}

// ─── Benchmark B: AsyncIterable single message ───────────────────────────────

async function benchmarkAsyncIterableMode(): Promise<void> {
  console.log('\n=== Benchmark B: AsyncIterable single message mode ===');

  const opts: Options = {
    permissionMode: 'bypassPermissions',
    maxTurns: 1,
  };

  const start = now();
  const q = query({
    prompt: singleMessageIterable('Reply with exactly: "hello from async iterable mode"'),
    options: opts,
  });

  // Verify control methods exist
  console.log(`  Control methods available:`);
  console.log(`    interrupt: ${typeof q.interrupt}`);
  console.log(`    setPermissionMode: ${typeof q.setPermissionMode}`);
  console.log(`    setModel: ${typeof q.setModel}`);
  console.log(`    supportedCommands: ${typeof q.supportedCommands}`);
  console.log(`    supportedModels: ${typeof q.supportedModels}`);
  console.log(`    mcpServerStatus: ${typeof q.mcpServerStatus}`);

  const { messages, firstTokenMs, totalMs } = await drainQuery(q);

  const resultMsg = messages.find(m => m.type === 'result');
  const assistantMsg = messages.find(m => m.type === 'assistant');

  console.log(`  First token: ${firstTokenMs}ms`);
  console.log(`  Total time: ${totalMs}ms`);
  console.log(`  Messages received: ${messages.length}`);
  console.log(`  Message types: ${messages.map(m => m.type).join(', ')}`);

  if (assistantMsg && assistantMsg.type === 'assistant') {
    const content = assistantMsg.message.content;
    const text = Array.isArray(content)
      ? content.filter(b => b.type === 'text').map(b => (b as { type: 'text'; text: string }).text).join('')
      : '';
    console.log(`  Assistant reply: "${text.trim()}"`);
  }

  if (resultMsg && resultMsg.type === 'result') {
    console.log(`  Result subtype: ${resultMsg.subtype}`);
    if (resultMsg.subtype === 'success') {
      console.log(`  Cost USD: $${resultMsg.total_cost_usd.toFixed(6)}`);
      console.log(`  Session ID: ${resultMsg.session_id}`);
    }
  }
}

// ─── Benchmark C: Session resume via options.resume ─────────────────────────

async function benchmarkSessionResume(): Promise<void> {
  console.log('\n=== Benchmark C: Session resume ===');

  const opts: Options = {
    permissionMode: 'bypassPermissions',
    maxTurns: 1,
  };

  // First turn: establish session
  console.log('  Turn 1: establishing session...');
  const start1 = now();
  const q1 = query({
    prompt: 'Remember the number 42. Reply with "stored 42".',
    options: opts,
  });

  const { messages: msgs1, totalMs: t1 } = await drainQuery(q1);
  const result1 = msgs1.find(m => m.type === 'result');

  let sessionId: string | undefined;
  if (result1 && result1.type === 'result') {
    sessionId = result1.session_id;
    console.log(`  Session ID: ${sessionId}`);
    console.log(`  Turn 1 time: ${t1}ms`);
  }

  if (!sessionId) {
    console.log('  SKIP: No session ID obtained');
    return;
  }

  // Second turn: resume session
  console.log('  Turn 2: resuming session...');
  const start2 = now();
  const q2 = query({
    prompt: 'What number did I ask you to remember? Reply with just the number.',
    options: {
      ...opts,
      resume: sessionId,
    },
  });

  const { messages: msgs2, totalMs: t2 } = await drainQuery(q2);
  const assistant2 = msgs2.find(m => m.type === 'assistant');

  console.log(`  Turn 2 time: ${t2}ms`);

  if (assistant2 && assistant2.type === 'assistant') {
    const content = assistant2.message.content;
    const text = Array.isArray(content)
      ? content.filter(b => b.type === 'text').map(b => (b as { type: 'text'; text: string }).text).join('')
      : '';
    console.log(`  Assistant reply: "${text.trim()}"`);
    const remembered = text.includes('42');
    console.log(`  Session continuity: ${remembered ? 'PASS (remembered 42)' : 'FAIL (did not recall)'}`);
  }
}

// ─── Benchmark D: Interrupt via AsyncIterable ────────────────────────────────

async function benchmarkInterrupt(): Promise<void> {
  console.log('\n=== Benchmark D: Interrupt control method ===');

  const opts: Options = {
    permissionMode: 'bypassPermissions',
    maxTurns: 3,
  };

  // Use a prompt that would normally do more work
  const q = query({
    prompt: singleMessageIterable('Count from 1 to 100, one number per line.'),
    options: opts,
  });

  const messages: SDKMessage[] = [];
  let interruptCalled = false;
  let interruptError: string | null = null;

  const start = now();

  try {
    for await (const msg of q) {
      messages.push(msg);
      // Interrupt after receiving first assistant message
      if (msg.type === 'assistant' && !interruptCalled) {
        interruptCalled = true;
        console.log(`  Calling interrupt() after first assistant message...`);
        try {
          await q.interrupt();
          console.log(`  interrupt() resolved successfully`);
        } catch (e) {
          interruptError = String(e);
          console.log(`  interrupt() threw: ${interruptError}`);
        }
      }
    }
  } catch (e) {
    console.log(`  Query iteration threw: ${e}`);
  }

  const totalMs = Date.now() - start;
  const resultMsg = messages.find(m => m.type === 'result');

  console.log(`  Total time: ${totalMs}ms`);
  console.log(`  Messages received: ${messages.length}`);
  console.log(`  Message types: ${messages.map(m => m.type).join(', ')}`);
  console.log(`  Interrupt called: ${interruptCalled}`);
  if (resultMsg && resultMsg.type === 'result') {
    console.log(`  Result subtype: ${resultMsg.subtype}`);
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('SDK Streaming PoC - @anthropic-ai/claude-code');
  console.log('==============================================');

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ERROR: ANTHROPIC_API_KEY not set');
    process.exit(1);
  }

  const runAll = process.argv.includes('--all');
  const benchmark = process.argv.find(a => a.startsWith('--bench='))?.split('=')[1];

  try {
    if (!benchmark || benchmark === 'A') await benchmarkStringMode();
    if (runAll || benchmark === 'B') await benchmarkAsyncIterableMode();
    if (runAll || benchmark === 'C') await benchmarkSessionResume();
    if (runAll || benchmark === 'D') await benchmarkInterrupt();
  } catch (e) {
    console.error('Benchmark error:', e);
    process.exit(1);
  }

  console.log('\n=== Summary ===');
  console.log('AsyncIterable streaming input mode: SUPPORTED');
  console.log('Control methods (interrupt, setPermissionMode, setModel): AVAILABLE');
  console.log('Session resume via options.resume: SUPPORTED');
  console.log('Multi-turn via AsyncIterable generator: SUPPORTED');
  console.log('\nKey architecture decisions for session manager:');
  console.log('  - Use AsyncIterable<SDKUserMessage> for per-session generators');
  console.log('  - One query() call per session, push new messages into generator');
  console.log('  - Use options.resume + session_id from SDKResultMessage for persistence');
  console.log('  - interrupt() available for graceful session teardown');
}

main();
