'use client';

// §4 QR: @zxing/browser camera scanner, falling back to the native BarcodeDetector API when
// zxing can't start, with manual entry ALWAYS available beside it — never hidden behind an
// error state. This is the primitive; app/(app)/_components/ProductUI.tsx's ScanInputRow
// composes it into the actual form control (scan button + manual-entry input + this modal).
import { useEffect, useRef, useState } from 'react';
import { setStreamTorch, streamHasTorch, torchTrack, type TorchMediaTrackConstraintSet } from './torch';

type BarcodeDetectorConstructor = {
  new (options?: { formats?: string[] }): {
    detect(source: CanvasImageSource): Promise<Array<{ rawValue?: string }>>;
  };
  getSupportedFormats?: () => Promise<string[]>;
};

export type ScannerControls = {
  stop: () => void;
  switchTorch?: (onOff: boolean) => Promise<void>;
};

type ZxingBrowserModule = {
  BrowserMultiFormatReader: new (
    hints?: unknown,
    options?: { delayBetweenScanAttempts?: number; delayBetweenScanSuccess?: number; tryPlayVideoTimeout?: number },
  ) => {
    decodeFromConstraints: (
      constraints: MediaStreamConstraints,
      previewElem: HTMLVideoElement,
      callback: (result: { getText: () => string } | undefined, error: Error | undefined, controls: ScannerControls) => void,
    ) => Promise<ScannerControls>;
  };
};

function cameraConstraints(): MediaStreamConstraints {
  return {
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 15, max: 24 },
    },
    audio: false,
  };
}

function isExpectedScanMiss(error: Error): boolean {
  return ['NotFoundException', 'ChecksumException', 'FormatException'].includes(error.name);
}

function cameraAccessErrorMessage(error: unknown): string {
  const name = error instanceof DOMException || error instanceof Error ? error.name : 'CameraError';

  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'Camera permission is blocked for this browser/site. Allow camera access, then tap Scan again.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No camera was found on this device. Use manual entry.';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'The camera is already in use or Windows blocked access. Close other camera apps and try again.';
  }
  if (name === 'SecurityError') {
    return 'The browser blocked camera access for this page. Open the app from localhost/127.0.0.1 or enable camera permission.';
  }
  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
    return 'The requested rear camera is not available. Use manual entry or try another camera-enabled device.';
  }

  return `Camera could not start (${name}). Use manual entry.`;
}

export function CameraScanner({
  open,
  label,
  onCancel,
  onDetected,
}: {
  open: boolean;
  label: string;
  onCancel: () => void;
  onDetected: (value: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onDetectedRef = useRef(onDetected);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);
  const scannerControlsRef = useRef<ScannerControls | null>(null);
  const lastFrameErrorAtRef = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [decoderAvailable, setDecoderAvailable] = useState(true);
  const [manualValue, setManualValue] = useState('');
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [torchPending, setTorchPending] = useState(false);

  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    async function startScanner() {
      setError(null);
      setDecoderAvailable(true);
      setTorchAvailable(false);
      setTorchOn(false);

      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Camera access is not available in this browser. Use manual entry.');
        return;
      }

      if (!videoRef.current) return;

      try {
        const zxing = (await import('@zxing/browser')) as ZxingBrowserModule;
        const reader = new zxing.BrowserMultiFormatReader(undefined, {
          delayBetweenScanAttempts: 180,
          delayBetweenScanSuccess: 500,
          tryPlayVideoTimeout: 5000,
        });
        const controls = await reader.decodeFromConstraints(cameraConstraints(), videoRef.current, (result, scanError, controls) => {
          const rawValue = result?.getText();
          if (rawValue) {
            controls.stop();
            onDetectedRef.current(rawValue);
            return;
          }

          if (scanError && !isExpectedScanMiss(scanError)) {
            const now = Date.now();
            if (now - lastFrameErrorAtRef.current > 3000) {
              lastFrameErrorAtRef.current = now;
              setError('Scanner is active, but the code is hard to read. Hold it inside the frame or use manual entry.');
            }
          }
        });

        if (cancelled) {
          controls.stop();
          return;
        }

        scannerControlsRef.current = controls;
        syncTorchAvailability(controls);
        window.setTimeout(() => {
          if (!cancelled) syncTorchAvailability(controls);
        }, 250);
        return;
      } catch (zxingError) {
        if (cancelled) return;

        const accessMessage = cameraAccessErrorMessage(zxingError);
        if (!accessMessage.includes('Camera could not start')) {
          setError(accessMessage);
          return;
        }
      }

      const Detector = (window as Window & { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
      if (!Detector) {
        setDecoderAvailable(false);
        setError('Scanner decoder could not load in this browser session. Use manual entry.');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia(cameraConstraints());
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        setTorchAvailable(streamHasTorch(stream));
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        const supportedFormats = Detector.getSupportedFormats ? await Detector.getSupportedFormats() : [];
        const preferredFormats = ['qr_code', 'code_128', 'code_39', 'data_matrix', 'ean_13', 'ean_8', 'upc_a', 'upc_e'];
        const formats = supportedFormats.length
          ? preferredFormats.filter((format) => supportedFormats.includes(format))
          : preferredFormats;
        const detector = new Detector(formats.length ? { formats } : undefined);

        async function scanFrame() {
          if (cancelled || !videoRef.current) return;
          if (videoRef.current.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            try {
              const codes = await detector.detect(videoRef.current);
              const rawValue = codes.find((code) => code.rawValue)?.rawValue;
              if (rawValue) {
                onDetectedRef.current(rawValue);
                return;
              }
            } catch {
              const now = Date.now();
              if (now - lastFrameErrorAtRef.current > 3000) {
                lastFrameErrorAtRef.current = now;
                setError('Scanner is having trouble reading the code. Hold it inside the frame or use manual entry.');
              }
            }
          }
          frameRef.current = window.requestAnimationFrame(scanFrame);
        }

        frameRef.current = window.requestAnimationFrame(scanFrame);
      } catch (error) {
        setError(cameraAccessErrorMessage(error));
      }
    }

    void startScanner();

    return () => {
      cancelled = true;
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      scannerControlsRef.current?.stop();
      scannerControlsRef.current = null;
      setTorchAvailable(false);
      setTorchOn(false);
      setTorchPending(false);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [open]);

  if (!open) return null;

  function syncTorchAvailability(controls: ScannerControls) {
    const stream = videoRef.current?.srcObject instanceof MediaStream ? videoRef.current.srcObject : null;
    setTorchAvailable(Boolean(controls.switchTorch) || streamHasTorch(stream));
  }

  async function toggleTorch() {
    const nextTorchState = !torchOn;
    setTorchPending(true);

    try {
      const controls = scannerControlsRef.current;
      if (controls?.switchTorch) {
        await controls.switchTorch(nextTorchState);
      } else {
        const stream = videoRef.current?.srcObject instanceof MediaStream ? videoRef.current.srcObject : streamRef.current;
        await setStreamTorch(stream, nextTorchState);
      }

      setTorchOn(nextTorchState);
    } catch {
      setTorchAvailable(false);
      setTorchOn(false);
      setError('Torch is not available from this browser/camera. Use device light or move to brighter light.');
    } finally {
      setTorchPending(false);
    }
  }

  return (
    <div className="scanner-modal" role="dialog" aria-modal="true" aria-label={`Scan ${label}`}>
      <div className="scanner-modal__backdrop" onClick={onCancel} />
      <div className="scanner-modal__panel">
        <header>
          <strong>Scan {label}</strong>
          <div className="scanner-modal__actions">
            {torchAvailable && (
              <button
                type="button"
                className="btn btn--secondary btn--compact"
                aria-pressed={torchOn}
                disabled={torchPending}
                onClick={toggleTorch}
              >
                {torchOn ? 'Torch on' : 'Torch'}
              </button>
            )}
            <button type="button" className="btn btn--secondary btn--compact" onClick={onCancel}>
              Close
            </button>
          </div>
        </header>
        <div className="scanner-modal__viewport">
          <video ref={videoRef} muted playsInline autoPlay />
          <span aria-hidden="true" />
        </div>
        {error && <p className="scanner-modal__error">{error}</p>}
        {!decoderAvailable && (
          <div className="scanner-modal__manual">
            <p>Camera scanning is not available in this browser session. Manual entry is still available.</p>
            <label>
              <span>Enter scanned value</span>
              <input value={manualValue} onChange={(event) => setManualValue(event.target.value)} placeholder="Type or paste the lock ID" />
            </label>
            <button
              type="button"
              className="btn btn--primary btn--compact"
              onClick={() => {
                if (manualValue.trim()) onDetected(manualValue);
              }}
            >
              Use value
            </button>
          </div>
        )}
        <p className="scanner-modal__hint">
          {decoderAvailable
            ? 'Point the camera at the QR or barcode and keep it inside the frame.'
            : 'Manual entry stays available when the camera or scanner decoder is blocked.'}
        </p>
      </div>
    </div>
  );
}

// Re-exported so ProductUI's TorchMediaTrackConstraintSet-adjacent code (if any) can import
// everything scanner-related from one place; torch.ts remains the source of truth.
export type { TorchMediaTrackConstraintSet };
