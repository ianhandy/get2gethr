/**
 * Apple App Site Association.
 *
 * Universal links require this file at `/.well-known/apple-app-site-association`,
 * served over HTTPS as `application/json`, with no redirect. Serving it from a
 * route rather than a static file lets the team and bundle identifiers come
 * from configuration, so a different signing team does not need a code change.
 *
 * Paths are deliberately narrow: only invitation and event links open the app.
 * Everything else — the marketing page, policy pages, and the whole OAuth
 * callback path — must stay in the browser, because intercepting an
 * authorization redirect would break the connection flow.
 */
export const dynamic = "force-static";

const TEAM_ID = process.env.APPLE_TEAM_ID ?? "X5BKD97T2F";
const BUNDLE_ID = process.env.APPLE_BUNDLE_ID ?? "com.ianhandy.get2gethr";

export async function GET() {
  const appId = `${TEAM_ID}.${BUNDLE_ID}`;

  const association = {
    applinks: {
      details: [
        {
          appIDs: [appId],
          components: [
            // The OAuth callback must never be captured by the app.
            { "/": "/api/*", exclude: true, comment: "API stays on the web" },
            { "/": "/invite/*", comment: "Invitation and slot confirmation" },
            { "/": "/events/*", comment: "Organizer view" },
          ],
        },
      ],
    },
    // Declared so a future password-autofill or handoff feature works without
    // another association change.
    webcredentials: { apps: [appId] },
  };

  return new Response(JSON.stringify(association, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      // Apple's CDN caches this; keep it short enough to fix a mistake.
      "Cache-Control": "public, max-age=3600",
    },
  });
}
