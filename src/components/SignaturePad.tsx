import React, { useRef, useState, useEffect } from "react";
import { Trash2, Type, Paintbrush } from "lucide-react";

interface SignaturePadProps {
  onSignatureChange: (signatureBase64: string | null) => void;
  workerName: string;
}

export function SignaturePad({ onSignatureChange, workerName }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [mode, setMode] = useState<"draw" | "type">("draw");
  const [typedText, setTypedText] = useState("");
  const [hasDrawn, setHasDrawn] = useState(false);

  // Initialize canvas context & set size
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas dimensions (logical resolution)
    canvas.width = 400;
    canvas.height = 200;

    // Line styles for smooth, realistic ink
    ctx.strokeStyle = "#1e3a8a"; // Navy blue ink
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Prevent default touch behavior on mobile to avoid scrolling while drawing
    const preventDefault = (e: TouchEvent) => {
      if (e.target === canvas) {
        e.preventDefault();
      }
    };

    document.body.addEventListener("touchstart", preventDefault, { passive: false });
    document.body.addEventListener("touchmove", preventDefault, { passive: false });
    document.body.addEventListener("touchend", preventDefault, { passive: false });

    return () => {
      document.body.removeEventListener("touchstart", preventDefault);
      document.body.removeEventListener("touchmove", preventDefault);
      document.body.removeEventListener("touchend", preventDefault);
    };
  }, []);

  // Update canvas if mode changes or typedText changes
  useEffect(() => {
    if (mode === "type") {
      drawTextToCanvas();
    } else {
      clearCanvas();
    }
  }, [mode, typedText]);

  const getCoordinates = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    
    // Scale coordinates based on canvas physical vs logical dimensions
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    if ("touches" in e) {
      if (e.touches.length === 0) return { x: 0, y: 0 };
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      };
    } else {
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
      };
    }
  };

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (mode !== "draw") return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    setIsDrawing(true);
    setHasDrawn(true);

    const coords = getCoordinates(e);
    ctx.beginPath();
    ctx.moveTo(coords.x, coords.y);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing || mode !== "draw") return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const coords = getCoordinates(e);
    ctx.lineTo(coords.x, coords.y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    
    // Notify parent with current canvas base64 image data
    const canvas = canvasRef.current;
    if (canvas && hasDrawn) {
      onSignatureChange(canvas.toDataURL("image/png"));
    }
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
    onSignatureChange(null);
  };

  const drawTextToCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Render beautiful cursive name signature
    const textToDraw = typedText.trim() || workerName;
    
    ctx.fillStyle = "#1e3a8a"; // Navy blue ink
    ctx.font = "italic 32px 'Dancing Script', 'Brush Script MT', cursive, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.fillText(textToDraw, canvas.width / 2, canvas.height / 2);

    // Draw an artistic accent swipe line underneath the signature
    ctx.strokeStyle = "rgba(30, 58, 138, 0.4)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(canvas.width * 0.15, canvas.height * 0.72);
    ctx.quadraticCurveTo(
      canvas.width * 0.45,
      canvas.height * 0.85,
      canvas.width * 0.85,
      canvas.height * 0.74
    );
    ctx.stroke();

    onSignatureChange(canvas.toDataURL("image/png"));
  };

  return (
    <div className="bg-slate-900 border border-slate-700/80 rounded-xl overflow-hidden shadow-inner">
      {/* Mode Tabs */}
      <div className="flex border-b border-slate-800 bg-slate-950/60 p-1 gap-1">
        <button
          type="button"
          onClick={() => setMode("draw")}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-bold rounded-lg transition-all ${
            mode === "draw"
              ? "bg-indigo-600 text-white shadow-sm"
              : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
          }`}
        >
          <Paintbrush className="w-3.5 h-3.5" />
          <span>Gambar Paraf</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("type");
            if (!typedText) setTypedText(workerName);
          }}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-bold rounded-lg transition-all ${
            mode === "type"
              ? "bg-indigo-600 text-white shadow-sm"
              : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
          }`}
        >
          <Type className="w-3.5 h-3.5" />
          <span>Ketik Paraf</span>
        </button>
      </div>

      {/* Signature Area */}
      <div className="relative p-2 bg-slate-950/40">
        <canvas
          ref={canvasRef}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
          className="w-full h-[200px] bg-white rounded-lg border border-slate-800 cursor-crosshair touch-none"
        />

        {/* Clear Button (only shown/active in draw mode or if text entered) */}
        {mode === "draw" && (
          <button
            type="button"
            onClick={clearCanvas}
            disabled={!hasDrawn}
            className="absolute bottom-4 right-4 bg-rose-600 hover:bg-rose-500 disabled:opacity-30 disabled:hover:bg-rose-600 text-white p-1.5 rounded-lg transition-all shadow-md cursor-pointer"
            title="Hapus Paraf"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Type Input Box if Typing Mode */}
      {mode === "type" && (
        <div className="p-3 border-t border-slate-800 bg-slate-950/80 space-y-2">
          <label className="text-[10px] text-slate-400 block font-medium">
            Ketik nama atau inisial Anda untuk membuat paraf digital otomatis:
          </label>
          <input
            type="text"
            value={typedText}
            onChange={(e) => setTypedText(e.target.value)}
            placeholder="Ketik disini..."
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      )}

      {/* Signature Tip / Disclaimer */}
      <div className="bg-slate-950/80 px-3 py-1.5 border-t border-slate-800 flex justify-between items-center text-[10px] text-slate-400">
        <span>Tinta Biru Resmi Mandiri</span>
        <span>
          {mode === "draw"
            ? "Gunakan jari atau stylus pada kotak putih"
            : "Font Cursive Klasik"}
        </span>
      </div>
    </div>
  );
}
