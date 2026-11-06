import { developmentAuthConfig } from "./live/authConfig";

// No issuer means no authentication providers, preserving key-free local setup.
export default developmentAuthConfig(process.env);
