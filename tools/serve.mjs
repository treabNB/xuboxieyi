import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '127.0.0.1';

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const requested = decoded.endsWith('/') ? `${decoded}index.html` : decoded;
  const resolved = path.resolve(root, `.${requested}`);
  return resolved.startsWith(root + path.sep) ? resolved : null;
}

createServer(async (request, response) => {
  const target = safePath(request.url || '/');
  if (!target) {
    response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Forbidden');
    return;
  }

  try {
    const info = await stat(target);
    const file = info.isDirectory() ? path.join(target, 'index.html') : target;
    const fileInfo = await stat(file);
    response.writeHead(200, {
      'Content-Type': contentTypes.get(path.extname(file)) || 'application/octet-stream',
      'Content-Length': fileInfo.size,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self' 'sha256-BkKP2XO6WOEc3kXOiLr2ZoY83hamalKjPY9xBcbXVuw='; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self' https://0.peerjs.com wss://0.peerjs.com; img-src 'self' data: blob:; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    });
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
}).listen(port, host, () => {
  console.log(`AFTERSHOT running at http://${host}:${port}/submission/`);
});
