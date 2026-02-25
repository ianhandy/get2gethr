import { google } from "googleapis";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.freebusy",
  "openid",
  "email",
  "profile",
];

export function createOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.NEXT_PUBLIC_BASE_URL}/api/auth/google/callback`
  );
}

export function getAuthorizationUrl(stateToken: string): string {
  const oauth2Client = createOAuthClient();
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    state: stateToken,
    prompt: "consent", // Always get refresh token
  });
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
}

export async function exchangeCodeForTokens(code: string): Promise<TokenSet> {
  const oauth2Client = createOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error("Failed to get tokens from Google");
  }
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
  };
}

export async function getUserEmail(accessToken: string): Promise<string> {
  const oauth2Client = createOAuthClient();
  oauth2Client.setCredentials({ access_token: accessToken });
  const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
  const { data } = await oauth2.userinfo.get();
  if (!data.email) throw new Error("Could not get user email from Google");
  return data.email;
}

/** Returns busy intervals as [startMs, endMs] pairs */
export async function getFreeBusy(
  accessToken: string,
  refreshToken: string,
  startDate: Date,
  endDate: Date
): Promise<[number, number][]> {
  const oauth2Client = createOAuthClient();
  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
  });

  const calendar = google.calendar({ version: "v3", auth: oauth2Client });
  const response = await calendar.freebusy.query({
    requestBody: {
      timeMin: startDate.toISOString(),
      timeMax: endDate.toISOString(),
      items: [{ id: "primary" }],
    },
  });

  const busy = response.data.calendars?.["primary"]?.busy ?? [];
  return busy
    .filter((b) => b.start && b.end)
    .map((b) => [
      new Date(b.start!).getTime(),
      new Date(b.end!).getTime(),
    ]);
}
