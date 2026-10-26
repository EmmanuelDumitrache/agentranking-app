import { defineConfig, type TsdownPlugin } from "tsdown";
const stripServerOnlyMarker: TsdownPlugin = {
  name: "strip-server-only-marker",
  transform(code, id) {
    if (id.includes("/node_modules/") || !code.includes("server-only")) {
      return null;
    }
    const transformed = code.replace(
      /^[\t ]*import[\t ]+["']server-only["'];?[\t ]*$/gm,
      "",
    );
    return transformed === code
      ? null
      : {
          code: transformed,
          map: null,
        };
  },
};
export default defineConfig({
  entry: ["src/worker/main.ts"],
  outDir: "dist/worker",
  format: ["esm"],
  platform: "node",
  target: "node24",
  sourcemap: true,
  clean: true,
  outExtensions: () => ({ js: ".mjs" }),
  plugins: [stripServerOnlyMarker],
  deps: {
    neverBundle: true,
  },
});
