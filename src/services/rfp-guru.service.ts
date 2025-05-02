import axios from "axios";
import dotenv from "dotenv";
import FormData from "form-data";
import https from "https";

dotenv.config();

const httpAgent = new https.Agent({ rejectUnauthorized: false });
const URL_RFP_GURU =
  process.env["URL_RFP_GURU"] || "https://api.rfp.guru/v1/ask";
const RFP_GURU_API_KEY = process.env["RFP_GURU_API_KEY"] || "your-api-key-here";

export async function getResponseGuru(text: string) {
  if (!text || text.trim() === "") {
    return "";
  }

  try {
    const formData = new FormData();
    formData.append("name", "haceb_v6");
    formData.append("question", text);

    console.log(`🔍 Enviando pregunta a RFP Guru: "${text}"`);

    const response = await axios.post(URL_RFP_GURU, formData, {
      headers: {
        ...formData.getHeaders(),
        "x-api-key": `${RFP_GURU_API_KEY}`,
      },
      httpsAgent: httpAgent,
    });

    // Procesar la respuesta para asegurar que sea texto
    if (response.data && typeof response.data === "string") {
      return response.data;
    } else if (response.data && typeof response.data === "object") {
      // Si es un objeto, intentamos extraer el campo de texto relevante
      // Esto dependerá de la estructura exacta de la respuesta de RFP Guru
      if (response.data.answer) {
        return response.data.answer;
      } else if (response.data.text) {
        return response.data.text;
      } else if (response.data.message) {
        return response.data.message;
      } else {
        // Si no encontramos un campo de texto obvio, convertimos el objeto a JSON
        return JSON.stringify(response.data);
      }
    }

    return "No se pudo procesar la respuesta de RFP Guru";
  } catch (error) {
    console.error("❌ Error al obtener respuesta de RFP Guru:", error);
    return "Error al obtener respuesta de RFP Guru";
  }
}
