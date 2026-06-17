import { describe, it, expect } from 'vitest';
import {
  buildSpawnDiagnosis,
  diagnoseSpawnFailure,
  resolveOnPath,
} from './spawn-diagnostics.js';

describe('buildSpawnDiagnosis', () => {
  const sshOk = '/usr/bin/ssh';

  it('reports pty exhaustion for explicit forkpty errors regardless of headroom', () => {
    const msg = buildSpawnDiagnosis({
      raw: 'forkpty(3) failed: Device not configured',
      sshPath: sshOk,
      ptyCount: 10, // plenty of headroom, but the error names the pty subsystem
      ptyMax: 511,
    });
    expect(msg).toMatch(/out of pseudo-terminals/i);
    expect(msg).toMatch(/restart macOS/i);
    expect(msg).toContain('(10/511 in use)');
  });

  it('reports pty exhaustion when allocation is near the limit', () => {
    const msg = buildSpawnDiagnosis({
      raw: 'posix_spawnp failed.',
      sshPath: sshOk,
      ptyCount: 505,
      ptyMax: 511,
    });
    expect(msg).toMatch(/out of pseudo-terminals/i);
    expect(msg).toMatch(/restart macOS/i);
  });

  it('does NOT blame ptys or suggest restart when ptys have headroom', () => {
    const msg = buildSpawnDiagnosis({
      raw: 'posix_spawnp failed.',
      sshPath: sshOk,
      ptyCount: 57,
      ptyMax: 511,
    });
    expect(msg).toMatch(/temporary resource limit/i);
    expect(msg).toMatch(/not pty exhaustion/i);
    expect(msg).not.toMatch(/restart macOS/i);
  });

  it('reports a missing ssh binary instead of pty exhaustion', () => {
    const msg = buildSpawnDiagnosis({
      raw: 'posix_spawnp failed.',
      sshPath: null,
      ptyCount: 57,
      ptyMax: 511,
    });
    expect(msg).toMatch(/could not be found on PATH/i);
    expect(msg).not.toMatch(/restart macOS/i);
  });

  it('still works when pty usage is unknown (no false counts, no restart advice)', () => {
    const msg = buildSpawnDiagnosis({
      raw: 'posix_spawnp failed.',
      sshPath: sshOk,
      ptyCount: NaN,
      ptyMax: NaN,
    });
    expect(msg).toMatch(/could not start the ssh process/i);
    expect(msg).not.toMatch(/\d+\/\d+/);
    expect(msg).not.toMatch(/restart macOS/i);
  });

  it('always preserves the raw error for debugging', () => {
    const msg = buildSpawnDiagnosis({
      raw: 'posix_spawnp failed.',
      sshPath: sshOk,
      ptyCount: 57,
      ptyMax: 511,
    });
    expect(msg).toContain('(posix_spawnp failed.)');
  });
});

describe('diagnoseSpawnFailure (with injected probes)', () => {
  it('threads probe results into the diagnosis', () => {
    const msg = diagnoseSpawnFailure(new Error('posix_spawnp failed.'), {
      pathEnv: '/usr/bin',
      resolveExecutable: () => '/usr/bin/ssh',
      getPtyUsage: () => ({ count: 600, max: 511 }),
    });
    expect(msg).toMatch(/out of pseudo-terminals/i);
  });

  it('survives a throwing pty probe and still gives a useful message', () => {
    const msg = diagnoseSpawnFailure('posix_spawnp failed.', {
      resolveExecutable: () => '/usr/bin/ssh',
      getPtyUsage: () => { throw new Error('boom'); },
    });
    expect(msg).toMatch(/could not start the ssh process/i);
  });

  it('accepts a plain string error', () => {
    const msg = diagnoseSpawnFailure('posix_spawnp failed.', {
      resolveExecutable: () => null,
      getPtyUsage: () => ({ count: 0, max: 511 }),
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
