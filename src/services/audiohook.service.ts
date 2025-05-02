import dotenv from "dotenv";
import { FastifyInstance } from "fastify";
import fs from "fs";
import {
  createServerSession,
  httpsignature as httpsig,
  isUuid,
} from "../../audiohook";
import {
  extractQuestionFromTranscription,
  transcribeWithWhisper,
} from "./openai.service";
import { getResponseGuru } from "./rfp-guru.service";
import { broadcastMessage } from "./websocket.service";
const g711 = require("g711");

dotenv.config();

const isDev = process.env["NODE_ENV"] !== "production";

declare module "fastify" {
  interface FastifyRequest {
    authenticated?: boolean;
  }
}

// Función principal para añadir la ruta de AudioHook
export const addAudiohookSampleRoute = (
  fastify: FastifyInstance,
  path: string
): void => {
  const fileLogRoot = process.env["LOG_ROOT_DIR"] ?? process.cwd();
  fastify.log.info(`LocalLogRootDir: ${fileLogRoot}`);

  // Crear directorios para archivos y logs
  const tempDir = `${fileLogRoot}/temp`;
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const logsDir = `${fileLogRoot}/logs`;
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  const audioLogsDir = `${logsDir}/audio`;
  if (!fs.existsSync(audioLogsDir)) {
    fs.mkdirSync(audioLogsDir, { recursive: true });
  }

  // Endpoint WebSocket para AudioHook
  fastify.get<{
    Headers: {
      "audiohook-session-id"?: string;
      "audiohook-organization-id"?: string;
      "audiohook-correlation-id"?: string;
    };
  }>(
    path,
    {
      websocket: true,
    },
    (connection, request) => {
      request.log.info(
        `Websocket Request - URI: <${request.url}>, SocketRemoteAddr: ${
          request.socket.remoteAddress
        }, Headers: ${JSON.stringify(request.headers, null, 1)}`
      );

      const sessionId = httpsig.queryCanonicalizedHeaderField(
        request.headers,
        "audiohook-session-id"
      );
      if (!sessionId || !isUuid(sessionId)) {
        throw new RangeError(
          'Missing or invalid "audiohook-session-id" header field'
        );
      }
      if (isDev && connection.socket.binaryType !== "nodebuffer") {
        throw new Error(
          `WebSocket binary type '${connection.socket.binaryType}' not supported`
        );
      }

      const logLevel = isDev ? "error" : "error";
      const logger = request.log.child(
        { session: sessionId },
        { level: logLevel }
      );

      // Inicializar detector de actividad de voz
      const VAD = require("node-vad");
      const vad = new VAD(VAD.Mode.VERY_AGGRESSIVE);

      // Variables para audio y procesamiento
      let rawAudioBuffer: Uint8Array[] = [];
      let pcmAudioBuffer: Buffer[] = [];
      let isProcessingAudio = false;
      let captureStarted = false;
      let totalBytesReceived = 0;
      let lastLogTime = 0;
      const LOG_INTERVAL_MS = 3000; // Solo mostrar resumen de bytes cada 3 segundos que sirve para no saturar la consola

      // Variables para control de VAD
      let vadSpeechDetected = false; // Indica si se ha detectado voz
      let vadSilenceStartTime = 0;
      const VAD_SILENCE_THRESHOLD_MS = 1500; // esto son 1.5 segundos

      // Añadir contador de bytes para filtrar segmentos muy cortos
      let totalBytesInSegment = 0;
      const MIN_BYTES_THRESHOLD = 3200; // ~ 2 segundos de audio a 16kHz (3200 bytes)

      // Usar el socket WebSocket directamente
      const ws = connection.socket;

      // Función para convertir μ-law a PCM para VAD
      const convertMuLawToPCM = (muLawData: Uint8Array): Buffer => {
        const pcmInt16 = g711.ulawToPCM(muLawData, 16);
        return Buffer.from(pcmInt16.buffer);
      };

      // Función para procesar audio acumulado
      const procesarAudioAcumulado = async () => {
        if (isProcessingAudio || rawAudioBuffer.length === 0) {
          return;
        }

        isProcessingAudio = true;
        console.log(`🔄 Procesando audio acumulado...`);

        const pcmData = Buffer.concat(pcmAudioBuffer);

        const audioFileName = `${sessionId}-${Date.now()}.wav`;
        const audioFilePath = `${tempDir}/${audioFileName}`;

        try {
          const sampleRate = 8000;
          const audioView = new DataView(
            pcmData.buffer,
            pcmData.byteOffset,
            pcmData.byteLength
          );
          const wavBuffer = g711.encodeWAV(audioView, sampleRate, 1, 16, true);

          // Escribir archivo WAV
          fs.writeFileSync(audioFilePath, Buffer.from(wavBuffer));

          // Guardar copia para análisis
          const audioFileNameLog = `audio-${sessionId.substring(
            0,
            8
          )}-${Date.now()}.wav`;
          const audioLogPath = `${audioLogsDir}/${audioFileNameLog}`;
          fs.copyFileSync(audioFilePath, audioLogPath);
          console.log(
            `📁 Audio guardado: ${audioFileNameLog} (${Math.round(
              fs.statSync(audioFilePath).size / 1024
            )}KB)`
          );

          const trasncript = await transcribeWithWhisper(audioFilePath);
          const completion = await extractQuestionFromTranscription(trasncript);

          if (completion !== "NO PREGUNTA") {
            broadcastMessage({
              type: "transcript",
              question: completion,
              trasncript: trasncript,
              timestamp: new Date().toISOString(),
            });

            const text_to_guru = completion;
            const response_guru: string | any = await getResponseGuru(
              text_to_guru
            );

            broadcastMessage({
              type: "response",
              text: response_guru,
              timestamp: new Date().toISOString(),
            });
          }
        } catch (error) {
          console.error("Error procesando audio:", error);
        } finally {
          // Reiniciar
          rawAudioBuffer = [];
          pcmAudioBuffer = [];
          isProcessingAudio = false;
          vadSpeechDetected = false;
          vadSilenceStartTime = 0;
          fs.unlinkSync(audioFilePath);
        }
      };

      // Procesar audio recibido
      ws.on("message", async (data: any, isBinary: boolean) => {
        if (isBinary) {
          const dataSize = (data as Buffer).length;
          totalBytesReceived += dataSize;

          // Mostrar logs de recepción solo cada X segundos para no saturar la consola
          const now = Date.now();
          if (now - lastLogTime > LOG_INTERVAL_MS) {
            console.log(
              `📥 Recibidos ${Math.round(
                totalBytesReceived / 1000
              )}KB en total desde el inicio`
            );
            lastLogTime = now;
          }

          if (!captureStarted) {
            captureStarted = true;
            console.log(
              "\n🎤 Iniciada nueva llamada - ID: " +
                sessionId.substring(0, 8) +
                "..."
            );
          }

          try {
            // Acumular datos originales
            const audioChunk = new Uint8Array(data as Buffer);
            rawAudioBuffer.push(audioChunk);

            // Convertir para VAD
            const pcmChunk = convertMuLawToPCM(audioChunk);
            pcmAudioBuffer.push(pcmChunk);

            // Procesar con VAD
            const vadResult = await vad.processAudio(pcmChunk, 16000);

            // Reportar tamaño de buffer
            if (rawAudioBuffer.length % 24 === 0) {
              // Reducido de 8 a 24 para mostrar menos logs
              let totalBytes = 0;
              rawAudioBuffer.forEach((chunk) => (totalBytes += chunk.length));
              console.log(
                `📊 Buffer acumulado: ${Math.round(totalBytes / 1000)}KB (${
                  rawAudioBuffer.length
                } chunks)`
              );
            }

            // Manejar eventos de VAD
            switch (vadResult) {
              case VAD.Event.VOICE:
                if (!vadSpeechDetected) {
                  vadSpeechDetected = true;
                  vadSilenceStartTime = 0;
                  totalBytesInSegment = 0; // Reiniciar contador de bytes
                }
                totalBytesInSegment += audioChunk.length; // Aumentar contador de bytes
                break;

              case VAD.Event.SILENCE:
                if (vadSpeechDetected) {
                  const now = Date.now();

                  if (vadSilenceStartTime === 0) {
                    vadSilenceStartTime = now;
                  }

                  const silenceDuration = now - vadSilenceStartTime;

                  if (silenceDuration >= VAD_SILENCE_THRESHOLD_MS) {
                    console.log(
                      `🔇 Silencio detectado (${
                        Math.round(silenceDuration / 100) / 10
                      }s) - Bytes acumulados: ${totalBytesInSegment}`
                    );

                    // Solo procesar si hay suficientes bytes acumulados
                    if (totalBytesInSegment >= MIN_BYTES_THRESHOLD) {
                      console.log(
                        `📝 Suficientes datos para transcribir (${Math.round(
                          totalBytesInSegment / 1000
                        )}KB)`
                      );
                      await procesarAudioAcumulado();
                    } else {
                      console.log(
                        `⚠️ Segmento muy corto, ignorando (${Math.round(
                          totalBytesInSegment / 1000
                        )}KB)`
                      );
                      // Limpiar buffers pero sin procesar
                      rawAudioBuffer = [];
                      pcmAudioBuffer = [];
                      vadSpeechDetected = false;
                      vadSilenceStartTime = 0;
                      totalBytesInSegment = 0;
                    }
                  }
                }
                break;
            }
          } catch (error) {
            console.error("Error procesando chunk de audio:", error);
          }
        }
      });

      // Log cuando se cierra la conexión WebSocket
      ws.on("close", () => {
        console.log(
          `🔌 Conexión WebSocket cerrada para la sesión: ${sessionId}`
        );
      });

      // Crear sesión
      const session = createServerSession({
        ws,
        id: sessionId,
        logger,
      });

      // Registrar para manejo de apagado
      const lifecycleToken = fastify.lifecycle.registerSession(() => {
        logger.info("Service shutdown announced");
      });

      session.addFiniHandler(async () => {
        lifecycleToken.unregister();

        // Limpiar intervalo
        clearInterval(silencioInterval);

        // Procesar audio restante
        if (vadSpeechDetected && rawAudioBuffer.length > 0) {
          console.log(`🏁 Llamada finalizada - Procesando audio final...`);
          await procesarAudioAcumulado();
        } else {
          console.log(
            `🏁 Llamada finalizada - ID: ${sessionId.substring(0, 8)}...`
          );
        }
      });

      // Verificador periódico de silencio
      const silencioInterval = setInterval(async () => {
        if (vadSpeechDetected && vadSilenceStartTime > 0) {
          const silenceDuration = Date.now() - vadSilenceStartTime;

          if (
            silenceDuration >= VAD_SILENCE_THRESHOLD_MS &&
            !isProcessingAudio
          ) {
            console.log(
              `🔇 Silencio detectado (verificación periódica: ${
                Math.round(silenceDuration / 100) / 10
              }s) - Bytes acumulados: ${totalBytesInSegment}`
            );

            // Solo procesar si hay suficientes bytes acumulados
            if (totalBytesInSegment >= MIN_BYTES_THRESHOLD) {
              console.log(
                `📝 Suficientes datos para transcribir (${Math.round(
                  totalBytesInSegment / 1000
                )}KB)`
              );
              await procesarAudioAcumulado();
            } else {
              console.log(
                `⚠️ Segmento muy corto, ignorando (verificación periódica) (${Math.round(
                  totalBytesInSegment / 1000
                )}KB)`
              );
              // Limpiar buffers pero sin procesar
              rawAudioBuffer = [];
              pcmAudioBuffer = [];
              vadSpeechDetected = false;
              vadSilenceStartTime = 0;
              totalBytesInSegment = 0;
            }
          }
        }
      }, 500);
    }
  );
};

// Función para calcular la energía del audio
const calculateAudioEnergy = (buffer: Buffer): number => {
  let sum = 0;
  for (let i = 0; i < buffer.length; i += 2) {
    const sample = buffer.readInt16LE(i);
    sum += sample * sample;
  }
  return Math.sqrt(sum / (buffer.length / 2));
};
