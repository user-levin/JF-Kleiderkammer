import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { BrowserMultiFormatReader, IScannerControls } from '@zxing/browser';
import { NotFoundException } from '@zxing/library';
import { api } from '@api/client';
import { Article, ArticleMovement } from 'types/domain';

const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1280 },
    height: { ideal: 720 }
  },
  audio: false
};

const SCAN_SPEED_OPTIONS = {
  delayBetweenScanAttempts: 5,
  delayBetweenScanSuccess: 0
};

const CAMERA_DUPLICATE_SUPPRESS_MS = 600;

const waitForVideoReady = (video: HTMLVideoElement, timeoutMs = 5000) => {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0 && video.videoHeight > 0) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener('loadeddata', handleReady);
      video.removeEventListener('loadedmetadata', handleReady);
      video.removeEventListener('error', handleError);
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };

    const handleReady = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        cleanup();
        resolve();
      }
    };

    const handleError = () => {
      cleanup();
      reject(new Error('Video stream konnte nicht initialisiert werden.'));
    };

    const timeoutId = timeoutMs
      ? window.setTimeout(() => {
        cleanup();
        reject(new Error('Video-Stream hat keine gültigen Abmessungen geliefert.'));
      }, timeoutMs)
      : undefined;

    video.addEventListener('loadeddata', handleReady);
    video.addEventListener('loadedmetadata', handleReady);
    video.addEventListener('error', handleError);
  });
};

export default function PublicScan() {
  const [manualInput, setManualInput] = useState('');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [activeArticle, setActiveArticle] = useState<Article | null>(null);
  const [lookupMessage, setLookupMessage] = useState<string | null>(null);
  const [showCamera, setShowCamera] = useState(true);
  
  const cameraLastResultRef = useRef<{ value: string; timestamp: number }>({ value: '', timestamp: 0 });
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerControlsRef = useRef<IScannerControls | null>(null);
  const manualInputRef = useRef(manualInput);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);

  if (!readerRef.current) {
    readerRef.current = new BrowserMultiFormatReader(undefined, SCAN_SPEED_OPTIONS);
  }

  useEffect(() => {
    manualInputRef.current = manualInput;
  }, [manualInput]);

  const normalizedInput = useMemo(() => normalizeArticleId(manualInput), [manualInput]);

  const lookupArticle = useCallback((articleId: string) => {
    return api.get<{ data: Article }>(`/api/articles/${articleId}`);
  }, []);

  const handleLookup = useCallback(async (rawValue?: string) => {
    const sourceValue = rawValue ?? manualInputRef.current;
    const normalized = normalizeArticleId(sourceValue);
    if (!normalized) {
      setLookupMessage('Bitte eine gültige Artikelnummer eingeben oder scannen.');
      return;
    }

    setActiveArticle(null);
    setLookupMessage(null);

    try {
      const res = await lookupArticle(normalized);
      setActiveArticle(res.data.data);
      setManualInput(normalized);
      setShowCamera(false);
      setLookupMessage(null);
    } catch (error) {
      setActiveArticle(null);
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        setLookupMessage('Artikel nicht gefunden.');
      } else {
        setLookupMessage(error instanceof Error ? error.message : 'Fehler beim Abrufen des Artikels.');
      }
    }
  }, [lookupArticle]);

  const handleCameraDecode = useCallback((value: string) => {
    if (!value) {
      return;
    }
    const normalized = normalizeArticleId(value);
    if (!normalized) {
      setLookupMessage('Der Code enthält keine Artikelnummer.');
      return;
    }

    const now = Date.now();
    if (cameraLastResultRef.current.value === normalized && now - cameraLastResultRef.current.timestamp < CAMERA_DUPLICATE_SUPPRESS_MS) {
      return;
    }

    cameraLastResultRef.current = { value: normalized, timestamp: now };
    setManualInput(normalized);
    setShowCamera(false);
    handleLookup(normalized);
  }, [handleLookup]);

  useEffect(() => {
    let cancelled = false;
    const reader = readerRef.current;

    if (!reader) {
      return undefined;
    }

    const stopScanner = () => {
      scannerControlsRef.current?.stop();
      scannerControlsRef.current = null;

      const mediaStream = videoRef.current?.srcObject as MediaStream | null;
      if (mediaStream) {
        mediaStream.getTracks().forEach((track) => track.stop());
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };

    const startScanner = async () => {
      if (cancelled || document.visibilityState !== 'visible') {
        return;
      }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraError('Dieses Gerät stellt keine Kamera zur Verfügung.');
        return;
      }

      if (scannerControlsRef.current) {
        return;
      }

      const videoElement = videoRef.current;
      if (!videoElement) {
        requestAnimationFrame(() => {
          if (!cancelled) {
            startScanner();
          }
        });
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
        videoElement.srcObject = stream;

        try {
          await videoElement.play();
        } catch {
          // Autoplay kann auf mobilen Geräten blockieren
        }

        await waitForVideoReady(videoElement);

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        const controls = await reader.decodeFromStream(
          stream,
          videoElement,
          (result, error) => {
            if (result) {
              handleCameraDecode(result.getText());
              setCameraError(null);
            } else if (error && !(error instanceof NotFoundException)) {
              setCameraError(error.message ?? 'Kamera konnte nicht verwendet werden.');
            }
          }
        );

        if (cancelled) {
          controls.stop();
          return;
        }

        scannerControlsRef.current = controls;
      } catch (error) {
        setCameraError(error instanceof Error ? error.message : 'Kamera konnte nicht verwendet werden.');
      }
    };

    startScanner();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        startScanner();
      } else {
        stopScanner();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      stopScanner();
    };
  }, [handleCameraDecode]);

  const handleManualSubmit = (event: FormEvent) => {
    event.preventDefault();
    setShowCamera(false);
    handleLookup();
  };

  return (
    <div className="public-scan-layout">
      <section className="card">
        <div className="card-header">
          <div>
            <h2>Artikel Informationen</h2>
            <p className="muted">Barcode scannen oder Nummer eingeben</p>
          </div>
        </div>

        <div className="camera-scanner">
          {showCamera && <video ref={videoRef} className="scanner-video" playsInline muted autoPlay />}
          {!showCamera && <p className="info-text">Kamera nach Scan ausgeblendet. Nutze "Scanner zurücksetzen" zum Neuscan.</p>}
        </div>
        {cameraError ? (
          <p className="error-text">{cameraError}</p>
        ) : (
          <p className="muted">Barcode kurz vor die Kamera halten – Treffer werden automatisch gesucht.</p>
        )}

        <form onSubmit={handleManualSubmit} className="scan-form">
          <div className="input-inline-wrapper">
            <input
              placeholder="Artikelnummer eingeben"
              value={manualInput}
              onChange={(event) => setManualInput(event.target.value)}
              inputMode="numeric"
              maxLength={30}
            />
            <span className="input-inline-value" aria-hidden="true">{normalizedInput || '---'}</span>
          </div>
          <button type="submit">Suchen</button>
        </form>

        {lookupMessage && <p className="info-text">{lookupMessage}</p>}

        {!showCamera && (
          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              setShowCamera(true);
              setActiveArticle(null);
              setManualInput('');
              setLookupMessage(null);
            }}
          >
            Scanner zurücksetzen
          </button>
        )}
      </section>

      {activeArticle && (
        <ArticleDetailCard article={activeArticle} />
      )}
    </div>
  );
}

function ArticleDetailCard({ article }: { article: Article }) {
  const dateFormatter = new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' });

  return (
    <section className="card article-detail-public">
      <div className="public-article-header">
        <h2 className="public-article-title">
          {article.location.type === 'kind' ? article.location.name : 'Im Lager'}
        </h2>
        <p className="public-article-id">Artikel #{article.id}</p>
      </div>

      <div className="public-article-info">
        <div className="info-row">
          <span className="info-label">Kategorie</span>
          <span className="info-value">{article.category}</span>
        </div>
        <div className="info-row">
          <span className="info-label">Größe</span>
          <span className="info-value">{article.size ?? 'One Size'}</span>
        </div>
        <div className="info-row">
          <span className="info-label">Status</span>
          <span className={`info-value status-${article.status}`}>
            {article.status === 'ausgegeben' ? 'Ausgegeben' : article.status === 'frei' ? 'Frei' : 'Warnung'}
          </span>
        </div>
      </div>

      {article.movementHistory && article.movementHistory.length > 0 && (
        <div className="public-movement-history">
          <h3>Verlauf</h3>
          <ul className="movement-list">
            {article.movementHistory.slice(0, 10).map((movement, idx) => (
              <li key={idx} className="movement-item">
                <span className="movement-action">{movement.action}</span>
                <span className="movement-location">
                  {movement.to?.type === 'kind' ? `→ ${movement.to.name}` : '→ Lager'}
                </span>
                <span className="movement-time">{dateFormatter.format(new Date(movement.performedAt))}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {article.notes && (
        <div className="public-notes">
          <p className="muted">Notizen: {article.notes}</p>
        </div>
      )}
    </section>
  );
}

function normalizeArticleId(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (!digits) {
    return '';
  }
  const trimmed = digits.slice(-9);
  return trimmed.padStart(9, '0');
}
