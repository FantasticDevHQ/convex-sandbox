import { defineApp } from "convex/server";
import sandbox from "../../src/component/convex.config.js";

const app = defineApp();
app.use(sandbox);
export default app;
