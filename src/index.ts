import { createServer } from "node:http";
import { App } from "@slack/bolt";
import { env } from "./config/env.js";
import { registerSlackHandlers } from "./slack/handlers.js";

async function main() {
  const app = new App({
    token: env.SLACK_BOT_TOKEN,
    signingSecret: env.SLACK_SIGNING_SECRET,
    socketMode: env.SLACK_USE_SOCKET_MODE,
    appToken: env.SLACK_APP_TOKEN
  });

  registerSlackHandlers(app);

  if (env.SLACK_USE_SOCKET_MODE) {
    // Cloud Run requires the container to bind to PORT even when Slack traffic
    // arrives over Socket Mode rather than inbound HTTP requests.
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("ok");
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(env.PORT, resolve);
    });

    await app.start();
  } else {
    await app.start(env.PORT);
  }

  console.log(`gecko_reporting_workflow is running on port ${env.PORT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
