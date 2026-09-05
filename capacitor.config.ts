import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.ianhandy.get2gethr",
  appName: "find·a·day",
  webDir: "capacitor-shell",
  loggingBehavior: "debug",
  backgroundColor: "#f8f5ef",
  appendUserAgent: " findaday-app/1",
  server: {
    url: process.env.CAPACITOR_SERVER_URL ?? "https://finda.day",
    cleartext: false,
    allowNavigation: ["finda.day", "*.finda.day"],
    errorPath: "offline.html",
  },
  ios: {
    preferredContentMode: "mobile",
    allowsLinkPreview: false,
  },
};

export default config;
