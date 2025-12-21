
// @google/genai Service for script processing, image generation, and video generation.
import { GoogleGenAI, Type } from "@google/genai";
import { Shot, GlobalConfig, ScriptBreakdownResponse, PromptOptimization, Character, Scene, Prop } from "../types";
import { 
  SYSTEM_INSTRUCTION_BREAKDOWN, 
  SYSTEM_INSTRUCTION_MATRIX,
  SYSTEM_INSTRUCTION_OPTIMIZE,
  TEXT_MODEL,
  IMAGE_MODEL
} from "../constants";

// Initializes the AI client. Creates a new instance on each call to ensure the latest API key is used.
const getAiClient = () => {
  return new GoogleGenAI({ apiKey: process.env.API_KEY });
};

// Safely parses JSON output from the model.
const safeJsonParse = (text: string) => {
  try {
    return JSON.parse(text);
  } catch (e) {
    const jsonMatch = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch (innerE) {
        return null;
      }
    }
    return null;
  }
};

// Helper to construct asset context for prompts.
const getShotAssetContext = (shot: Shot, config: GlobalConfig): string => {
  const parts: string[] = [];
  const relevantChars = shot.characterIds && shot.characterIds.length > 0 
    ? config.characters.filter(c => shot.characterIds?.includes(c.id))
    : [];
  if (relevantChars.length > 0) parts.push(`Characters: ${relevantChars.map(c => `${c.name}(${c.description})`).join(', ')}`);
  
  const relevantScenes = shot.sceneIds && shot.sceneIds.length > 0 
    ? config.scenes.filter(s => shot.sceneIds?.includes(s.id))
    : [];
  if (relevantScenes.length > 0) parts.push(`Environment: ${relevantScenes.map(s => `${s.name}(${s.description})`).join(', ')}`);
  
  return parts.join(' | ');
};

// Breaks down a script into shots and characters.
export const breakdownScript = async (script: string, config: GlobalConfig): Promise<ScriptBreakdownResponse> => {
  const ai = getAiClient();
  const response = await ai.models.generateContent({
    model: TEXT_MODEL,
    contents: script,
    config: {
      systemInstruction: SYSTEM_INSTRUCTION_BREAKDOWN,
      thinkingConfig: { thinkingBudget: 4000 },
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          context: { type: Type.STRING },
          shots: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                originalText: { type: Type.STRING },
                visualTranslation: { type: Type.STRING },
                contextTag: { type: Type.STRING },
              },
              required: ["id", "originalText", "visualTranslation", "contextTag"]
            }
          },
          characters: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                description: { type: Type.STRING }
              },
              required: ["name", "description"]
            }
          }
        },
        required: ["context", "shots", "characters"]
      }
    }
  });
  const result = safeJsonParse(response.text || '{}') || {};
  return {
    context: result.context || '',
    shots: (result.shots || []).map((s: any) => ({ 
      ...s, status: 'pending', progress: 0,
      characterIds: [], sceneIds: [], propIds: [],
      videoUrls: Array(9).fill(null),
      videoStatus: Array(9).fill('idle')
    })),
    characters: result.characters || []
  };
};

// Recommends assets from the library for a given shot.
export const recommendAssets = async (shot: Shot, config: GlobalConfig): Promise<{ characterIds: string[], sceneIds: string[], propIds: string[] }> => {
  const ai = getAiClient();
  const assetLibrary = {
    characters: config.characters.map(c => ({ id: c.id, name: c.name, description: c.description })),
    scenes: config.scenes.map(s => ({ id: s.id, name: s.name, description: s.description })),
    props: config.props.map(p => ({ id: p.id, name: p.name, description: p.description }))
  };
  const response = await ai.models.generateContent({
    model: TEXT_MODEL,
    contents: `Visual: ${shot.visualTranslation}\nLibrary: ${JSON.stringify(assetLibrary)}`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          characterIds: { type: Type.ARRAY, items: { type: Type.STRING } },
          sceneIds: { type: Type.ARRAY, items: { type: Type.STRING } },
          propIds: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ["characterIds", "sceneIds", "propIds"]
      }
    }
  });
  return safeJsonParse(response.text || '{"characterIds":[],"sceneIds":[],"propIds":[]}') || {characterIds:[], sceneIds:[], propIds:[]};
};

// Generates 9 distinct camera angles for a single shot.
export const generateMatrixPrompts = async (shot: Shot, config: GlobalConfig): Promise<string[]> => {
  const ai = getAiClient();
  const assetContext = getShotAssetContext(shot, config);
  const response = await ai.models.generateContent({
    model: TEXT_MODEL,
    contents: `Global Style: ${config.artStyle}\nAssets: ${assetContext}\nDescription: ${shot.visualTranslation}`,
    config: {
      systemInstruction: SYSTEM_INSTRUCTION_MATRIX,
      responseMimeType: "application/json",
      responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } }
    }
  });
  return safeJsonParse(response.text || '[]') || [];
};

/**
 * Fixes Error in App.tsx: Module '"./services/geminiService"' has no exported member 'optimizePrompts'.
 * Analyzes and improves existing prompt matrices.
 */
export const optimizePrompts = async (shot: Shot, config: GlobalConfig): Promise<PromptOptimization> => {
  const ai = getAiClient();
  const assetContext = getShotAssetContext(shot, config);
  const response = await ai.models.generateContent({
    model: TEXT_MODEL,
    contents: `Global Style: ${config.artStyle}\nAssets: ${assetContext}\nDescription: ${shot.visualTranslation}\nCurrent Prompts: ${JSON.stringify(shot.matrixPrompts)}`,
    config: {
      systemInstruction: SYSTEM_INSTRUCTION_OPTIMIZE,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          critique: { type: Type.STRING },
          suggestions: { type: Type.ARRAY, items: { type: Type.STRING } },
          optimizedPrompts: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ["critique", "suggestions", "optimizedPrompts"]
      }
    }
  });
  const result = safeJsonParse(response.text || '{}') || {};
  return {
    critique: result.critique || '',
    suggestions: result.suggestions || [],
    optimizedPrompts: result.optimizedPrompts || []
  };
};

/**
 * Generates a single 3x3 grid image containing 9 views.
 * Uses gemini-3-pro-image-preview for high-quality production.
 */
export const generateGridImage = async (shot: Shot, config: GlobalConfig): Promise<string> => {
  const ai = getAiClient();
  const prompts = shot.matrixPrompts || [];
  
  const compositePrompt = `[CORE TASK: GENERATE A SINGLE 3x3 GRID IMAGE CONTAINING 9 DIFFERENT VIEWS]
Global Style: ${config.artStyle}
Consistency: Ensure the same characters and environment across all 9 panels.

Panel Content Assignments:
1. Top-Left: ${prompts[0]}
2. Top-Center: ${prompts[1]}
3. Top-Right: ${prompts[2]}
4. Mid-Left: ${prompts[3]}
5. Mid-Center: ${prompts[4]}
6. Mid-Right: ${prompts[5]}
7. Bottom-Left: ${prompts[6]}
8. Bottom-Center: ${prompts[7]}
9. Bottom-Right: ${prompts[8]}

Requirement: Uniform quality, no visible grid lines, logical spatial transition between views.`;

  const imageParts: any[] = [];
  const selectedAssetsWithImages = [
    ...config.characters.filter(c => shot.characterIds?.includes(c.id)),
    ...config.scenes.filter(s => shot.sceneIds?.includes(s.id))
  ].filter(a => a.refImage);

  selectedAssetsWithImages.forEach(asset => {
    const base64Data = asset.refImage!.split(',')[1];
    const mimeType = asset.refImage!.split(';')[0].split(':')[1];
    imageParts.push({ inlineData: { data: base64Data, mimeType } });
    imageParts.push({ text: `Style Reference for ${asset.name}` });
  });

  const response = await ai.models.generateContent({
    model: IMAGE_MODEL,
    contents: { parts: [...imageParts, { text: compositePrompt }] },
    config: { 
      imageConfig: { aspectRatio: config.aspectRatio, imageSize: config.resolution as any } 
    },
  });

  for (const part of response.candidates[0].content.parts) {
    if (part.inlineData) return `data:image/png;base64,${part.inlineData.data}`;
  }
  throw new Error("母图渲染失败");
};

/**
 * Generates video preview using Veo 3.1 Fast models.
 * Polls for operation completion.
 */
export const generateShotVideo = async (imageUri: string, prompt: string, config: GlobalConfig): Promise<string> => {
  const ai = getAiClient();
  const base64Data = imageUri.split(',')[1];
  const mimeType = imageUri.split(';')[0].split(':')[1];

  let operation = await ai.models.generateVideos({
    model: 'veo-3.1-fast-generate-preview',
    prompt: `Dramatic cinematic movement based on this pre-viz shot: ${prompt}`,
    image: {
      imageBytes: base64Data,
      mimeType: mimeType
    },
    config: {
      numberOfVideos: 1,
      resolution: '720p',
      aspectRatio: config.aspectRatio
    }
  });

  // Polling every 10 seconds as per guideline recommendation.
  while (!operation.done) {
    await new Promise(resolve => setTimeout(resolve, 10000));
    operation = await ai.operations.getVideosOperation({ operation: operation });
  }

  const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
  if (!downloadLink) throw new Error("视频生成超时或未找到");
  
  const response = await fetch(`${downloadLink}&key=${process.env.API_KEY}`);
  const blob = await response.blob();
  return URL.createObjectURL(blob);
};

// Expands visual descriptions for assets.
export const enhanceAssetDescription = async (name: string, currentDesc: string): Promise<string> => {
  const ai = getAiClient();
  const response = await ai.models.generateContent({
    model: TEXT_MODEL,
    contents: `为"${name}"扩充视觉描述。原描述："${currentDesc}"。涵盖材质、色彩、光影。只返回文字。`,
  });
  return response.text || currentDesc;
};

// Generates concept art for library assets.
export const generateAssetImage = async (name: string, description: string, config: GlobalConfig): Promise<string> => {
  const ai = getAiClient();
  const response = await ai.models.generateContent({
    model: IMAGE_MODEL,
    contents: `[Concept Art] Style: ${config.artStyle}, Subject: ${name}, Details: ${description}`,
    config: { imageConfig: { aspectRatio: "1:1", imageSize: "1K" } },
  });
  for (const part of response.candidates[0].content.parts) {
    if (part.inlineData) return `data:image/png;base64,${part.inlineData.data}`;
  }
  throw new Error("Asset Image fail");
};

// Analyzes shots for missing assets.
export const discoverMissingAssets = async (shot: Shot, config: GlobalConfig): Promise<{ characters: any[], scenes: any[], props: any[] }> => {
  const ai = getAiClient();
  const currentAssetNames = { characters: config.characters.map(c => c.name), scenes: config.scenes.map(s => s.name) };
  const response = await ai.models.generateContent({
    model: TEXT_MODEL,
    contents: `分析分镜：${shot.visualTranslation}\n已有库：${JSON.stringify(currentAssetNames)}\n提取库中缺失的实体并描述。`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          characters: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { name: { type: Type.STRING }, description: { type: Type.STRING } } } },
          scenes: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { name: { type: Type.STRING }, description: { type: Type.STRING } } } },
          props: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { name: { type: Type.STRING }, description: { type: Type.STRING } } } }
        }
      }
    }
  });
  return safeJsonParse(response.text || '{"characters":[],"scenes":[],"props":[]}') || { characters: [], scenes: [], props: [] };
};
