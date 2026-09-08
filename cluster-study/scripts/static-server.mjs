/**
 * Minimal static server for verifying the standalone export without the
 * Worker (mirrors double-clicking the file: no /data, no APIs, no CDN).
 * Usage: node scripts/static-server.mjs [port] [dir]
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const port = parseInt(process.argv[2] || '8790', 10);
const dir = resolve(process.argv[3] || join(dirname(fileURLToPath(import.meta.url)), '..', 'export'));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };

createServer(async (req, res) => {
  const path = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  try {
    const body = await readFile(join(dir, path));
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}).listen(port, () => console.log(`Serving ${dir} on http://localhost:${port}`));
