# F-76 / F-79 — Runtime public sign-in settings repair

Owner requested implementation of the previously described configuration bridge after saving secrets. This is a repair to existing sign-in/deployment, not work on the next feature.

- Read runtime settings inside a TanStack server-function handler, returning only an explicit public Auth0/database allowlist.
- Prefer external database settings over managed values; never read or return service-role/payment secrets through this bridge.
- Reject recognizable private database credentials accidentally entered in a public-key setting.
- Await configuration before session restoration or callback exchange; preserve single-use callback handling and retry failed configuration requests.
- Preserve Auth0 authority, existing admission gates, homepage and AGENTS.md unchanged.
- Local public `VITE_*` settings remain a fallback. Publish is required to update the live site.

Verification: 12 focused tests pass; preview builds report OK. Saved config RPCs return HTTP 200 and the browser reaches Auth0, which rejects the localhost callback URL. Complete real sign-in/admission remains unverified. The full suite has 81 passing and 6 failing tests in existing quote/hold UI suites unrelated to this repair; these were left unchanged.

Removed the global managed Supabase session attacher because it tried to initialize an unrelated client with missing build-time settings before public RPCs could execute. Existing Auth0 third-party database authentication and admission gates remain unchanged; both current server functions are public configuration reads.