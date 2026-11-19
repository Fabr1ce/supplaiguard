import { createServer, type Server } from "node:http";
import type { KeyPair } from "../auth/keys";
import { verifyBearer } from "../auth/middleware";
import { applyProfileUpdate } from "./profile";

export function buildServer(keys: KeyPair): Server {
  return createServer((req, res) => {
    if (!verifyBearer(keys, req.headers.authorization)) {
      res.writeHead(401).end();
      return;
    }
    if (req.method === "POST" && req.url === "/profile") {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        try {
          res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(applyProfileUpdate(JSON.parse(raw))));
        } catch {
          res.writeHead(400).end();
        }
      });
      return;
    }
    res.writeHead(404).end();
  });
}
