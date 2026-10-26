import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/worker/**"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
          varsIgnorePattern: "^_",
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/worker", "@/worker/**", "../worker", "../worker/**", "../../worker/**", "../../../worker/**"],
              message: "Application code must use the src/jobs queue boundary instead of worker-only modules.",
            },
          ],
        },
      ],
    },
  },
  // PM2 configuration and the DefiLlama adapter are CommonJS runtime contracts.
  {
    files: [
      "**/*.cjs",
      "handoff/defillama-agentranking/projects/agentranking/index.js",
    ],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "dist/**",
    "out/**",
    "build/**",
    "handoff/**",
    "next-env.d.ts",
    // Node-only worker and standalone package sources are validated separately.
    "src/worker/**",
    "packages/**",
    "scripts/**/*.js",
  ]),
]);
export default eslintConfig;
