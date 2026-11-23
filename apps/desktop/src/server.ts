/**
 * The parts of the API server the desktop app uses. Loaded with a dynamic
 * import only after main.ts has set the environment, because the server
 * reads its settings when its modules load.
 */
export { app as server } from "../../api/src/app.js";
export { googleAuthUrl, exchangeCode } from "../../api/src/calendar/google.js";
export { saveGoogleConnection } from "../../api/src/calendar/index.js";
