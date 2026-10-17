import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    /** Set when the OAuth access token could not be refreshed. */
    error?: string;
    user?: DefaultSession["user"];
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    access_token?: string;
    refresh_token?: string;
    /** Unix seconds when access_token expires. */
    expires_at?: number;
    error?: string;
  }
}
