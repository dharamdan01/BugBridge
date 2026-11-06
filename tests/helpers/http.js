import { createServer } from "node:http";
import { createApp } from "../../src/app.js";

export async function startTestApi(t) {
  const server = createServer(createApp());
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return async function request(path, { json, ...options } = {}) {
    if (json !== undefined) {
      options.body = JSON.stringify(json);
      options.headers = { ...options.headers, "Content-Type": "application/json" };
    }
    const response = await fetch(`${origin}${path}`, {
      ...options, signal: AbortSignal.timeout(5000),
    });
    return { status: response.status, headers: response.headers, body: await response.json() };
  };
}
