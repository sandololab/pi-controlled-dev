// Test-only extension for the real Pi executable (-e, --print, --no-session).
// Not a host implementation and not shipped in the package archive.
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { loadRpc } from './load-rpc.mjs';
import { loadContracts } from './load-contracts.mjs';

export default function rpcHostProbe(pi) {
  pi.registerCommand('controlled-rpc-probe', {
    description: 'Explicit bounded, read-only RPC compatibility probe',
    async handler(_args, ctx) {
      const reportPath = process.env.PI_CONTROLLED_DEV_PROBE_REPORT;
      if (!reportPath) throw new Error('Explicit probe report path required');
      const environment = {
        piVersion: process.env.PI_CONTROLLED_DEV_PROBE_PI_VERSION,
        subagentsVersion: process.env.PI_CONTROLLED_DEV_PROBE_SUBAGENTS_VERSION,
        nodeVersion: process.version, cwd: ctx.cwd, sessionId: ctx.sessionManager.getSessionId(),
        adapterSha256: createHash('sha256').update(readFileSync(new URL('../src/pi-subagents-rpc.ts', import.meta.url))).digest('hex'),
      };
      const report = { host: 'pi-cli', environment, requests: [], replies: [], completions: [], result: 'BLOCKED' };
      const listeners = new Set();
      const events = {
        on(name, callback) {
          const off = pi.events.on(name, value => {
            if (name.startsWith('subagents:rpc:v1:reply:')) report.replies.push(value);
            else report.completions.push(value);
            callback(value);
          });
          const dispose = () => { off(); listeners.delete(dispose); };
          listeners.add(dispose); return dispose;
        },
        emit(name, value) { report.requests.push(value); pi.events.emit(name, value); },
      };
      let adapter, timer, stopObserving;
      try {
        pi.setActiveTools([]);
        const { RpcAdapter } = await loadRpc();
        const { hashCanonical } = await loadContracts();
        adapter = new RpcAdapter(events, {
          sessionId: environment.sessionId, environmentHash: hashCanonical(environment),
          piVersion: environment.piVersion, subagentsVersion: environment.subagentsVersion,
        }, 15000);
        report.handshake = await adapter.handshake();
        if (report.handshake.status !== 'VERIFIED') throw new Error('HANDSHAKE_UNVERIFIED');
        let notify;
        const wake = new Promise(resolve => { notify = resolve; });
        stopObserving = adapter.observe(() => notify());
        const nonce = randomUUID(); report.nonce = nonce;
        const schema = { type: 'object', properties: { nonce: { type: 'string', const: nonce }, status: { type: 'string', const: 'ok' } }, required: ['nonce','status'], additionalProperties: false };
        report.spawn = await adapter.spawn({
          agent: 'reviewer', task: `Read-only transport probe, not a review. Do not read or modify files, use Git, access credentials, delegate, or contact anyone. Invoke only the structured output protocol to return exactly {"nonce":"${nonce}","status":"ok"}.`,
          cwd: ctx.cwd, timeoutMs: 45000, outputSchema: schema,
        });
        if (!report.spawn.ok) throw new Error(report.spawn.error.code);
        const { runId } = report.spawn.value;
        const validate = value => value && typeof value === 'object' && !Array.isArray(value)
          && Object.keys(value).sort().join(',') === 'nonce,status' && value.nonce === nonce && value.status === 'ok'
          ? { ok: true, level: 'probe-schema-only', value } : { ok: false };
        report.statusBefore = await adapter.status(runId);
        let acquired = adapter.acquire(runId, validate);
        if (!acquired.ok && acquired.error.code === 'COMPLETION_PENDING') {
          await Promise.race([wake, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('COMPLETION_TIMEOUT')), 60000); })]);
          clearTimeout(timer); acquired = adapter.acquire(runId, validate);
        }
        report.acquired = acquired;
        if (!acquired.ok) throw new Error(acquired.error.code);
        report.statusAfter = await adapter.status(runId);
        if (!report.statusAfter.ok || report.statusAfter.value.state !== 'complete') throw new Error('TERMINAL_RUN_UNVERIFIED');
        if (!adapter.integrity().ok) throw new Error('TRANSPORT_CONFLICT');
        report.evidenceDraft = adapter.evidence('probe-evidence', 'rpc-async-structured-output', ['probe-report']);
        report.result = 'PASS';
      } catch (error) { report.error = String(error); }
      finally {
        clearTimeout(timer); stopObserving?.();
        report.issues = adapter?.issues(); adapter?.dispose();
        report.remainingProbeListeners = listeners.size;
        writeFileSync(reportPath, JSON.stringify(report, null, 2), { mode: 0o600, flag: 'wx' });
      }
    },
  });
}
