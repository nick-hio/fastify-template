import { Glob } from "bun";

const files: Record<string, string> = {};

console.log("Adding source files...");
const srcGlob = new Glob("src/**/*.ts");
for await (const filePath of srcGlob.scan(".")) {
    const archivePath = filePath.replaceAll(__dirname, "").replaceAll("\\", "/");
    files[archivePath] = await Bun.file(filePath).text();
}

console.log("Adding test files...");
const testGlob = new Glob("test/**/*.ts");
for await (const filePath of testGlob.scan(".")) {
    const archivePath = filePath.replaceAll(__dirname, "").replaceAll("\\", "/");
    files[archivePath] = await Bun.file(filePath).text();
}

console.log("Adding individual files...");
const individualFiles = [
    ".dockerignore",
    "bun.lock",
    "bunfig.toml",
    "Dockerfile",
    "drizzle.config.ts",
    "package.json",
    "tsconfig.json"
];

for (const file of individualFiles) {
    files[file] = await Bun.file(file).text();
}
console.log("Writing zip file...");
const archive = new Bun.Archive(files, { compress: "gzip" });
await Bun.write("bundle.tar.gz", archive);

console.log("Done!");