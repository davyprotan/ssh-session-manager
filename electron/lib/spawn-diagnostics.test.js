import { describe, it, expect } from 'vitest';
import {
  buildSpawnDiagnosis,
  diagnoseSpawnFailure,
  probePtyAvailability,
  resolveOnPath,
} from './spawn-diagnostics.js';

describe('buildSpawnDiagnosis', () => {
  const sshOk = '/usr/bin/ssh';

  it('reports pty exhaustion when the probe says the kernel is out of ptys', () => {
    const msg = buildSpawnDiagnosis({
      raw: 'posix_spawnp failed.',
      sshPath: sshOk,
      ptyAvailability: 'exhausted',
    });
    expect(msg).toMatch(/out of pseudo-terminals/i);
    expect(msg).toMatch(/restart macOS/i);
    expect(msg).toContain('(posix_spawnp failed.)');
  });

  it('reports pty exhaustion for explicit pty-subsystem errors even if probe is unknown', () => {
    const msg = buildSpawnDiagnosis({
      raw: 'forkpty(3) failed: Device not configured',
      sshPath: sshOk,
      ptyAvailability: 'unknown',
    });
    expect(msg).toMatch(/out of pseudo-terminals/i);
  });

  it('does NOT blame ptys or suggest restart when the probe says ptys are available', () => {
    const msg = buildSpawnDiagnosis({
      raw: 'posix_spawnp failed.',
      sshPath: sshOk,
      ptyAvailability: 'available',
    });
    expect(msg).toMatch(/temporary resource limit/i);
    expect(msg).toMatch(/per-user process cap/i);
    expect(msg).not.toMatch(/out of pseudo-terminals/i);
    expect(msg).not.toMatch(/restart macOS/i);
  });

  it('defaults to the process-cap message when pty availability is unknown', () => {
    const msg = buildSpawnDiagnosis({
      raw: 'posix_spawnp failed.',
      sshPath: sshOk,
      ptyAvailability: 'unknown',
    });
    expect(msg).toMatch(/could not start the ssh process/i);
    expect(msg).not.toMatch(/restart macOS/i);
  });

  it('never fabricates an in-use pty count like "527/511"', () => {
    const msg = buildSpawnDiagnosis({
      raw: 'posix_spawnp failed.',
      sshPath: sshOk,
      ptyAvailability: 'exhausted',
    });
    expect(msg).not.toMatch(/\d+\/\d+/);
  });

  it('reports a missing ssh binary instead of pty exhaustion (ptys available)', () => {
    const msg = buildSpawnDiagnosis({
      raw: 'posix_spawnp failed.',
      sshPath: null,
      ptyAvailability: 'available',
    });
    expect(msg).toMatch(/could not be found on PATH/i);
    expect(msg).not.toMatch(/restart macOS/i);
  });

  it('prioritises genuine pty exhaustion over a missing ssh binary', () => {
    // If the kernel can't give us a pty, that's the wall we hit first.
    const msg = buildSpawnDiagnosis({
      raw: 'posix_spawnp failed.',
      sshPath: null,
      ptyAvailability: 'exhausted',
    });
    expect(msg).toMatch(/out of pseudo-terminals/i);
  });

  it('always preserves the raw error for debugging', () => {
    const msg = buildSpawnDiagnosis({
      raw: 'posix_spawnp failed.',
      sshPath: sshOk,
      ptyAvailability: 'available',
    });
    expect(msg).toContain('(posix_spawnp failed.)');
  });
});

describe('probePtyAvailability', () => {
  it('returns "available" when /dev/ptmx opens and closes cleanly', () => {
    let closed = null;
    const result = probePtyAvailability({
      open: () => 42,
      close: (fd) => { closed = fd; },
    });
    expect(result).toBe('available');
    expect(closed).toBe(42);
  });

  it('returns "exhausted" on ENXIO (the real macOS out-of-ptys errno)', () => {
    const result = probePtyAvailability({
      open: () => { const e = new Error('ENXIO'); e.code = 'ENXIO'; throw e; },
    });
    expect(result).toBe('exhausted');
  });

  it('returns "exhausted" on EAGAIN / EMFILE / ENFILE', () => {
    for (const code of ['EAGAIN', 'EMFILE', 'ENFILE']) {
      const result = probePtyAvailability({
        open: () => { const e = new Error(code); e.code = code; throw e; },
      });
      expect(result).toBe('exhausted');
    }
  });

  it('returns "unknown" when /dev/ptmx does not exist (non-macOS/Linux)', () => {
    const result = probePtyAvailability({
      open: () => { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; },
    });
    expect(result).toBe('unknown');
  });
});

describe('diagnoseSpawnFailure (with injected probes)', () => {
  it('routes a kernel-confirmed pty exhaustion to the exhaustion message', () => {
    const msg = diagnoseSpawnFailure(new Error('posix_spawnp failed.'), {
      pathEnv: '/usr/bin',
      resolveExecutable: () => '/usr/bin/ssh',
      getPtyAvailability: () => 'exhausted',
    });
    expect(msg).toMatch(/out of pseudo-terminals/i);
    expect(msg).toMatch(/restart macOS/i);
  });

  it('defaults an ambiguous failure (ptys available) to the process-cap message', () => {
    const msg = diagnoseSpawnFailure('posix_spawnp failed.', {
      resolveExecutable: () => '/usr/bin/ssh',
      getPtyAvailability: () => 'available',
    });
    expect(msg).toMatch(/could not start the ssh process/i);
    expect(msg).not.toMatch(/\d+\/\d+/);
  });

  it('survives a throwing pty probe and still gives a useful message', () => {
    const msg = diagnoseSpawnFailure('posix_spawnp failed.', {
      resolveExecutable: () => '/usr/bin/ssh',
      getPtyAvailability: () => { throw new Error('boom'); },
    });
    expect(msg).toMatch(/could not start the ssh process/i);
  });

  it('accepts a plain string error and detects a missing ssh binary', () => {
    const msg = diagnoseSpawnFailure('posix_spawnp failed.', {
      resolveExecutable: () => null,
      getPtyAvailability: () => 'available',
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
