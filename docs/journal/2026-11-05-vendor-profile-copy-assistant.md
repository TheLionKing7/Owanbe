# Vendor profile copy assistant (owner-requested, outside Sage 7 order)

The owner asked directly for this. Sage 7's next task is F-60, so this feature has no Sage 7 feature ID yet. It should be mapped to a feature ID before audit.

- Vendor House → Profile & Showcase: vendors pick one of 11 categories (event centers, service apartments, catering, MC, fashion, photo/video, live bands, decor, event managers, chauffeur, protocol/security), toggle preset services or add their own, fill in optional details, choose a tone and write freely.
- A server function checks the Auth0 token, then drafts structured copy (headline, tagline, about, services, highlights) through Lovable AI Gateway using the Vercel AI SDK (approved stack). The prompt forbids invented prices, capacities or credentials.
- The output can be edited and copied. Nothing is saved yet, because there is no approved profile data model.
- Open: vendor text goes to an AI model. AGENTS.md requires approval of zero data retention before sensitive data is sent; profile marketing text is not sensitive, but this needs the owner's confirmation.

Verification: 7 unit tests pass, plus one live gateway call that returned a complete draft.
