const { GoogleGenAI } = require('@google/genai');

module.exports = async function generateImageHandler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Mètode no permès.' });

    const { prompt, aspectRatio = '1:1' } = req.body || {};

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
        return res.status(400).json({ error: 'Cal introduir un prompt per a la imatge.' });
    }

    const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'GEMINI_API_KEY no està configurada al servidor.' });
    }

    const validRatios = ['1:1', '3:4', '4:3', '9:16', '16:9'];
    const targetAspect = validRatios.includes(aspectRatio) ? aspectRatio : '1:1';

    try {
        const ai = new GoogleGenAI({
            apiKey: apiKey,
            httpOptions: {
                headers: {
                    'User-Agent': 'aistudio-build'
                }
            }
        });

        const response = await ai.models.generateContent({
            model: 'gemini-3.1-flash-lite-image',
            contents: {
                parts: [
                    { text: prompt.trim() }
                ]
            },
            config: {
                imageConfig: {
                    aspectRatio: targetAspect
                }
            }
        });

        let imageUrl = null;
        let textDescription = "";

        const parts = response.candidates?.[0]?.content?.parts || [];
        for (const part of parts) {
            if (part.inlineData && part.inlineData.data) {
                const mime = part.inlineData.mimeType || 'image/png';
                imageUrl = `data:${mime};base64,${part.inlineData.data}`;
                break;
            } else if (part.text) {
                textDescription += part.text;
            }
        }

        if (imageUrl) {
            return res.status(200).json({
                success: true,
                imageUrl: imageUrl,
                aspectRatio: targetAspect,
                prompt: prompt.trim(),
                description: textDescription
            });
        }

        return res.status(200).json({
            success: false,
            message: "La IA ha respost però no ha retornat cap part d'imatge codificada.",
            description: textDescription
        });
    } catch (err) {
        console.error('[Generate Image Error]:', err);
        return res.status(500).json({
            success: false,
            error: err.message || 'Error generant la imatge amb Gemini'
        });
    }
};
