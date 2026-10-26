import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader, IScannerControls } from '@zxing/browser';
import { NotFoundException } from '@zxing/library';

type Props = {
  onScan: (value: string) => void;
};

// Derselbe Code wird von der Kamera oft mehrfach hintereinander erkannt
const REPEAT_BLOCK_MS = 2500;

/**
 * Kompakter Kamera-Scanner (Rückkamera bevorzugt). Läuft nur, solange die Komponente angezeigt wird.
 */
export default function CameraScanner({ onScan }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const onScanRef = useRef(onScan);
  const lastRef = useRef({ value: '', at: 0 });
  const [error, setError] = useState<string | null>(null);

  onScanRef.current = onScan;

  useEffect(() => {
    const reader = new BrowserMultiFormatReader(undefined, { delayBetweenScanAttempts: 50 });
    let controls: IScannerControls | null = null;
    let cancelled = false;

    reader
      .decodeFromConstraints({ video: { facingMode: { ideal: 'environment' } } }, videoRef.current ?? undefined, (result, decodeError) => {
        if (result) {
          const value = result.getText();
          const now = Date.now();
          if (value !== lastRef.current.value || now - lastRef.current.at > REPEAT_BLOCK_MS) {
            lastRef.current = { value, at: now };
            onScanRef.current(value);
          }
        } else if (decodeError && !(decodeError instanceof NotFoundException)) {
          setError(decodeError.message);
        }
      })
      .then((started) => {
        controls = started;
        if (cancelled) {
          started.stop();
        }
      })
      .catch((startError: unknown) => {
        setError(startError instanceof Error ? startError.message : 'Kamera konnte nicht gestartet werden.');
      });

    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, []);

  return (
    <div className="camera-scanner">
      <video ref={videoRef} className="scanner-video" playsInline muted autoPlay />
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
