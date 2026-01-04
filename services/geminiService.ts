
import { GoogleGenAI, Type } from "@google/genai";
import { DEFAULT_LKR_USD, DEFAULT_LKR_EURO } from "../constants";

// Safe API Key retrieval for various environments (Vite, Web, Vercel)
const getApiKey = () => {
  try {
    // Check multiple possible locations for the key
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
  
  // If no key, return defaults immediately to avoid crashes
  if (!apiKey) {
    return { usd: DEFAULT_LKR_USD, euro: DEFAULT_LKR_EURO };
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: "Output only the current approximate exchange rate for 1 USD to Sri Lankan Rupee (LKR) and 1 EURO to LKR. Format as JSON: {\"usd\": number, \"euro\": number}",
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            usd: { type: Type.NUMBER, description: "1 USD to LKR" },
            euro: { type: Type.NUMBER, description: "1 EURO to LKR" }
          },
          required: ["usd", "euro"]
        }
      }
    });

    const rates = JSON.parse(response.text || "{}");
    // Rule 12: No decimals, rounded up (e.g. 309.1 -> 310)
    return {
      usd: Math.ceil(Number(rates.usd) || DEFAULT_LKR_USD),
      euro: Math.ceil(Number(rates.euro) || DEFAULT_LKR_EURO)
    };
  } catch (error) {
    console.warn("Currency sync failed, using defaults:", error);
    return { usd: DEFAULT_LKR_USD, euro: DEFAULT_LKR_EURO };
  }
};
