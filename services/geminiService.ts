
import { GoogleGenAI, Type } from "@google/genai";
import { DEFAULT_LKR_USD, DEFAULT_LKR_EURO } from "../constants";

const getApiKey = (): string => {
  try {
    // Attempt to get API key from various common injection points
    // @ts-ignore
    const key = (typeof process !== 'undefined' && process.env?.API_KEY) || 
                // @ts-ignore
                (import.meta && import.meta.env && import.meta.env.VITE_API_KEY) || 
                '';
    return key;
  } catch (e) {
    return '';
  }
};

export const fetchLiveExchangeRates = async (): Promise<{ usd: number; euro: number }> => {
  const apiKey = getApiKey();
  
  if (!apiKey) {
    console.warn("API Key not found, using default rates.");
    return { usd: DEFAULT_LKR_USD, euro: DEFAULT_LKR_EURO };
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: "Return only the current exchange rate for 1 USD to LKR and 1 EURO to LKR. Response must be a JSON object: {\"usd\": number, \"euro\": number}",
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

    const rates = JSON.parse(response.text || "{}");
    // Rule 12: Rounding like 309.1 to 310
    return {
      usd: Math.ceil(Number(rates.usd) || DEFAULT_LKR_USD),
      euro: Math.ceil(Number(rates.euro) || DEFAULT_LKR_EURO)
    };
  } catch (error) {
    console.error("Exchange rate fetch failed:", error);
    return { usd: DEFAULT_LKR_USD, euro: DEFAULT_LKR_EURO };
  }
};
