import { NextRequest, NextResponse } from 'next/server';
import { callLLM } from '@/lib/ai/llm';
import { resolveModel } from '@/lib/server/resolve-model';
import { createLogger } from '@/lib/logger';

const log = createLogger('parse-lessons');

export async function POST(req: NextRequest) {
  try {
    const { outlineText } = await req.json();
    
    if (!outlineText || typeof outlineText !== 'string') {
      return NextResponse.json({ error: 'outlineText is required' }, { status: 400 });
    }

    log.info('开始AI解析课时大纲...');

    const { model, modelString } = resolveModel({});
    log.info('使用模型:', modelString);

    const prompt = `你是一个课程大纲分析专家。请分析以下课程大纲，将内容智能地划分成多个课时。

要求：
1. 根据语义内容自然地划分课时，不要硬性依赖"第X课"这样的标记
2. 每个课时应该有清晰的标题和内容概述
3. 课时数量应该合理（通常3-10个课时）
4. 返回JSON格式，包含lessons数组

返回格式：
{
  "lessons": [
    {
      "title": "第一节：课时标题",
      "description": "这节课的详细内容概述，包括主要知识点和教学目标"
    }
  ]
}

课程大纲内容：
${outlineText}`;

    const result = await callLLM({
      model,
      messages: [{ role: 'user', content: prompt }],
    }, 'parse-lessons');

    const content = typeof result === 'string' ? result : result.text;

    if (!content) {
      throw new Error('AI返回为空');
    }

    log.info('AI原始返回:', content.substring(0, 500));

    let parsed: { lessons?: Array<{ title: string; description: string }> };
    
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || content.match(/(\{[\s\S]*\})/);
    
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[1]);
      } catch (e) {
        log.warn('JSON解析失败，尝试直接解析:', e);
        const directMatch = content.match(/\{[\s\S]*\}/);
        if (directMatch) {
          parsed = JSON.parse(directMatch[0]);
        } else {
          throw new Error('无法解析AI返回的JSON格式');
        }
      }
    } else {
      throw new Error('AI返回中未找到JSON格式');
    }

    if (!parsed.lessons || !Array.isArray(parsed.lessons)) {
      throw new Error('AI返回格式错误，缺少lessons数组');
    }

    log.info('成功解析', parsed.lessons.length, '个课时');

    return NextResponse.json({ 
      success: true, 
      lessons: parsed.lessons 
    });

  } catch (error) {
    log.error('parse-lessons error:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    }, { status: 500 });
  }
}
