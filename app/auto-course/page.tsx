'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Upload, 
  FileText, 
  Play, 
  Pause, 
  SkipForward, 
  CheckCircle, 
  AlertCircle,
  Loader,
  X,
  Rocket
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/hooks/use-i18n';
import { createLogger } from '@/lib/logger';
import { useSettingsStore } from '@/lib/store/settings';
import { getCurrentModelConfig } from '@/lib/utils/model-config';
import { loadPdfBlob, storePdfBlob } from '@/lib/utils/image-storage';
import { useStageStore } from '@/lib/store/stage';
import { nanoid } from 'nanoid';
import type { SceneOutline } from '@/lib/types/generation';
import { toast } from 'sonner';

const log = createLogger('AutoCourse');

interface LessonOutline {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'generating' | 'playing' | 'completed' | 'error';
}

interface AutoCourseState {
  pdfFile: File | null;
  pdfText: string;
  lessons: LessonOutline[];
  currentLessonIndex: number;
  isProcessing: boolean;
  isParsing: boolean;
  isPlaying: boolean;
  error: string | null;
}

export default function AutoCoursePage() {
  const router = useRouter();
  const { t } = useI18n();
  const [state, setState] = useState<AutoCourseState>({
    pdfFile: null,
    pdfText: '',
    lessons: [],
    currentLessonIndex: 0,
    isProcessing: false,
    isParsing: false,
    isPlaying: false,
    error: null,
  });

  // Track latest state in a ref to avoid stale closures in setInterval
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
    // Persist state to localStorage whenever it changes
    // (excluding the File object which cannot be serialized)
    const { pdfFile, ...rest } = state;
    if (rest.lessons.length > 0) {
      localStorage.setItem('autoCourseState', JSON.stringify(rest));
    }
  }, [state]);

  // Load state on mount
  useEffect(() => {
    const saved = localStorage.getItem('autoCourseState');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setState(s => ({ ...s, ...parsed }));
        // Ensure stateRef is immediately updated for any synchronous calls like handleLessonComplete
        stateRef.current = { ...state, ...parsed };
      } catch (e) {
        log.error('Failed to load saved auto-course state:', e);
      }
    }
  }, []);

  const generateLessonScenesRef = useRef<(index: number) => Promise<void>>(undefined);

  const getApiHeaders = () => {
    const modelConfig = getCurrentModelConfig();
    const settings = useSettingsStore.getState();
    return {
      'Content-Type': 'application/json',
      'x-model': modelConfig.modelString,
      'x-api-key': modelConfig.apiKey,
    };
  };

  const generateScenesForOutline = async (req: { requirement: string; pdfText: string }): Promise<SceneOutline[]> => {
    return new Promise((resolve, reject) => {
      const collected: SceneOutline[] = [];
      
      fetch('/api/generate/scene-outlines-stream', {
        method: 'POST',
        headers: getApiHeaders(),
        body: JSON.stringify({
          requirements: { requirement: req.requirement, language: 'zh-CN' },
          pdfText: req.pdfText,
          numScenes: 10,
        }),
      }).then(async resp => {
        if (!resp.ok) {
          const err = await resp.json();
          reject(new Error(err.error || '生成失败'));
          return;
        }

        const reader = resp.body?.getReader();
        if (!reader) {
          reject(new Error('无法读取响应'));
          return;
        }

        const decoder = new TextDecoder();
        let buffer = '';
        
        const read = async () => {
          try {
            const { done, value } = await reader.read();
            if (done) {
              resolve(collected);
              return;
            }

            buffer += decoder.decode(value, { stream: true });
            
            let newlineIdx;
            while ((newlineIdx = buffer.indexOf('\n\n')) >= 0) {
              const eventStr = buffer.substring(0, newlineIdx).trim();
              buffer = buffer.substring(newlineIdx + 2);
              
              if (!eventStr) continue;
              
              // Handle SSE events
              if (eventStr.startsWith('data: ')) {
                const jsonStr = eventStr.substring(6);
                if (jsonStr === '[DONE]') {
                  resolve(collected);
                  return;
                }
                
                try {
                  const data = JSON.parse(jsonStr);
                  if (data.type === 'outline' && data.data) {
                    collected.push(data.data);
                  } else if (data.type === 'done') {
                    resolve(data.outlines || collected);
                    return;
                  } else if (data.type === 'error') {
                    reject(new Error(data.error || '大纲生成失败'));
                    return;
                  }
                } catch {
                  // Skip invalid JSON
                }
              }
            }
            
            read();
          } catch (err) {
            reject(err);
          }
        };
        
        read();
      }).catch(reject);
    });
  };

  const generateLessonScenes = async (lessonIndex: number) => {
    const lesson = state.lessons[lessonIndex];
    if (!lesson) return;

    setState(s => ({
      ...s,
      isProcessing: true,
      lessons: s.lessons.map((l, i) => 
        i === lessonIndex ? { ...l, status: 'generating' } : l
      ),
    }));

    try {
      const requirementText = `请仅根据以下提供的特定课时大纲内容生成教学场景。不要偏离大纲内容，必须只生成与这部分内容高度相关的场景。\n\n【课时标题】：${lesson.title}\n【课时内容】：\n${lesson.description.substring(0, 3000)}`;
      
      const outlines = await generateScenesForOutline({
        requirement: requirementText,
        pdfText: '', // Pass empty here so it doesn't get confused by the full PDF text
      });

      const stageId = nanoid(10);
      const stage = {
        id: stageId,
        name: lesson.title,
        description: '',
        style: 'professional' as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await useStageStore.getState().setStage(stage);
      
      // Set outlines in the store and ensure they are persisted to IndexedDB
      // before navigating, to avoid race conditions with loadFromStorage
      useStageStore.getState().setOutlines(outlines);
      useStageStore.setState({ scenes: [] });
      
      const { db } = await import('@/lib/utils/database');
      await db.stageOutlines.put({
        stageId,
        outlines,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      
      await useStageStore.getState().saveToStorage();

      setState(s => ({
        ...s,
        isProcessing: false,
        isPlaying: true,
        lessons: s.lessons.map((l, i) => 
          i === lessonIndex ? { ...l, status: 'playing' } : l
        ),
        currentLessonIndex: lessonIndex,
      }));

      router.push(`/classroom/${stageId}?autoPlay=true`);
    } catch (err) {
      log.error('生成失败:', err);
      setState(s => ({
        ...s,
        isProcessing: false,
        error: err instanceof Error ? err.message : '生成失败',
        lessons: s.lessons.map((l, i) => 
          i === lessonIndex ? { ...l, status: 'error' } : l
        ),
      }));
    }
  };

  useEffect(() => {
    generateLessonScenesRef.current = generateLessonScenes;
  }, [generateLessonScenes]);

  useEffect(() => {
    const handleLessonComplete = () => {
      const completedFlag = sessionStorage.getItem('autoCourse LessonComplete');
      if (completedFlag === 'true') {
        sessionStorage.removeItem('autoCourse LessonComplete');
        
        const s = stateRef.current;
        
        // 当页面刚从 localStorage 恢复时，currentLesson 可能仍标记为 'playing'
        // 因此如果 sessionStorage 有完成标记，我们就应该处理它，不论其当前状态
        const currentLesson = s.lessons[s.currentLessonIndex];
        if (!currentLesson) {
            return;
        }

        const nextIndex = s.currentLessonIndex + 1;
        
        if (nextIndex >= s.lessons.length) {
          setState(prev => ({ 
            ...prev, 
            isProcessing: false, 
            isPlaying: false,
            lessons: prev.lessons.map((l, i) => i === prev.currentLessonIndex ? { ...l, status: 'completed' as const } : l)
          }));
        } else {
          setState(prev => ({
            ...prev,
            currentLessonIndex: nextIndex,
            lessons: prev.lessons.map((l, i) => i === prev.currentLessonIndex ? { ...l, status: 'completed' as const } : l)
          }));
          setTimeout(() => {
            if (generateLessonScenesRef.current) {
              generateLessonScenesRef.current(nextIndex);
            }
          }, 1000);
        }
      }
    };

    window.addEventListener('lessonComplete', handleLessonComplete);
    
    // Also check on mount in case we just navigated back from Classroom page
    // Using a slight delay to ensure localStorage state has been fully restored and React rendered
    setTimeout(handleLessonComplete, 100);

    const interval = setInterval(() => {
      if (sessionStorage.getItem('autoCourse LessonComplete') === 'true') {
        handleLessonComplete();
      }
    }, 1000);

    return () => {
      window.removeEventListener('lessonComplete', handleLessonComplete);
      clearInterval(interval);
    };
  }, []);

  const handleFileUpload = async (file: File) => {
    if (!file.type.includes('pdf')) {
      setState(s => ({ ...s, error: '请上传PDF文件' }));
      return;
    }

    setState(s => ({ ...s, pdfFile: file, error: null, isParsing: true }));

    try {
      const pdfText = await extractPdfText(file);
      
      let lessons: LessonOutline[];
      
      try {
        lessons = await parseLessonsWithAI(pdfText);
        log.info('AI解析成功，共', lessons.length, '个课时');
        toast.success(`AI解析成功，共 ${lessons.length} 个课时`);
      } catch (aiErr) {
        log.warn('AI解析失败，使用正则解析:', aiErr);
        toast.warning(`AI解析失败，将使用基础解析: ${aiErr instanceof Error ? aiErr.message : '未知错误'}`);
        lessons = parseLessonsFromPdf(pdfText);
        if (lessons.length === 1) {
          log.warn('大纲内容预览:', pdfText.substring(0, 500));
        }
      }
      
      setState(s => ({ 
        ...s, 
        pdfText, 
        lessons: lessons.map(l => ({ ...l, status: 'pending' as const })),
        isParsing: false,
      }));
    } catch (err) {
      log.error('PDF处理失败:', err);
      setState(s => ({ ...s, error: 'PDF解析失败，请检查文件格式', isParsing: false }));
    }
  };

  const parseLessonsWithAI = async (outlineText: string): Promise<LessonOutline[]> => {
    const response = await fetch('/api/parse-lessons', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ outlineText }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: '解析失败' }));
      throw new Error(err.error || 'AI课时解析失败');
    }

    const data = await response.json();
    
    if (!data.success || !data.lessons) {
      throw new Error(data.error || 'AI解析返回格式错误');
    }

    return data.lessons.map((l: { title: string; description: string }) => ({
      id: nanoid(),
      title: l.title || '未命名课时',
      description: l.description || '',
      status: 'pending' as const,
    }));
  };

  const extractPdfText = async (file: File): Promise<string> => {
    const formData = new FormData();
    formData.append('pdf', file);
    formData.append('providerId', 'unpdf');
    
    const response = await fetch('/api/parse-pdf', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: '解析失败' }));
      throw new Error(err.error || 'PDF解析失败');
    }

    const data = await response.json();
    return data.data?.text || data.text || '';
  };

  const parseLessonsFromPdf = (text: string): LessonOutline[] => {
    const lessons: LessonOutline[] = [];
    const lines = text.split('\n');
    
    let currentLesson: LessonOutline | null = null;
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      const lessonMatch = trimmed.match(/^(第[一二三四五六七八九十\d]+[课章篇部分]|Lesson\s*\d+|Chapter\s*\d+|第\s*\d+\s*[课章])/i);
      if (lessonMatch) {
        if (currentLesson) {
          lessons.push(currentLesson);
        }
        currentLesson = {
          id: nanoid(),
          title: trimmed.substring(0, 100),
          description: '',
          status: 'pending',
        };
      } else if (currentLesson) {
        currentLesson.description += (currentLesson.description ? '\n' : '') + trimmed;
      }
    }
    
    if (currentLesson) {
      lessons.push(currentLesson);
    }

    if (lessons.length === 0) {
      lessons.push({
        id: nanoid(),
        title: '课程大纲',
        description: text.substring(0, 1000),
        status: 'pending',
      });
    }

    return lessons;
  };

  const startAutoProcess = async () => {
    if (state.lessons.length === 0) return;
    
    await generateLessonScenes(0);
  };

  const skipCurrentLesson = () => {
    setState(s => ({
      ...s,
      lessons: s.lessons.map((l, i) => 
        i === s.currentLessonIndex ? { ...l, status: 'completed' } : l
      ),
      currentLessonIndex: s.currentLessonIndex + 1,
    }));
    
    if (state.currentLessonIndex + 1 < state.lessons.length) {
      generateLessonScenes(state.currentLessonIndex + 1);
    } else {
      setState(s => ({ ...s, isProcessing: false }));
      toast.success('所有课时已完成！');
    }
  };

  return (
    <div className="min-h-[100dvh] w-full bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 flex flex-col items-center p-4 pt-16 md:p-8 md:pt-16">
      <div className="w-full max-w-4xl">
        <div className="flex items-center gap-4 mb-8">
          <button
            onClick={() => router.push('/')}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <Rocket className="w-6 h-6 text-violet-600" />
            <h1 className="text-xl font-semibold">自动做课</h1>
          </div>
        </div>

        {state.lessons.length === 0 ? (
          <div className="border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-2xl p-12 text-center">
            <label className="flex flex-col items-center cursor-pointer">
              <Upload className="w-12 h-12 text-gray-400 mb-4" />
              <span className="text-lg font-medium mb-2">上传课程大纲PDF</span>
              <span className="text-sm text-gray-500">请上传包含多个课时大纲的PDF文件</span>
              <input
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileUpload(file);
                }}
              />
            </label>
          </div>
        ) : state.isParsing ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl p-8 shadow-lg text-center">
            <Loader className="w-8 h-8 text-violet-600 animate-spin mx-auto mb-4" />
            <h2 className="text-lg font-medium mb-2">正在通过AI分析课程大纲</h2>
            <p className="text-sm text-gray-500">AI正在语义分析课时结构，请稍候...</p>
          </div>
        ) : state.lessons.length > 0 && (state.isProcessing || state.isPlaying || state.lessons.some(l => l.status === 'playing' || l.status === 'generating')) ? (
          <div className="space-y-6">
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-lg">
              <div className="flex items-center gap-3 mb-4">
                <Loader className="w-5 h-5 text-violet-600 animate-spin" />
                <span className="font-medium">正在处理第 {state.currentLessonIndex + 1} 课时</span>
              </div>
              
              <div className="space-y-2 mb-6 max-h-[400px] overflow-y-auto">
                {state.lessons.map((lesson, index) => (
                  <div
                    key={lesson.id}
                    className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50"
                  >
                    <span className="w-8 h-8 rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 flex items-center justify-center text-sm font-medium">
                      {index + 1}
                    </span>
                    <span className="flex-1 truncate">{lesson.title}</span>
                    <span className={cn(
                      'text-xs px-2 py-1 rounded-full',
                      lesson.status === 'pending' && 'bg-gray-100 text-gray-600',
                      lesson.status === 'generating' && 'bg-yellow-100 text-yellow-600',
                      lesson.status === 'playing' && 'bg-blue-100 text-blue-600',
                      lesson.status === 'completed' && 'bg-green-100 text-green-600',
                      lesson.status === 'error' && 'bg-red-100 text-red-600',
                    )}>
                      {lesson.status === 'pending' && '待生成'}
                      {lesson.status === 'generating' && '生成中'}
                      {lesson.status === 'playing' && '播放中'}
                      {lesson.status === 'completed' && '已完成'}
                      {lesson.status === 'error' && '失败'}
                    </span>
                  </div>
                ))}
              </div>
              
              {state.lessons[state.currentLessonIndex]?.status === 'playing' && (
                <div className="text-sm text-gray-500 text-center">
                  <p>正在全屏播放，请勿关闭浏览器</p>
                  <p className="text-xs mt-1">播放完毕后将自动进入下一课时</p>
                </div>
              )}
            </div>
            
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                <div className="text-sm text-blue-800 dark:text-blue-200">
                  <p className="font-medium mb-1">自动做课进行中...</p>
                  <p className="opacity-80">当前课时：{state.lessons[state.currentLessonIndex]?.title}</p>
                </div>
              </div>
            </div>
          </div>
        ) : state.lessons.length > 0 && !state.lessons.some(l => l.status === 'playing' || l.status === 'generating') ? (
          <div className="space-y-6">
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-lg">
              <div className="flex items-center gap-3 mb-4">
                <FileText className="w-5 h-5 text-violet-600" />
                <span className="font-medium">已解析 {state.lessons.length} 个课时</span>
              </div>
              
              <div className="space-y-2 mb-6 max-h-[400px] overflow-y-auto">
                {state.lessons.map((lesson, index) => (
                  <div
                    key={lesson.id}
                    className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50"
                  >
                    <span className="w-8 h-8 rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 flex items-center justify-center text-sm font-medium">
                      {index + 1}
                    </span>
                    <span className="flex-1 truncate">{lesson.title}</span>
                    <span className={cn(
                      'text-xs px-2 py-1 rounded-full',
                      lesson.status === 'pending' && 'bg-gray-100 text-gray-600',
                      lesson.status === 'generating' && 'bg-yellow-100 text-yellow-600',
                      lesson.status === 'playing' && 'bg-green-100 text-green-600',
                      lesson.status === 'completed' && 'bg-green-100 text-green-600',
                      lesson.status === 'error' && 'bg-red-100 text-red-600',
                    )}>
                      {lesson.status === 'pending' && '待生成'}
                      {lesson.status === 'generating' && '生成中'}
                      {lesson.status === 'playing' && '播放中'}
                      {lesson.status === 'completed' && '已完成'}
                      {lesson.status === 'error' && '失败'}
                    </span>
                  </div>
                ))}
              </div>

              <div className="flex gap-3">
                <Button
                  onClick={() => {
                    localStorage.removeItem('autoCourseState');
                    setState({
                      pdfFile: null,
                      pdfText: '',
                      lessons: [],
                      currentLessonIndex: 0,
                      isProcessing: false,
                      isParsing: false,
                      isPlaying: false,
                      error: null,
                    });
                  }}
                  variant="outline"
                  className="flex-1"
                >
                  重新上传
                </Button>
                <Button
                  onClick={startAutoProcess}
                  className="flex-1 bg-violet-600 hover:bg-violet-700"
                >
                  <Play className="w-4 h-4 mr-2" />
                  开始自动生成
                </Button>
              </div>
            </div>

            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-yellow-600 shrink-0 mt-0.5" />
                <div className="text-sm text-yellow-800 dark:text-yellow-200">
                  <p className="font-medium mb-1">自动做课流程：</p>
                  <ul className="list-disc list-inside space-y-1 opacity-80">
                    <li>自动依次生成每个课时的场景</li>
                    <li>每个课时生成完毕后自动进入全屏播放</li>
                    <li>播放完毕自动进入下一个课时</li>
                    <li>播放时会跳过讨论和习题环节</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        ) : state.isProcessing ? (
          <div className="text-center py-12">
            <Loader className="w-12 h-12 text-violet-600 animate-spin mx-auto mb-4" />
            <p className="text-lg font-medium">正在生成第 {state.currentLessonIndex + 1} 课时...</p>
            <p className="text-sm text-gray-500 mt-2">请稍候</p>
          </div>
        ) : null}

        {state.error && (
          <div className="mt-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>
          </div>
        )}
      </div>
    </div>
  );
}