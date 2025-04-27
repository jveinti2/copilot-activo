import websocket from "@fastify/websocket";
import dotenv from "dotenv";
import Fastify, { FastifyInstance } from "fastify";
import { pino } from "pino";
import { PrettyOptions } from "pino-pretty";
import { addAudiohookSampleRoute } from "./services/audiohook.service";
import { addWebSocketRoute } from "./services/websocket.service";
import serviceLifecylePlugin from "./utils/service-lifecycle.util";
import path from "path";
import fs from "fs";

dotenv.config();

const isDev = process.env["NODE_ENV"] !== "production";

const loggerPrettyTransport: pino.TransportSingleOptions<PrettyOptions> = {
  target: "pino-pretty",
  options: {
    colorize: true,
    ignore: "pid,hostname,reqId,session",
    translateTime: "SYS:HH:MM:ss.l",
    messageFormat: "{msg}",
  },
};

const server = Fastify({
  logger: {
    transport: loggerPrettyTransport,
    level: process.env["LOG_LEVEL"] || "error",
  },
  disableRequestLogging: true,
});

server.register(websocket, {
  options: {
    maxPayload: 65536,
  },
});

// Servir archivos estáticos
server.get("/", async (request, reply) => {
  try {
    const filePath = path.join(process.cwd(), "public", "index.html");
    const content = await fs.promises.readFile(filePath, "utf-8");
    reply.type("text/html").send(content);
  } catch (error) {
    console.error("Error al servir index.html:", error);
    reply.status(500).send("Error al cargar la página");
  }
});

// Servir otros archivos estáticos
server.get("/*", async (request, reply) => {
  const filePath = path.join(process.cwd(), "public", request.url);
  try {
    if (
      await fs.promises
        .access(filePath)
        .then(() => true)
        .catch(() => false)
    ) {
      const content = await fs.promises.readFile(filePath);
      const ext = path.extname(filePath).substring(1);
      reply
        .type(ext === "js" ? "application/javascript" : "text/css")
        .send(content);
    } else {
      reply.status(404).send("Archivo no encontrado");
    }
  } catch (error) {
    console.error("Error al servir archivo estático:", error);
    reply.status(500).send("Error al servir archivo");
  }
});

server.register(async (fastify: FastifyInstance) => {
  addAudiohookSampleRoute(fastify, "/api/v1/audiohook/ws");
  addWebSocketRoute(fastify, "/ws");
});

server.register(serviceLifecylePlugin);

server
  .listen({
    port: parseInt(process.env?.["SERVERPORT"] ?? "8001"),
    host: process.env?.["SERVERHOST"] ?? "0.0.0.0",
  })
  .then(() => {
    console.log(
      `✅ Servidor iniciado en puerto ${process.env?.["SERVERPORT"] ?? "8001"}`
    );
    console.log(`📡 Ruta WebSocket: /api/v1/audiohook/ws`);
    console.log(
      `🌐 Interfaz web: http://localhost:${
        process.env?.["SERVERPORT"] ?? "8001"
      }`
    );
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
