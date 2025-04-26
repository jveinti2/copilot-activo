import axios from "axios";
import dotenv from "dotenv";
import { FastifyInstance } from "fastify";
import FormData from "form-data";
import fs from "fs";
import {
  createServerSession,
  httpsignature as httpsig,
  isUuid,
} from "../../audiohook";
import { getResponseGuru } from "./rfp-guru.service";
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
      let transcripcionesRealizadas = 0;

      // Variables para control de VAD
      let vadSpeechDetected = false;
      let vadSilenceStartTime = 0;
      const VAD_SILENCE_THRESHOLD_MS = 800;

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

        try {
          console.log(
            `📊 Procesando ${rawAudioBuffer.length} chunks de audio acumulado`
          );

          // Concatenar buffers de PCM
          const pcmData = Buffer.concat(pcmAudioBuffer);

          // Crear archivo WAV para Whisper
          const audioFileName = `${sessionId}-${Date.now()}.wav`;
          const audioFilePath = `${tempDir}/${audioFileName}`;

          try {
            const sampleRate = 8000;
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

            // Transcribir con Whisper
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

            if (response.data.text && response.data.text.trim() !== "") {
              console.log("\n" + "-".repeat(80));
              console.log(`📝 Nueva trasncript: ${response.data.text}`);
            }

            const text_to_guru = response.data.text;
            const response_guru: string | any = await getResponseGuru(
              text_to_guru
            );

            if (response_guru && response_guru.trim() !== "") {
              console.log("\n" + "-".repeat(80));
              console.log(`🤖 Nueva respuesta: ${response_guru}`);
            }

            // Limpiar archivo temporal
            try {
              fs.unlinkSync(audioFilePath);
            } catch (e) {
              // Ignorar errores
            }
          } catch (error) {
            console.error("❌ Error procesando audio:", error);
          }
        } catch (error) {
          console.error("Error procesando audio:", error);
        } finally {
          // Reiniciar buffers
          rawAudioBuffer = [];
          pcmAudioBuffer = [];
          isProcessingAudio = false;
          vadSpeechDetected = false;
          vadSilenceStartTime = 0;
        }
      };

      // Procesar audio recibido
      ws.on("message", async (data: any, isBinary: boolean) => {
        if (isBinary) {
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
            if (rawAudioBuffer.length % 8 === 0) {
              let totalBytes = 0;
              rawAudioBuffer.forEach((chunk) => (totalBytes += chunk.length));
              console.log(
                `📊 Procesando buffer de ${Math.round(totalBytes / 1000)}KB`
              );
            }

            // Manejar eventos de VAD
            switch (vadResult) {
              case VAD.Event.VOICE:
                if (!vadSpeechDetected) {
                  vadSpeechDetected = true;
                  vadSilenceStartTime = 0;
                }
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
              }s) - Procesando audio...`
            );
            await procesarAudioAcumulado();
          }
        }
      }, 500);

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
    }
  );
};
