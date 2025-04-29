import dotenv from "dotenv";
import fs from "fs";
import OpenAI from "openai";
import { OpenAiModels } from "../enums/openai.enum";
dotenv.config();

const openai = new OpenAI({
  apiKey: process.env["OPENAI_API_KEY"],
});
export async function transcribeWithWhisper(audioFilePath: string) {
  try {
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(audioFilePath),
      model: OpenAiModels.GPT_4O_TRANSCRIBE,
      language: "es",
      prompt:
        "Transcribe una llamada de servicio al cliente en español colombiano. El cliente puede hablar informalmente, usar muletillas o expresiones comunes. Mantén las palabras tal como las dice, incluso si hay errores gramaticales o frases incompletas.",
    });
    return transcription.text;
  } catch (error: any) {
    console.error("Error transcribiendo el audio:", error?.message);
    throw error;
  }
}

export async function extractQuestionFromTranscription(transcription: string) {
  try {
    const prompt = `
      Eres un asistente que recibe transcripciones largas.
      Debes identificar y reformular la verdadera pregunta que el usuario quiere hacer.
      Ignora información irrelevante o comentarios casuales.
      Si no se detecta una pregunta de valor, responde exactamente: "NO PREGUNTA".

      Transcripción:
      """${transcription}"""

      Pregunta formulada:
    `;

    const completion = await openai.responses.create({
      model: OpenAiModels.GPT_4O,
      instructions:
        "Eres un asistente que analiza llamadas de clientes y extrae la necesidad principal en una sola pregunta clara y directa de lo que el cliente quiere saber.",
      input: prompt,
      temperature: 0.1,
    });

    return completion.output_text;
  } catch (error: any) {
    console.error("Error extrayendo la pregunta:", error?.message);
    throw error;
  }
}
