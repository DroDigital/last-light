import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const run = (command: string, value: string) => spawnSync('bash', ['scripts/release-inputs.sh', command, value], { encoding: 'utf8' });

describe('release input normalization', () => {
  it.each([
    ['digitaldro/last-light', 'digitaldro/last-light'],
    ['digitaldro/last-light/', 'digitaldro/last-light'],
    ['digitaldro.itch.io/last-light', 'digitaldro/last-light'],
    ['https://digitaldro.itch.io/last-light/', 'digitaldro/last-light'],
  ])('normalizes itch target %s', (input, expected) => {
    const result = run('itch-target', input);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(expected);
  });
  it.each([
    '', 'http://digitaldro.itch.io/last-light', 'https://evil.com/last-light',
    'digitaldro.itch.io/last-light?x=1', 'digitaldro/last-light/extra',
    'digitaldro/../last-light', 'digitaldro/last-light\nEVIL=1',
    '-digitaldro/last-light', 'digitaldro/-last-light',
    'https://-digitaldro.itch.io/last-light', 'digitaldro.itch.io/-last-light',
    '$(touch /tmp/never)/last-light', 'https://digitaldro.itch.io:443/last-light',
  ])('rejects malformed or unsafe itch target %j', (input) => {
    const result = run('itch-target', input);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
  });
  it.each([['v1.0.0', '1.0.0'], ['v1.0.0-retry.1', '1.0.0'], ['v10.20.30-retry.12', '10.20.30']])(
    'extracts release version from tag %s', (input, expected) => {
      const result = run('version-tag', input);
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe(expected);
    },
  );
  it.each(['1.0.0', 'v01.0.0', 'v1.0.0-retry.0', 'v1.0.0-retry.01', 'v1.0.0-rc.1', 'v1.0.0-retry.1/evil'])('rejects invalid tag %s', (input) => {
    const result = run('version-tag', input);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
  });
});
