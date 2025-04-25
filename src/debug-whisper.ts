/**
 * Script de depuración para enviar un archivo de audio directamente a Whisper
 * Uso: npx ts-node src/debug-whisper.ts <ruta-del-archivo>
 */

import fs from "fs";
import path from "path";
import axios from "axios";
import FormData from "form-data";
import dotenv from "dotenv";

dotenv.config();

// Verificar que se proporcionó un archivo
const audioFilePath = process.argv[2];
if (!audioFilePath) {
  console.error("Error: Debe proporcionar la ruta a un archivo WAV");
  console.error("Uso: npx ts-node src/debug-whisper.ts <ruta-del-archivo>");
  process.exit(1);
}

// Verificar que el archivo existe
if (!fs.existsSync(audioFilePath)) {
  console.error(`Error: El archivo ${audioFilePath} no existe`);
  process.exit(1);
}

// Obtener API key
const OPENAI_API_KEY = process.env["OPENAI_API_KEY"] || "";
if (!OPENAI_API_KEY) {
  console.error("Error: No se ha configurado OPENAI_API_KEY en el .env");
  process.exit(1);
}

// Función para analizar el archivo de audio y detectar si contiene silencio
function analizarAudio(filePath: string) {
  try {
    // Leer el archivo
    const fileBuffer = fs.readFileSync(filePath);

    // Si es un archivo WAV, saltarse el encabezado
    let audioData: Buffer;
    if (filePath.toLowerCase().endsWith(".wav")) {
      // Los datos de audio normalmente comienzan después del encabezado de 44 bytes
      audioData = fileBuffer.slice(44);
    } else {
      audioData = fileBuffer;
    }

    // Calcular estadísticas básicas para PCM16
    let suma = 0;
    let max = 0;
    let min = 65535;
    let muestras = Math.floor(audioData.length / 2); // Para PCM16

    for (let i = 0; i < muestras; i++) {
      const valor = Math.abs(audioData.readInt16LE(i * 2));
      suma += valor;
      max = Math.max(max, valor);
      min = Math.min(min, valor);
    }

    const promedio = suma / muestras;

    console.log(`\n--- ANÁLISIS DE AUDIO ---`);
    console.log(`Tamaño total: ${fileBuffer.length} bytes`);
    console.log(`Tamaño de datos de audio: ${audioData.length} bytes`);
    console.log(`Valor promedio: ${promedio.toFixed(2)}`);
    console.log(`Valor máximo: ${max}`);
    console.log(`Valor mínimo: ${min}`);

    // Detección simple de silencio
    if (max < 500 || promedio < 100) {
      console.log(
        `⚠️ ADVERTENCIA: Este audio parece contener mayormente silencio`
      );
    } else if (max > 10000) {
      console.log(`✅ El audio parece contener voz o sonido`);
    } else {
      console.log(
        `⚠️ El audio tiene niveles bajos, puede ser difícil de transcribir`
      );
    }
    console.log(`--- FIN DEL ANÁLISIS ---\n`);
  } catch (error) {
    console.error("Error analizando audio:", error);
  }
}

async function transcribeFile(filePath: string) {
  console.log(`Transcribiendo archivo: ${filePath}`);
  console.log(`Tamaño: ${(fs.statSync(filePath).size / 1024).toFixed(2)} KB`);

  // Analizar el audio primero
  analizarAudio(filePath);

  try {
    // Leer el archivo
    const fileBuffer = fs.readFileSync(filePath);

    // Crear FormData
    const formData = new FormData();
    formData.append("file", fileBuffer, {
      filename: "audio.wav",
      contentType: "audio/wav",
    });
    formData.append("model", "whisper-1");
    formData.append("response_format", "verbose_json");
    formData.append("language", "es");

    console.log("Enviando solicitud a OpenAI...");

    // Enviar solicitud
    const response = await axios.post(
      "https://api.openai.com/v1/audio/transcriptions",
      formData,
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          ...formData.getHeaders(),
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      }
    );

    // Guardar respuesta completa
    const outputPath = filePath + ".response.json";
    fs.writeFileSync(outputPath, JSON.stringify(response.data, null, 2));
    console.log(`Respuesta guardada en: ${outputPath}`);

    // Mostrar transcripción
    console.log("\n--- TRANSCRIPCIÓN ---\n");
    console.log(response.data.text || "(sin texto)");
    console.log("\n--- FIN ---\n");

    return response.data;
  } catch (error: any) {
    console.error("ERROR:", error.message);
    console.error("RESPUESTA:", error.response?.data);
    return null;
  }
}

// Ejecutar transcripción
transcribeFile(audioFilePath)
  .then(() => console.log("Proceso completado."))
  .catch((err) => console.error("Error global:", err));
