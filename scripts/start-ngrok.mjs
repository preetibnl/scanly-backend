import "dotenv/config";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const port = String(process.env.PORT || 5000);
const ngrokBin =
  process.platform === "win32"
    ? path.join(root, "node_modules", ".bin", "ngrok.cmd")
    : path.join(root, "node_modules", ".bin", "ngrok");

console.log(`[ngrok] Tunneling public HTTPS → http://127.0.0.1:${port} (set PORT in .env if needed)`);
console.log("[ngrok] First time: run `npx ngrok config add-authtoken <YOUR_TOKEN>` from https://dashboard.ngrok.com/get-started/your-authtoken\n");

const child = spawn(ngrokBin, ["http", port], {
  stdio: "inherit",
  cwd: root,
  shell: process.platform === "win32",
});

child.on("exit", (code) => process.exit(code ?? 0));
