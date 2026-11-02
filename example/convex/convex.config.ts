import { defineApp } from "convex/server";
import sandbox from "@fantastic.dev/convex-sandbox/convex.config.js";

const app = defineApp();
app.use(sandbox);
export default app;
