import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { chat } from '../server/chat.mjs';

export const config = { api: { bodyParser: false } };
export const maxDuration = 60;

export default async function handler(req, res, dependencies) {
  const controller = new AbortController();
  res.on('close', () => { if (!res.writableFinished) controller.abort(); });
  try {
    const request = new Request('http://localhost/api/chat', {
      method: req.method, headers: { authorization: req.headers.authorization ?? '', 'content-type': 'application/json',
        ...(req.headers['content-length'] ? { 'content-length': req.headers['content-length'] } : {}) },
      signal: controller.signal,
      ...(req.method === 'POST' ? { body: req.body === undefined ? Readable.toWeb(req) : typeof req.body === 'string' ? req.body : JSON.stringify(req.body), duplex: 'half' } : {}),
    });
    const response = await chat(request, dependencies);
    res.statusCode = response.status;
    response.headers.forEach((value, name) => res.setHeader(name, value));
    if (response.body) await pipeline(Readable.fromWeb(response.body), res);
    else res.end();
  } catch {
    controller.abort();
    if (!res.headersSent) { res.statusCode = 503; res.setHeader('content-type', 'application/json'); res.end('{"message":"Chat indisponível."}'); }
    else res.end();
  }
}
