import "express-session";

declare module "express-session" {
  interface SessionData {
    userId?: string;
    authSessionId?: string;
    roles?: string[];
  }
}
