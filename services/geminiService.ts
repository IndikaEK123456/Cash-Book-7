
import { GoogleGenAI, Type } from "@google/genai";
import { DEFAULT_LKR_USD, DEFAULT_LKR_EURO } from "../constants";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

export const fetchLiveExchangeRates = async (): Promise<{ usd: number; euro: number }> => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: "Return the current exchange rate for 1 USD to LKR and 1 EURO to LKR. Format as JSON only with keys 'usd' and 'euro'.",
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            usd: { type: Type.NUMBER },
            euro: { type: Type.NUMBER }
          },
          required: ["usd", "euro"]
        }
      }
    });

    const rates = JSON.parse(response.text);
    return {
      usd: Math.ceil(rates.usd || DEFAULT_LKR_USD),
      euro: Math.ceil(rates.euro || DEFAULT_LKR_EURO)
    };
  } catch (error) {
    console.error("Failed to fetch rates:", error);
    return { usd: DEFAULT_LKR_USD, euro: DEFAULT_LKR_EURO };
  }
};
