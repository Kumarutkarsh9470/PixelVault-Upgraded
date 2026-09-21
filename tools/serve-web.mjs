// Serves the Vercel deploy folder locally: static files with the headers a
// Brotli Unity build needs, plus /api/* functions run the way Vercel runs them.
// Usage: node tools/serve-web.mjs [rootDir] [port]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] || "deploy/racer");
const port = Number(process.argv[3] || 8080);

// Local development only: load the devnet sponsor key from the gitignored
// secrets folder. On Vercel it comes from the project's environment variables.
const devKey = path.resolve("secrets/sponsor-devnet.json");
if (!process.env.SPONSOR_SECRET_KEY && fs.existsSync(devKey)) {
  process.env.SPONSOR_SECRET_KEY = fs.readFileSync(devKey, "utf8").trim();
}

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".wasm": "application/wasm",
  ".data": "application/octet-stream",
  ".json": "application/json",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

async function runFunction(name, req, res) {
  const file = path.join(root, "api", `${name}.js`);
  if (!fs.existsSync(file)) {
    res.writeHead(404).end("no such function");
    return;
  }

  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
  }
  req.body = raw && (req.headers["content-type"] || "").includes("json") ? JSON.parse(raw) : raw;

  // The subset of Vercel's response helpers our functions use.
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (value) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(value));
    return res;
  };

  const mod = await import(pathToFileURL(file).href);
  await mod.default(req, res);
}

function serveStatic(urlPath, res) {
  let file = path.join(root, urlPath);
  if (file !== root && !file.startsWith(root + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    file = path.join(file, "index.html");
  }

  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404).end("not found");
      return;
    }

    // Unity names compressed files like framework.js.br: the encoding comes
    // from the last extension, the content type from the one before it.
    const headers = { "Cache-Control": "no-cache", "Content-Length": stat.size };
    let ext = path.extname(file);
    if (ext === ".br" || ext === ".gz") {
      headers["Content-Encoding"] = ext === ".br" ? "br" : "gzip";
      ext = path.extname(file.slice(0, -ext.length));
    }
    headers["Content-Type"] = types[ext] || "application/octet-stream";

    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  });
}

http
  .createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    console.log(`${req.method} ${urlPath}`);
    const fn = urlPath.match(/^\/api\/([\w-]+)\/?$/);
    if (fn) {
      runFunction(fn[1], req, res).catch((e) => {
        console.error(e);
        if (!res.headersSent) res.writeHead(500);
        res.end(String(e));
      });
      return;
    }
    serveStatic(urlPath, res);
  })
  .listen(port, () => console.log(`serving ${root} on http://localhost:${port}`));
