import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.cwd(), "website", "site");
const port = Number(process.env.THEIA_WEBSITE_PORT ?? 4173);

const mimeByExt = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};

function resolvePath(urlPath) {
  const cleanPath = decodeURIComponent(urlPath.split("?")[0] || "/");
  const base = cleanPath === "/" ? "/index.html" : cleanPath;
  const absolute = path.resolve(root, `.${base}`);
  if (!absolute.startsWith(root)) {
    return null;
  }
  return absolute;
}

const server = createServer(async (request, response) => {
  const absolute = resolvePath(request.url || "/");
  if (!absolute) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  try {
    const details = await stat(absolute);
    const targetFile = details.isDirectory() ? path.join(absolute, "index.html") : absolute;
    const contents = await readFile(targetFile);
    const ext = path.extname(targetFile).toLowerCase();
    response.writeHead(200, {
      "Content-Type": mimeByExt[ext] ?? "application/octet-stream",
      "Cache-Control": "no-store"
    });
    response.end(contents);
  } catch {
    try {
      const notFound = await readFile(path.join(root, "404.html"));
      response.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      response.end(notFound);
    } catch {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
    }
  }
});

server.listen(port, () => {
  console.log(`Theia website serving on http://localhost:${port}`);
  console.log(`Site root: ${root}`);
});
