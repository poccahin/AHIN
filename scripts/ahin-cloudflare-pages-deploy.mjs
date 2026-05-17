import { spawnSync } from "node:child_process";

const mode = process.argv[2] === "production" ? "production" : "preview";
const projectName = process.env.CLOUDFLARE_PAGES_PROJECT_NAME || "ahin-io";
const confirmation = process.env.AHIN_CLOUDFLARE_DEPLOY_CONFIRM;
const expectedConfirmation = mode === "production" ? "DEPLOY_AHIN_IO_ROOT" : "DEPLOY_AHIN_PREVIEW";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: false, ...options });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (confirmation !== expectedConfirmation) {
  console.error(`Refusing to deploy. Set AHIN_CLOUDFLARE_DEPLOY_CONFIRM=${expectedConfirmation} to continue.`);
  process.exit(1);
}

if ((process.env.NEXT_PUBLIC_AHIN_GATE_MODE || "mock") !== "mock") {
  console.error("Refusing to deploy: NEXT_PUBLIC_AHIN_GATE_MODE must remain mock for this release.");
  process.exit(1);
}

if ((process.env.NEXT_PUBLIC_AHIN_DEBUG_MATRIX || "false") !== "false") {
  console.error("Refusing to deploy: NEXT_PUBLIC_AHIN_DEBUG_MATRIX must be false.");
  process.exit(1);
}

if ((process.env.AHIN_PROTOCOL_EXECUTION_ENABLED || "false") === "true") {
  console.error("Refusing to deploy: AHIN_PROTOCOL_EXECUTION_ENABLED must remain false.");
  process.exit(1);
}

run("npm", ["run", "build"]);
run("npm", ["run", "preflight:cloudflare"]);

const branch = mode === "production" ? "main" : "preview";
run("npx", ["wrangler", "pages", "deploy", "out", "--project-name", projectName, "--branch", branch]);
