import { createServer } from 'node:http';
import { createReadStream, promises as fs } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(fileURLToPath(new URL('.', import.meta.url)));
const port = Number(process.env.PORT ?? 4173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const safePath = resolve(rootDir, `.${decodeURIComponent(url.pathname)}`);
    if (!safePath.startsWith(rootDir)) {
      res.statusCode = 403;
      res.end('Forbidden');
      return;
    }

    const candidate = (await fs.stat(safePath)).isDirectory() ? join(safePath, 'index.html') : safePath;
    const mime = MIME[extname(candidate).toLowerCase()] ?? 'application/octet-stream';

    res.statusCode = 200;
    res.setHeader('Content-Type', mime);
    createReadStream(candidate).pipe(res);
  } catch (error) {
    res.statusCode = 404;
    res.end('Not found');
    if (process.env.DEBUG) {
      console.error('static server error', error);
    }
  }
});

server.listen(port, () => {
  console.log(`Realtime demo web running on http://localhost:${port}`);
});
