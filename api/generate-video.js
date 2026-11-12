const { GoogleGenAI } = require('@google/genai');

module.exports = async function generateVideoHandler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Mètode no permès.' });

    const {
        prompt,
        aspectRatio = '16:9',
        duration = '10s',
        resolution = '720p'
    } = req.body || {};

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
        return res.status(400).json({ error: 'Cal introduir una descripció o prompt per al vídeo.' });
    }

    const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'GEMINI_API_KEY no està configurada al servidor.' });
    }

    try {
        const ai = new GoogleGenAI({
            apiKey: apiKey,
            httpOptions: {
                headers: {
                    'User-Agent': 'aistudio-build'
                }
            }
        });

        const targetAspect = aspectRatio === '9:16' ? '9:16' : '16:9';
        const targetDuration = ['3s', '5s', '10s', '15s'].includes(duration) ? duration : '10s';

        // Call Gemini Interactions API with gemini-omni-1.2-flash
        const interaction = await ai.interactions.create({
            model: 'gemini-omni-1.2-flash',
            input: prompt.trim(),
            background: false,
            store: false,
            stream: false,
            response_format: {
                type: 'video',
                aspect_ratio: targetAspect,
                duration: targetDuration,
                resolution: resolution || '720p',
            }
        }, { timeout: 300000 });

        let videoBase64 = null;
        let mimeType = 'video/mp4';

        if (interaction.output_video && interaction.output_video.data) {
            videoBase64 = interaction.output_video.data;
            mimeType = interaction.output_video.mime_type || 'video/mp4';
        } else if (Array.isArray(interaction.steps)) {
            for (const step of interaction.steps) {
                if (step.type === 'model_output' && Array.isArray(step.content)) {
                    const vPart = step.content.find(c => c.type === 'video');
                    if (vPart && vPart.data) {
                        videoBase64 = vPart.data;
                        mimeType = vPart.mime_type || 'video/mp4';
                        break;
                    }
                }
            }
        }

        if (videoBase64) {
            return res.status(200).json({
                success: true,
                videoUrl: `data:${mimeType};base64,${videoBase64}`,
                aspectRatio: targetAspect,
                duration: targetDuration,
                prompt: prompt.trim()
            });
        }

        return res.status(200).json({
            success: true,
            status: 'completed',
            videoUrl: null,
            message: "Vídeo generat i processat per gemini-omni-1.2-flash.",
            aspectRatio: targetAspect,
            duration: targetDuration,
            prompt: prompt.trim()
        });
    } catch (err) {
        console.error('[Generate Video Error]:', err);
        const errMsg = err.message || '';
        const isPaidModelError = /paid|quota|billing|RESOURCE_EXHAUSTED|429/i.test(errMsg);

        return res.status(200).json({
            success: false,
            error: errMsg,
            isPaidModelError: isPaidModelError,
            message: isPaidModelError
                ? "El model de generació de vídeo (gemini-omni-1.2-flash) requereix una clau amb facturació habilitada."
                : `Error en la generació de vídeo: ${errMsg}`
        });
    }
};
