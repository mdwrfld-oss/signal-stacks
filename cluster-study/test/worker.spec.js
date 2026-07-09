import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

describe('worker routes', () => {
  it('/health reports secret presence', async () => {
    const resp = await SELF.fetch('https://example.com/health');
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.status).toBe('ok');
    expect(data.secrets).toHaveProperty('CLUSTER_KV');
  });

  it('/data falls back to the bundled seed graph when KV is empty', async () => {
    const resp = await SELF.fetch('https://example.com/data');
    expect(resp.status).toBe(200);
    const graph = await resp.json();
    expect(graph.source).toBe('seed');
    expect(graph.nodes.some((n) => n.id === 'white_claw' && n.type === 'hub')).toBe(true);
    expect(graph.links.some((l) => l.relationship === 'parent_of')).toBe(true);
    expect(graph.structural_analogs.length).toBeGreaterThan(0);
  });

  it('protected endpoints reject missing/wrong bearer tokens', async () => {
    for (const [path, method] of [
      ['/run', 'POST'],
      ['/api/rfp/run', 'POST'],
      ['/api/rfp/pending', 'GET'],
      ['/api/rfp/review', 'POST'],
    ]) {
      const resp = await SELF.fetch(`https://example.com${path}`, {
        method,
        headers: { Authorization: 'Bearer wrong' },
      });
      expect(resp.status, path).toBe(401);
    }
  });
});
