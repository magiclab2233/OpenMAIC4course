'use client';

import { useState, useRef, useCallback } from 'react';
import { toast } from 'sonner';

interface UseRecorderReturn {
  isRecording: boolean;
  startRecording: (element: any, audioStream: any) => Promise<void>;
  stopRecording: () => void;
  recordingBlob: any;
}

export function useRecorder(): UseRecorderReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingBlob, setRecordingBlob] = useState<any>(null);
  const mediaRecorderRef = useRef<any>(null);
  const chunksRef = useRef<any[]>([]);

  const startRecording = useCallback(async (element: any, audioStream: any) => {
    if (typeof window === 'undefined') return;

    try {
      // 1. Get display media (user selects window/tab)
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        toast.error('浏览器不支持屏幕录制');
        return;
      }

      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'browser',
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 }
        },
        audio: false, // We use the high-quality AudioPlayer stream instead
        // @ts-ignore - Chrome extension for better tab selection
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
      });

      // 2. Combine with AudioPlayer stream
      const tracks = [...displayStream.getVideoTracks()];
      
      // If no audio track from AudioPlayer, create a silent one to keep MediaRecorder happy
      if (audioStream && audioStream.getAudioTracks().length > 0) {
        tracks.push(...audioStream.getAudioTracks());
      } else {
        console.warn('No audio tracks found in audioStream, creating silent track');
        const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
        const ac = new AudioContextClass();
        const dest = ac.createMediaStreamDestination();
        tracks.push(...dest.stream.getAudioTracks());
      }

      const combinedStream = new MediaStream(tracks);

      // Verify tracks
      if (combinedStream.getVideoTracks().length === 0) {
        throw new Error('未能捕获视频轨道');
      }
      console.log(`Combined stream ready with ${combinedStream.getVideoTracks().length} video and ${combinedStream.getAudioTracks().length} audio tracks`);

      // 3. Start recording
      const options = { mimeType: 'video/webm;codecs=vp9,opus' };
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options.mimeType = 'video/webm';
      }

      const recorder = new MediaRecorder(combinedStream, options);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunksRef.current.push(e.data);
          // Reduced logging frequency to avoid flooding
          if (chunksRef.current.length % 5 === 0) {
            console.log(`Recorded chunk: ${e.data.size} bytes. Total chunks: ${chunksRef.current.length}`);
          }
        } else {
          console.warn('MediaRecorder: received empty chunk');
        }
      };

      recorder.onstop = () => {
        console.log('MediaRecorder stopped. Total chunks collected:', chunksRef.current.length);
        const blob = new Blob(chunksRef.current, { type: 'video/webm' });
        console.log('Final video blob size:', blob.size, 'bytes');
        
        setRecordingBlob(blob);
        
        // Stop all tracks
        combinedStream.getTracks().forEach(track => track.stop());
        displayStream.getTracks().forEach(track => track.stop());
        
        if (blob.size < 1000) {
          console.error('Warning: Recorded video is very small. It might be corrupted.');
          toast.error('录制失败：视频数据异常');
          setIsRecording(false);
          return;
        }

        // Trigger download
        console.log('Triggering download via <a> click...');
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = `course-record-${Date.now()}.webm`;
        document.body.appendChild(a);
        a.click();
        console.log('Download triggered.');
        setTimeout(() => {
          document.body.removeChild(a);
          window.URL.revokeObjectURL(url);
          console.log('Blob URL revoked.');
        }, 5000); // Increased from 100ms to 5s for better download capture
        
        setIsRecording(false);
      };

      // Wait a bit for tracks to stabilize
      await new Promise(resolve => setTimeout(resolve, 500));

      recorder.start(1000); // Capture data every 1 second to ensure we have data
      setIsRecording(true);
      toast.success('录制已开始，请确保 PPT 区域可见');

    } catch (err) {
      console.error('Failed to start recording:', err);
      toast.error('录制启动失败: ' + (err instanceof Error ? err.message : String(err)));
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  return {
    isRecording,
    startRecording,
    stopRecording,
    recordingBlob,
  };
}
