import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "assets", "alicesim-app-icon-v2.svg");
const pwa = path.join(root, "assets", "pwa", "v2");
const native = path.join(root, "src-tauri", "icons-v2");
const cli = path.join(root, "node_modules", "@tauri-apps", "cli", "tauri.js");
const temporary = await mkdtemp(path.join(tmpdir(), "alicesim-icons-"));
const run = (...args) => execFileSync(process.execPath, [cli, "icon", ...args], { cwd: root, stdio: "inherit" });

try {
  const svg = await readFile(source, "utf8");
  const surface = /<g id="surface">[\s\S]*?<\/g>/;
  const symbol = /<g id="symbol">[\s\S]*?<\/g>/;
  if (!surface.test(svg) || !symbol.test(svg)) throw new Error("Icon source must contain surface and symbol groups");
  const background = '<rect width="512" height="512" fill="url(#tile)"/>';
  const opaqueSource = path.join(temporary, "opaque.svg");
  const foregroundSource = path.join(temporary, "foreground.svg");
  const backgroundSource = path.join(temporary, "background.svg");
  await writeFile(opaqueSource, svg.replace(surface, background));
  await writeFile(foregroundSource, svg.replace(surface, ""));
  await writeFile(backgroundSource, svg.replace(surface, background).replace(symbol, ""));
  await mkdir(pwa, { recursive: true });
  run(source, "--output", pwa, ...[16, 32, 192, 512, 1024].flatMap(size => ["--png", String(size)]));

  const opaqueOutput = path.join(temporary, "opaque");
  run(opaqueSource, "--output", opaqueOutput, "--png", "180", "--png", "512");
  await cp(path.join(opaqueOutput, "180x180.png"), path.join(pwa, "apple-touch-icon.png"));
  await cp(path.join(opaqueOutput, "512x512.png"), path.join(pwa, "maskable-512x512.png"));

  const manifest = path.join(temporary, "icon.json");
  await writeFile(manifest, JSON.stringify({
    default: source,
    bg_color: "#2E56D4",
    android_bg: backgroundSource,
    android_fg: foregroundSource,
    android_fg_scale: 100
  }));
  run(manifest, "--output", native);

  // Apple applies its own corner mask; use the full-bleed source for its exports.
  const appleOutput = path.join(temporary, "apple");
  run(opaqueSource, "--output", appleOutput);
  await cp(path.join(appleOutput, "ios"), path.join(native, "ios"), { recursive: true });

  // Mobile project generation reads these standard resource directories.
  for (const platform of ["android", "ios"]) {
    await cp(path.join(native, platform), path.join(root, "src-tauri", "icons", platform), { recursive: true });
  }
  console.log("AliceSIM icons exported for web, Windows, macOS, Android and iOS.");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
