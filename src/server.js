import { createApp } from "./app.js";

const host = process.env.HOST || "127.0.0.1";
const rawPort = process.env.PORT ?? "3000";
if (!/^\d+$/.test(rawPort) || !Number.isSafeInteger(Number(rawPort)) || Number(rawPort) > 65535) {
  console.error("PORT must be an integer between 0 and 65535.");
  process.exit(1);
}

const server = createApp().listen(Number(rawPort), host, () => {
  console.log(`BugBridge API listening at http://${host}:${server.address().port}`);
});
server.on("error", () => {
  console.error("BugBridge API could not start. Check HOST and PORT availability.");
  process.exitCode = 1;
});
let shutdownTimer;
function shutdown() {
  if (shutdownTimer) return;
  server.close(() => clearTimeout(shutdownTimer));
  shutdownTimer = setTimeout(() => {
    server.closeAllConnections();
  }, 5000);
  shutdownTimer.unref();
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
