import React, { useEffect, useRef } from 'react';
import * as Tone from 'tone';

interface VisualizerProps {
  analyser: Tone.Waveform | null;
  isPlaying: boolean;
}

export const Visualizer: React.FC<VisualizerProps> = ({ analyser, isPlaying }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !analyser) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      if (!analyser) return;

      // Get waveform data
      // Tone.Waveform returns Float32Array [-1, 1]
      const values = analyser.getValue();
      
      const width = canvas.width;
      const height = canvas.height;

      ctx.clearRect(0, 0, width, height);
      
      // Gradient styling
      const gradient = ctx.createLinearGradient(0, 0, width, 0);
      gradient.addColorStop(0, '#0ea5e9');
      gradient.addColorStop(0.5, '#22d3ee');
      gradient.addColorStop(1, '#818cf8');

      ctx.lineWidth = 2;
      ctx.strokeStyle = gradient;
      ctx.beginPath();

      const sliceWidth = width / values.length;
      let x = 0;

      for (let i = 0; i < values.length; i++) {
        // Map value from [-1, 1] to [height, 0]
        // 0 is center (height/2)
        const v = (values[i] as number); 
        const y = (1 - v) * (height / 2); 

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }

        x += sliceWidth;
      }

      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.stroke();

      if (isPlaying) {
        animationRef.current = requestAnimationFrame(draw);
      }
    };

    draw();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [analyser, isPlaying]);

  return (
    <div className="w-full h-32 bg-slate-900/50 rounded-lg border border-slate-700 overflow-hidden backdrop-blur-sm shadow-inner">
      <canvas 
        ref={canvasRef} 
        width={800} 
        height={128} 
        className="w-full h-full"
      />
    </div>
  );
};