import axios from "axios";
import dotenv from "dotenv";
import { FastifyInstance } from "fastify";
import FormData from "form-data";
import fs from "fs";
import {
  createServerSession,
  httpsignature as httpsig,
  isUuid,
} from "../audiohook";
import { SessionWebsocketStatsTracker } from "./session-websocket-stats-tracker";
const g711 = require("g711");

dotenv.config();

const isDev = process.env["NODE_ENV"] !== "production";

declare module "fastify" {
  interface FastifyRequest {
    authenticated?: boolean;
  }
}

export const addAudiohookSampleRoute = (
  fastify: FastifyInstance,
  path: string
): void => {
  const fileLogRoot = process.env["LOG_ROOT_DIR"] ?? process.cwd();

  fastify.log.info(`LocalLogRootDir: ${fileLogRoot}`);

  // Crear directorio temporal para archivos de audio
  const tempDir = `${fileLogRoot}/temp`;
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  // Crear directorios de logs para guardar archivos para análisis
  const logsDir = `${fileLogRoot}/logs`;
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  const audioLogsDir = `${logsDir}/audio`;
  if (!fs.existsSync(audioLogsDir)) {
    fs.mkdirSync(audioLogsDir, { recursive: true });
  }

  // Endpoint simple para pruebas
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

      // Inicializar detector de actividad de voz utilizando node-vad
      // @ts-ignore - Para evitar errores de tipado con node-vad
      const VAD = require("node-vad");
      const vad = new VAD(VAD.Mode.VERY_AGGRESSIVE);

      // Buffer para acumular audio
      let rawAudioBuffer: Uint8Array[] = []; // Audio en formato PCMU (original)
      let pcmAudioBuffer: Buffer[] = []; // Audio convertido a PCM16 para VAD
      let isProcessingAudio = false;
      let captureStarted = false;
      let transcripcionesRealizadas = 0;

      // Variables para control de VAD
      let vadSpeechDetected = false; // Si se ha detectado voz
      let vadSilenceStartTime = 0; // Momento cuando inició el silencio después de voz
      const VAD_SILENCE_THRESHOLD_MS = 800; // Tiempo de silencio para procesar (ms)

      // Create a proxy for the WebSocket that tracks statistics
      const ws = new SessionWebsocketStatsTracker(connection.socket);

      // Función para convertir μ-law a PCM para VAD
      const convertMuLawToPCM = (muLawData: Uint8Array): Buffer => {
        // Usar la función correcta de g711 para convertir μ-law a PCM
        const pcmInt16 = g711.ulawToPCM(muLawData, 16);
        // Convertir a Buffer para manipulación posterior
        return Buffer.from(pcmInt16.buffer);
      };

      // Función para procesar el audio acumulado
      const procesarAudioAcumulado = async () => {
        if (isProcessingAudio || rawAudioBuffer.length === 0) {
          return;
        }

        isProcessingAudio = true;

        try {
          console.log(
            `📊 Procesando ${rawAudioBuffer.length} chunks de audio acumulado`
          );

          // Concatenar buffers de PCM para crear el archivo WAV
          const pcmData = Buffer.concat(pcmAudioBuffer);

          // Crear un archivo WAV para guardar y enviar a Whisper
          const audioFileName = `${sessionId}-${Date.now()}.wav`;
          const audioFilePath = `${tempDir}/${audioFileName}`;

          try {
            // Crear un encabezado WAV correcto para audio PCM16
            const sampleRate = 8000; // Frecuencia original de PCMU

            // Usar DataView para manipular el buffer como lo hace el ejemplo
            const audioView = new DataView(
              pcmData.buffer,
              pcmData.byteOffset,
              pcmData.byteLength
            );
            const wavBuffer = g711.encodeWAV(
              audioView,
              sampleRate,
              1,
              16,
              true
            );

            // Escribir archivo WAV
            fs.writeFileSync(audioFilePath, Buffer.from(wavBuffer));

            // Guardar una copia permanente del audio para análisis
            const audioFileNameLog = `audio-${sessionId.substring(
              0,
              8
            )}-${Date.now()}.wav`;
            const audioLogPath = `${audioLogsDir}/${audioFileNameLog}`;
            fs.copyFileSync(audioFilePath, audioLogPath);
            console.log(
              `📁 Audio guardado en logs: ${audioFileNameLog} (${Math.round(
                fs.statSync(audioFilePath).size / 1024
              )}KB)`
            );

            // Transcribir con Whisper usando FormData como en el ejemplo
            const formData = new FormData();
            const fileStream = fs.createReadStream(audioFilePath);
            formData.append("file", fileStream);
            formData.append("model", "whisper-1");
            formData.append("language", "es");
            formData.append("response_format", "verbose_json");

            console.log(
              `🔍 Enviando audio a Whisper (${Math.round(
                fs.statSync(audioFilePath).size / 1024
              )}KB)`
            );

            const response = await axios.post(
              "https://api.openai.com/v1/audio/transcriptions",
              formData,
              {
                headers: {
                  Authorization: `Bearer ${process.env["OPENAI_API_KEY"]}`,
                  ...formData.getHeaders(),
                },
              }
            );

            // Mostrar resultado de la transcripción
            if (response.data.text && response.data.text.trim() !== "") {
              transcripcionesRealizadas++;
              console.log("\n" + "-".repeat(80));
              console.log(`📝 TRANSCRIPCIÓN #${transcripcionesRealizadas}:`);
              console.log("-".repeat(80));
              console.log(`${response.data.text}`);
              console.log("-".repeat(80));
            } else {
              console.log(`📝 No se detectó texto en la transcripción`);
            }

            // Limpiar archivo temporal
            try {
              fs.unlinkSync(audioFilePath);
            } catch (e) {
              // Ignorar errores al eliminar archivo
            }
          } catch (error) {
            console.error("❌ Error procesando audio:", error);
          }
        } catch (error) {
          console.error("Error procesando audio:", error);
        } finally {
          // Reiniciar buffers después de procesar
          rawAudioBuffer = [];
          pcmAudioBuffer = [];
          isProcessingAudio = false;
          vadSpeechDetected = false;
          vadSilenceStartTime = 0;
        }
      };

      // Añadir manejador para procesar el audio cuando llega
      ws.on("message", async (data, isBinary) => {
        if (isBinary) {
          // Mostrar inicio de la llamada
          if (!captureStarted) {
            captureStarted = true;
            console.log(
              "\n🎤 Iniciada nueva llamada - ID: " +
                sessionId.substring(0, 8) +
                "..."
            );
          }

          try {
            // Acumular datos originales en formato PCMU
            const audioChunk = new Uint8Array(data as Buffer);
            rawAudioBuffer.push(audioChunk);

            // Convertir a PCM para VAD
            const pcmChunk = convertMuLawToPCM(audioChunk);
            pcmAudioBuffer.push(pcmChunk);

            // Procesar con VAD para detectar actividad de voz
            // La frecuencia 16000 se usa por compatibilidad con la API de Whisper
            const vadResult = await vad.processAudio(pcmChunk, 16000);

            // Reportar tamaño de buffer cada 13KB aproximadamente
            if (rawAudioBuffer.length % 8 === 0) {
              let totalBytes = 0;
              rawAudioBuffer.forEach((chunk) => (totalBytes += chunk.length));
              console.log(
                `📊 Procesando buffer de ${Math.round(totalBytes / 1000)}KB`
              );
            }

            // Manejar diferentes eventos de VAD
            switch (vadResult) {
              case VAD.Event.VOICE:
                // Si es la primera vez que detectamos voz, reiniciar contador de silencio
                if (!vadSpeechDetected) {
                  vadSpeechDetected = true;
                  vadSilenceStartTime = 0;
                  // No mostramos mensajes para no saturar la consola
                }
                break;

              case VAD.Event.SILENCE:
                // Si se había detectado voz antes, comenzar a contar silencio
                if (vadSpeechDetected) {
                  const now = Date.now();

                  // Iniciar contador de silencio si es necesario
                  if (vadSilenceStartTime === 0) {
                    vadSilenceStartTime = now;
                  }

                  // Verificar si el silencio ha durado lo suficiente
                  const silenceDuration = now - vadSilenceStartTime;

                  // Si se alcanza el umbral, procesar el audio
                  if (silenceDuration >= VAD_SILENCE_THRESHOLD_MS) {
                    console.log(
                      `🔇 Silencio detectado (${
                        Math.round(silenceDuration / 100) / 10
                      }s) - Procesando audio...`
                    );
                    await procesarAudioAcumulado();
                  }
                }
                break;
            }
          } catch (error) {
            console.error("Error procesando chunk de audio:", error);
          }
        }
      });

      // Verificador periódico de silencio para casos donde node-vad no detecta bien
      const silencioInterval = setInterval(async () => {
        // Si se detectó voz pero no ha habido actualizaciones del VAD
        if (vadSpeechDetected && vadSilenceStartTime > 0) {
          const silenceDuration = Date.now() - vadSilenceStartTime;

          // Si el silencio es suficientemente largo
          if (
            silenceDuration >= VAD_SILENCE_THRESHOLD_MS &&
            !isProcessingAudio
          ) {
            console.log(
              `🔇 Silencio detectado (verificación periódica: ${
                Math.round(silenceDuration / 100) / 10
              }s) - Procesando audio...`
            );
            await procesarAudioAcumulado();
          }
        }
      }, 500);

      // Crear sesión simple sin grabación
      const session = createServerSession({
        ws,
        id: sessionId,
        logger,
      });

      // Cuando el servicio se apaga, registrar la sesión para manejo adecuado
      const lifecycleToken = fastify.lifecycle.registerSession(() => {
        logger.info("Service shutdown announced");
      });

      session.addFiniHandler(async () => {
        lifecycleToken.unregister();

        // Limpiar el intervalo al finalizar
        clearInterval(silencioInterval);

        // Procesar audio restante si hay voz detectada
        if (vadSpeechDetected && rawAudioBuffer.length > 0) {
          console.log(`🏁 Llamada finalizada - Procesando audio final...`);
          await procesarAudioAcumulado();
        } else {
          console.log(
            `🏁 Llamada finalizada - ID: ${sessionId.substring(0, 8)}...`
          );
        }
      });

      // Register handler for statistics tracking proxy
      session.addOpenHandler(ws.createTrackingHandler());
    }
  );
};
