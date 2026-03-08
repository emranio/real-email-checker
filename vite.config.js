import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { minify as minifyHtml } from "html-minifier-terser";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

function inlineCssIntoHtml() {
  return {
    name: "inline-css-into-html",
    enforce: "post",
    apply: "build",
    generateBundle(_, bundle) {
      const cssByPath = new Map();

      for (const [fileName, output] of Object.entries(bundle)) {
        if (output.type === "asset" && fileName.endsWith(".css")) {
          cssByPath.set(fileName, String(output.source));
        }
      }

      for (const output of Object.values(bundle)) {
        if (output.type !== "asset" || !output.fileName.endsWith(".html")) {
          continue;
        }

        let html = String(output.source);
        const inlinedCssFiles = new Set();

        html = html.replace(
          /<link\b[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+\.css)["'][^>]*>/gi,
          (fullMatch, href) => {
            const normalizedPath = String(href).replace(/^\//, "");
            const css = cssByPath.get(normalizedPath);

            if (!css) {
              return fullMatch;
            }

            inlinedCssFiles.add(normalizedPath);
            return `<style>${css}</style>`;
          },
        );

        output.source = html;

        for (const cssFile of inlinedCssFiles) {
          delete bundle[cssFile];
        }
      }
    },
  };
}

async function getHtmlFiles(dirPath) {
  const entries = await readdir(dirPath);
  const htmlFiles = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry);
    const entryStat = await stat(fullPath);

    if (entryStat.isDirectory()) {
      const nestedFiles = await getHtmlFiles(fullPath);
      htmlFiles.push(...nestedFiles);
      continue;
    }

    if (entryStat.isFile() && fullPath.endsWith(".html")) {
      htmlFiles.push(fullPath);
    }
  }

  return htmlFiles;
}

function minifyBuiltHtml() {
  return {
    name: "minify-built-html",
    apply: "build",
    async closeBundle() {
      const distPath = path.resolve(process.cwd(), "dist");
      const htmlFiles = await getHtmlFiles(distPath);

      await Promise.all(
        htmlFiles.map(async (filePath) => {
          const html = await readFile(filePath, "utf8");
          const minified = await minifyHtml(html, {
            collapseWhitespace: true,
            removeComments: true,
            removeRedundantAttributes: true,
            removeScriptTypeAttributes: true,
            removeStyleLinkTypeAttributes: true,
            useShortDoctype: true,
            minifyCSS: true,
            minifyJS: true,
          });

          await writeFile(filePath, minified, "utf8");
        }),
      );
    },
  };
}

export default defineConfig({
  root: path.resolve(process.cwd(), "src/frontend"),
  plugins: [react(), inlineCssIntoHtml(), minifyBuiltHtml()],
  base: "/",
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8081",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: path.resolve(process.cwd(), "dist"),
    emptyOutDir: true,
  },
});
