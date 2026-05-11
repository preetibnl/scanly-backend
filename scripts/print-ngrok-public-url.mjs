import http from "node:http";

const get = (path) =>
  new Promise((resolve, reject) => {
    const req = http.get(
      { hostname: "127.0.0.1", port: 4040, path, timeout: 3000 },
      (res) => {
        let data = "";
        res.on("data", (c) => {
          data += c;
        });
        res.on("end", () => resolve(data));
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
  });

try {
  const raw = await get("/api/tunnels");
  const j = JSON.parse(raw);
  const httpsTunnel = j.tunnels?.find((t) => t.proto === "https");
  const t = httpsTunnel || j.tunnels?.[0];
  if (!t?.public_url) {
    console.error("No ngrok tunnel found. In another terminal run: npm run ngrok");
    process.exit(1);
  }
  const url = String(t.public_url).replace(/\/$/, "");
  console.log("\n=== Paste into .env files (no trailing slash) ===\n");
  console.log(`# scanly-backend/.env`);
  console.log(`PUBLIC_API_BASE_URL=${url}`);
  console.log(`\n# scanly/.env (use same URL so the phone hits the tunneled API + Stripe return host)`);
  console.log(`EXPO_PUBLIC_API_BASE_URL=${url}`);
  console.log(`\n# Stripe Dashboard → Developers → Webhooks → Add endpoint`);
  console.log(`${url}/api/stripe/webhook`);
  console.log("\nRestart the backend and Expo after saving.\n");
} catch {
  console.error(
    "Could not read ngrok (http://127.0.0.1:4040). Start the tunnel first: npm run ngrok",
  );
  process.exit(1);
}
