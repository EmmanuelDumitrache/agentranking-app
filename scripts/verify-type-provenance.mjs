import { readFile, readdir, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

const root = process.cwd();
const sourceRoots = ["src", "services", "packages"];
const sourceExtensions = new Set([".ts", ".tsx"]);
const violations = [];

function normalize(path) {
  return relative(root, path).split(sep).join("/");
}

function extension(path) {
  const dot = path.lastIndexOf(".");
  return dot < 0 ? "" : path.slice(dot);
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function walk(path, visitor) {
  if (!(await exists(path))) return;
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    if (
      entry.name === "node_modules" ||
      entry.name === ".next" ||
      entry.name === ".git" ||
      entry.name === "dist" ||
      entry.name === "generated"
    ) {
      continue;
    }
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) {
      await walk(child, visitor);
    } else if (entry.isFile()) {
      await visitor(child);
    }
  }
}

for (const sourceRoot of sourceRoots) {
  await walk(resolve(root, sourceRoot), async (file) => {
    if (!sourceExtensions.has(extension(file))) return;
    if (file.includes("__tests__")) return;
    const text = await readFile(file, "utf8");
    const normalizedPath = normalize(file);

    // 1. Check for generic readBoundedJsonBody<Type>(...)
    if (/readBoundedJsonBody\s*<(?!\s*unknown\s*>)[^>]+>/.test(text)) {
      violations.push(
        `${normalizedPath}: contains generic readBoundedJsonBody<T>(); use parseBoundedJsonBody(source, schema) or readBoundedJsonBody(source) returning unknown`,
      );
    }

    // 2. Check for generic readOptionalBoundedJsonBody<Type>(...)
    if (/readOptionalBoundedJsonBody\s*<(?!\s*unknown\s*>)[^>]+>/.test(text)) {
      violations.push(
        `${normalizedPath}: contains generic readOptionalBoundedJsonBody<T>(); use parseOptionalBoundedJsonBody(source, schema) or readOptionalBoundedJsonBody(source)`,
      );
    }
  });
}

if (violations.length > 0) {
  console.error("Type provenance and anti-laundering verification failed:\n");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log("Type provenance and anti-laundering checks verified successfully.");
