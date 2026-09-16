/** Development-only server: actual Next route/auth and collector, loopback socket. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { GET, POST } from '../../src/app/api/kyst-diagnostics/route';
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    if (url.pathname === '/api/kyst-diagnostics') {
      const data: Buffer[] = [];
      for await (const chunk of req) data.push(chunk);
      const request = new Request(url, {
        method: req.method,
        headers: req.headers as Record<string, string>,
        body: req.method === 'POST' ? Buffer.concat(data) : undefined,
      });
      const response = await (req.method === 'GET' ? GET(request) : POST(request));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    if (url.pathname === '/entry.js') {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(fs.readFileSync(process.env.ENTRY_BUNDLE!));
      return;
    }
    if (url.pathname === '/outer') {
      res.setHeader('Content-Type', 'text/html');
      res.end(
        '<iframe style="position:fixed;inset:0;width:100%;height:100%;border:0" src="/"></iframe>'
      );
      return;
    }
    if (url.pathname === '/') {
      // Controlled development DOM, explicitly not a production-board or native fixture.
      res.setHeader('Content-Type', 'text/html');
      res.end(
        `<style>${fs.readFileSync('src/styles/kyst-theme.css', 'utf8').match(/\.kyst-board \{[\s\S]*?\n\}/)?.[0]}</style><body style="margin:0"><main class="kyst-board" data-kyst-theme="nox">${['Calendar', 'Clock', 'Weather', 'Tasks', 'Chores', 'Points', 'Family Messages'].map((n) => `<section class="kyst-widget" data-widget="${n}">${n}${n === 'Calendar' ? '<div data-board-scroll style="overflow-y:auto;height:300px;width:500px">' + Array.from({ length: 60 }, (_, i) => '<p>Calendar fixture ' + i + '</p>').join('') + '</div>' : ''}</section>`).join('')}</main><script src="/entry.js"></script></body>`
      );
      return;
    }
    res.writeHead(404);
    res.end();
  } catch (e) {
    res.writeHead(500);
    res.end(String(e));
  }
});
server.listen(Number(process.env.TEST_PORT || 4397), '127.0.0.1', () =>
  console.log('development collector listening')
);
