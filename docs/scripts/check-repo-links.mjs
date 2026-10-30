// VitePress fails the build on dead links between docs pages, but links to
// files elsewhere in this repo go through github.com and aren't checked.
// This resolves every https://github.com/ralphv/portunus/(blob|edit|tree)/main/…
// link against the checkout, including #anchors on Markdown headings, so a
// renamed SECURITY.md section or moved file fails CI instead of 404ing.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const docsDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = join(docsDir, "..");
const linkRe =
  /https:\/\/github\.com\/ralphv\/portunus\/(?:blob|edit|tree)\/main\/([^\s)"'#`>]+)(?:#([\w-]+))?/g;

function markdownFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === "cache" || name === "dist") return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return markdownFiles(path);
    return /\.(md|mjs)$/.test(name) ? [path] : [];
  });
}

// GitHub's heading slugs: lowercase, drop punctuation, spaces to hyphens.
function slugs(file) {
  const out = new Set();
  let inFence = false;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (line.startsWith("```")) inFence = !inFence;
    const m = !inFence && line.match(/^#{1,6}\s+(.*)$/);
    if (m) {
      out.add(
        m[1]
          .trim()
          .toLowerCase()
          .replace(/[^\p{L}\p{N}\s_-]/gu, "")
          .replace(/\s/g, "-"),
      );
    }
  }
  return out;
}

const errors = [];
let checked = 0;
for (const file of markdownFiles(docsDir)) {
  for (const [, target, anchor] of readFileSync(file, "utf8").matchAll(linkRe)) {
    // :path is VitePress's editLink placeholder, filled per page.
    if (target.includes(":path")) continue;
    checked++;
    const where = relative(repoDir, file);
    const path = join(repoDir, target);
    if (!existsSync(path)) {
      errors.push(`${where}: ${target} does not exist`);
    } else if (anchor && !slugs(path).has(anchor)) {
      errors.push(`${where}: ${target}#${anchor} has no matching heading`);
    }
  }
}

// VitePress checks that ./page links resolve, not their #anchors; check those
// against the ids in the built HTML.
const distDir = join(docsDir, ".vitepress", "dist");
for (const file of markdownFiles(docsDir).filter((f) => f.endsWith(".md"))) {
  for (const [, page, anchor] of readFileSync(file, "utf8").matchAll(
    /\]\(\.\/([\w-]+)#([\w-]+)\)/g,
  )) {
    checked++;
    const html = join(distDir, `${page}.html`);
    if (!existsSync(html) || !readFileSync(html, "utf8").includes(`id="${anchor}"`)) {
      errors.push(`${relative(repoDir, file)}: ./${page}#${anchor} has no matching heading`);
    }
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`check-repo-links: ${checked} links OK`);
