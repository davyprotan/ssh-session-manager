import { describe, it, expect } from 'vitest';
import {
  buildSpawnDiagnosis,
  diagnoseSpawnFailure,
  resolveOnPath,
} from './spawn-diagnostics.js';

describe('buildSpawnDiagnosis', () => {
  const sshOk = '/usr/bin/ssh';

  it('reports a pty allocation failure for explicit forkpty errors', () => {
    const msg = buildSpawnDiagnosis({
      raw: 'forkpty(3) failed: Device not configured',
      sshPath: sshOk,
    });
    expect(msg).toMatch(/pseudo-terminal/i);
    expect(msg).toMatch(/restart(ing)? macOS/i);
    expect(msg).toContain('(forkpty(3) failed: Device not configured)');
  });

  it('treats other explicit pty-subsystem errors as pty failures', () => {
    const msg = buildSpawnDiagnosis({
      raw: 'openpty failed: out of ptys',
      sshPath: sshOk,
    });
    expect(msg).toMatch(/pseudo-terminal/i);
  });

  it('does NOT blame ptys or suggest restart for the ambiguous spawn failure', () => {
    // macOS gives us no reliable live pty count, so an ambiguous
    // "posix_spawnp failed." must default to the process-cap explanation,
    // never a confident "out of ptys / restart macOS".
    const msg = buildSpawnDiagnosis({
      raw: 'posix_spawnp failed.',
      sshPath: sshOk,
    });
    expect(msg).toMatch(/temporary resource limit/i);
    expect(msg).toMatch(/per-user process cap/i);
    expect(msg).not.toMatch(/out of pseudo-terminals/i);
  });

  it('never fabricates an in-use pty count like "527/511"', () => {
    const msg = buildSpawnDiagnosis({
      raw: 'posix_spawnp failed.',
      sshPath: sshOk,
    });
    expect(msg).not.toMatch(/\d+\/\d+/);
  });

  it('reports a missing ssh binary instead of pty exhaustion', () => {
    const msg = buildSpawnDiagnosis({
      raw: 'posix_spawnp failed.',
      sshPath: null,
    });
    expect(msg).toMatch(/could not be found on PATH/i);
    expect(msg).not.toMatch(/restart macOS/i);
  });

  it('always preserves the raw error for debugging', () => {
    const msg = buildSpawnDiagnosis({
      raw: 'posix_spawnp failed.',
      sshPath: sshOk,
    });
    expect(msg).toContain('(posix_spawnp failed.)');
  });
});

describe('diagnoseSpawnFailure (with injected probes)', () => {
  it('routes an explicit pty error to the pty-allocation message', () => {
    const msg = diagnoseSpawnFailure(new Error('openpty failed'), {
      pathEnv: '/usr/bin',
      resolveExecutable: () => '/usr/bin/ssh',
    });
    expect(msg).toMatch(/pseudo-terminal/i);
  });

  it('defaults an ambiguous failure to the process-cap message', () => {
    const msg = diagnoseSpawnFailure('posix_spawnp failed.', {
      resolveExecutable: () => '/usr/bin/ssh',
    });
    expect(msg).toMatch(/could not start the ssh process/i);
    expect(msg).not.toMatch(/\d+\/\d+/);
  });

  it('accepts a plain string error and detects a missing ssh binary', () => {
    const msg = diagnoseSpawnFailure('posix_spawnp failed.', {
      resolveExecutable: () => null,
    });
    expect(msg).toMatch(/could not be found on PATH/i);
  });
});

describe('resolveOnPath', () => {
  it('finds an executable on a PATH-style string', () => {
    expect(resolveOnPath('ssh', '/nonexistent:/usr/bin')).toBe('/usr/bin/ssh');
  });

  it('returns null when not found', () => {
    expect(resolveOnPath('definitely-not-a-real-binary-xyz', '/usr/bin:/bin')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(resolveOnPath('', '/usr/bin')).toBeNull();
  });
});
