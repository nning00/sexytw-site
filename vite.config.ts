import vinext from "vinext";
import { defineConfig } from "vite";

const workerConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
};

export default defineConfig(async () => {
  const { cloudflare } = await import("@cloudflare/vite-plugin");
  return {
    plugins: [
      vinext(),
      cloudflare({
        ...(process.env.SEXYTW_CI_FIXTURE_BUILD === "1" ? { configPath: "./wrangler.ci.jsonc" } : {}),
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        config: workerConfig,
      }),
    ],
  };
});
