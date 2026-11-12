const { GoogleGenAI } = require('@google/genai');

module.exports = async function analyzeMultimodalHandler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Mètode no permès.' });

    const {
        mediaBase64,
        mimeType = 'image/png',
        analysisMode = 'all', // 'objects', 'ocr', 'all', 'video'
        prompt = ''
    } = req.body || {};

    if (!mediaBase64) {
        return res.status(400).json({ error: 'Cal enviar la imatge o vídeo codificat en base64.' });
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

        const isVideo = mimeType.startsWith('video/');
        let systemInstruction = "";

        if (isVideo) {
            systemInstruction = `Ets un sistema d'IA avançat especialitzat en l'anàlisi de vídeo per a educació i estudi.
La teva missió és:
1. DESGLOSSAMENT TEMPORAL I D'ESCENES: Identifica els canvis d'escena clau i què succeeix en cadascuna.
2. DETECCIONS D'OBJECTES I ACCIONS: Descriu amb precisió els elements visuals, personatges, gràfics o experiments que apareixen.
3. RECONEIXEMENT DE TEXT (OCR EN VÍDEO): Extreu qualsevol text que aparegui en pantalla, diapositives, pissarres o rètols.
4. SÍNTESI D'APRENENTATGE: Resumeix el contingut acadèmic o concepte clau transmès pel vídeo.
Respon sempre en Català amb un to acadèmic estructurat i clar en format Markdown net.`;
        } else {
            systemInstruction = `Ets un analitzador visual i pericial d'alt rendiment acadèmic especialitzat en imatges, esquemes i documents d'estudi.
La teva missió és:
1. DETECCIÓ DETALLADA D'OBJECTES: Identifica tots els elements visuals rellevants, la seva disposició espacial, estructura i components.
2. RECONEIXEMENT DETALLAT DE TEXT (OCR): Llegeix i transcriu amb exactitud mil·limètrica tot el text imprès o manuscrit, fórmules matemàtiques o químiques (en format LaTeX com $E=mc^2$), taules i diagrames.
3. EXPLICACIÓ CONCEPTUAL: Explica el significat acadèmic, funcionament o rellevància del que es mostra a la imatge per a la preparació d'un examen.
4. PUNTUACIÓ I PREGUNTES D'EXAMEN: Proposa una pregunta d'examen basada directament en la imatge.
Respon sempre en Català estructurat en seccions clares.`;
        }

        const userPrompt = prompt.trim() || (isVideo
            ? "Fes una anàlisi completa del vídeo: seqüències, objectes detectats, text a la pantalla i resum educatiu."
            : "Analitza detalladament aquesta imatge: objectes detectats, transcripció completa de text/fórmules (OCR) i explicació conceptual per a exàmens.");

        const cleanBase64 = mediaBase64.replace(/^data:[^;]+;base64,/, '');

        const response = await ai.models.generateContent({
            model: 'gemini-3.8-flash',
            contents: {
                parts: [
                    {
                        inlineData: {
                            mimeType: mimeType,
                            data: cleanBase64
                        }
                    },
                    {
                        text: userPrompt
                    }
                ]
            },
            config: {
                systemInstruction: systemInstruction
            }
        });

        const analysisText = response.text || '';

        return res.status(200).json({
            success: true,
            analysis: analysisText,
            isVideo: isVideo,
            mimeType: mimeType
        });
    } catch (err) {
        console.error('[Analyze Multimodal Error]:', err);
        return res.status(500).json({
            success: false,
            error: err.message || 'Error analitzant el contingut multimèdia'
        });
    }
};
