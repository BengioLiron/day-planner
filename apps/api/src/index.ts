import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { checkProductionEnv, env } from "./env.js";

checkProductionEnv();

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`Day Planner on port ${info.port}${env.webDist ? " (serving the web app)" : ""} at ${env.publicUrl}`);
});
