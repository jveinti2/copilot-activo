import Fastify, { FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import dotenv from "dotenv";
import { pino } from "pino";
import { PrettyOptions } from "pino-pretty";
import serviceLifecylePlugin from "./service-lifecycle-plugin";
import { addAudiohookSampleRoute } from "./audiohook-sample-endpoint";

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

server.register(async (fastify: FastifyInstance) => {
  addAudiohookSampleRoute(fastify, "/api/v1/audiohook/ws");
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
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
