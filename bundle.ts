// Packs the template into `bundle.tar.gz` so it can be handed to an agent as a single file.
import { $ } from "bun";

const OUTPUT = "bundle.tar.gz";

// Files that only matter to the template repository, not to a project created from it.
const TEMPLATE_ONLY = new Set(["bundle.ts", "LICENSE"]);

// Everything git tracks, plus new files it does not ignore, so the bundle cannot drift from the repository.
const listed = await $`git ls-files --cached --others --exclude-standard`.text();

const files: Record<string, string | Uint8Array> = {};
for (const path of listed.split("\n")) {
    const file = Bun.file(path);
    if (path && !TEMPLATE_ONLY.has(path) && (await file.exists())) {
        files[path] = await file.bytes();
    }
}

// `bundle.ts` is left out, so its script would be a dead entry in the bundled package.json.
const manifest = await Bun.file("package.json").json();
delete manifest.scripts.bundle;
files["package.json"] = `${JSON.stringify(manifest, null, 2)}\n`;

await Bun.Archive.write(OUTPUT, files, { compress: "gzip" });

console.log(`Wrote ${OUTPUT} with ${Object.keys(files).length} files`);
