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

  await app.start(env.PORT);
  console.log(`gecko_reporting_workflow is running on port ${env.PORT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
