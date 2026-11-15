declare namespace Cloudflare {
  interface Env {
    /** Optional secret. When set, people after the first account can sign up with this invite code. */
    SIGNUP_CODE?: string
  }
}
