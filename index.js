import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createBareServer } from "@nebula-services/bare-server-node";
import chalk from "chalk";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import basicAuth from "express-basic-auth";
import mime from "mime";
import fetch from "node-fetch";
import { setupMasqr } from "./Masqr.js";
import config from "./config.js";

console.log(chalk.yellow("🚀 Starting server..."));

const __dirname = process.cwd();
const server = http.createServer();
const app = express();
const bareServer = createBareServer("/ca/");
const PORT = process.env.PORT || 8080;
const cache = new Map();
const CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // Cache for 30 Days

// Glitch CDNのベースURL
const GLITCH_CDN_BASE_URL = 'https://cdn.glitch.global/';

// Glitch CDNのパスに含まれる固定の識別子
const CDN_PATH_IDENTIFIER = '36d6d21a-f25a-453f-bcd8-2ec0675f246a';


/**
 * 指定されたファイル名を元に、Glitch CDNへのリダイレクトURLを構築します。
 * @param {string} filename - リダイレクトする画像ファイル名（例: 'full-main.png', '1.webp' など）
 * @returns {string} Glitch CDNの完全なURL
 */
function buildGlitchCdnUrl(filename) {
  return `${GLITCH_CDN_BASE_URL}${CDN_PATH_IDENTIFIER}/${filename}`;
}


app.get('/assets/media/:sub_dir/:filename', (req, res) => {
  const subDir = req.params.sub_dir; // 例: 'background', 'favicon', 'icons'
  const filename = req.params.filename; // 例: 'full-inverted.png', 'bim.ico', '1.webp'
  
  // ここで重要なのは、Glitch CDNのURLにはサブディレクトリの情報が不要な点です。
  // 必要になるのはファイル名だけなので、filename を使ってリダイレクトURLを構築します。
  const redirectUrl = buildGlitchCdnUrl(filename);

  console.log(`Request for /assets/media/${subDir}/${filename}`);
  console.log(`Redirecting to: ${redirectUrl}`);
  res.redirect(redirectUrl);
});








if (config.challenge !== false) {
  console.log(
    chalk.green("🔒 Password protection is enabled! Listing logins below"),
  );
  // biome-ignore lint/complexity/noForEach:
  Object.entries(config.users).forEach(([username, password]) => {
    console.log(chalk.blue(`Username: ${username}, Password: ${password}`));
  });
  app.use(basicAuth({ users: config.users, challenge: true }));
}

// index.js (既存の routes 配列の定義より前、または app.use(express.static(...)) の後で、
// routes.forEach の前に以下を追加してください。
// 重要なのは、routes.forEach で定義される一般的な /a ルートよりも「前」にくることです。)

// --- 新しい /a/:xorEncodedUrl ルートを追加 ---
app.get("/a/:xorEncodedUrl", (_req, res) => {
    // /a/ の後にパスパラメータが付いている場合でも games.html を返します。
    // i.js がこのパスパラメータを読み取って処理します
  res.sendFile(path.join(__dirname, "static", "xor-loader.html"));
});


app.get("/e/*", async (req, res, next) => {
  try {
    if (cache.has(req.path)) {
      const { data, contentType, timestamp } = cache.get(req.path);
      if (Date.now() - timestamp > CACHE_TTL) {
        cache.delete(req.path);
      } else {
        res.writeHead(200, { "Content-Type": contentType });
        return res.end(data);
      }
    }

    const baseUrls = {
      "/e/1/": "https://raw.githubusercontent.com/qrs/x/fixy/",
      "/e/2/": "https://raw.githubusercontent.com/3v1/V5-Assets/main/",
      "/e/3/": "https://raw.githubusercontent.com/3v1/V5-Retro/master/",
    };

    let reqTarget;
    for (const [prefix, baseUrl] of Object.entries(baseUrls)) {
      if (req.path.startsWith(prefix)) {
        reqTarget = baseUrl + req.path.slice(prefix.length);
        break;
      }
    }

    if (!reqTarget) {
      return next();
    }

    const asset = await fetch(reqTarget);
    if (!asset.ok) {
      return next();
    }

    const data = Buffer.from(await asset.arrayBuffer());
    const ext = path.extname(reqTarget);
    const no = [".unityweb"];
    const contentType = no.includes(ext)
      ? "application/octet-stream"
      : mime.getType(ext);

    cache.set(req.path, { data, contentType, timestamp: Date.now() });
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  } catch (error) {
    console.error("Error fetching asset:", error);
    res.setHeader("Content-Type", "text/html");
    res.status(500).send("Error fetching the asset");
  }
});

app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* if (process.env.MASQR === "true") {
  console.log(chalk.green("Masqr is enabled"));
  setupMasqr(app);
} */

app.use(express.static(path.join(__dirname, "static")));
app.use("/ca", cors({ origin: true }));

const routes = [
  { path: "/b", file: "apps.html" },
  { path: "/a", file: "games.html" },
  { path: "/play.html", file: "games.html" },
  { path: "/c", file: "settings.html" },
  { path: "/d", file: "tabs.html" },
  { path: "/", file: "index.html" },
];

// biome-ignore lint/complexity/noForEach:
routes.forEach(route => {
  app.get(route.path, (_req, res) => {
    res.sendFile(path.join(__dirname, "static", route.file));
  });
});

app.use((req, res, next) => {
  res.status(404).sendFile(path.join(__dirname, "static", "404.html"));
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).sendFile(path.join(__dirname, "static", "404.html"));
});

server.on("request", (req, res) => {
  if (bareServer.shouldRoute(req)) {
    bareServer.routeRequest(req, res);
  } else {
    app(req, res);
  }
});

server.on("upgrade", (req, socket, head) => {
  if (bareServer.shouldRoute(req)) {
    bareServer.routeUpgrade(req, socket, head);
  } else {
    socket.end();
  }
});

server.on("listening", () => {
  console.log(chalk.green(`🌍 Server is running on http://localhost:${PORT}`));
});

server.listen({ port: PORT });