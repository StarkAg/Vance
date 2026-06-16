import { createWorker, PSM, type Worker } from "tesseract.js";

// A single worker is created lazily and reused across images — re-initialising
// per image (as the old convenience API did) is slow for multi-photo import.
let workerPromise: Promise<Worker> | null = null;
// Progress is reported through the worker's logger, which is set once at
// creation; this holds the current call's callback so per-image progress works.
let onProgressCb: ((p: number) => void) | null = null;

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      // "grw" is our own Groww-font model (fine-tuned LSTM), shipped gzipped at
      // /tessdata/grw.traineddata.gz. OEM 1 = LSTM_ONLY (it has no legacy engine).
      const worker = await createWorker("grw", 1, {
        langPath: "/tessdata",
        logger: (m) => {
          if (m.status === "recognizing text" && onProgressCb) onProgressCb(m.progress);
        },
      });
      // Groww order screenshots are a single uniform column; PSM 6 reads them
      // more reliably than the default auto mode (which mangled small digits).
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
      return worker;
    })();
  }
  return workerPromise;
}

// Run OCR on an image file entirely in the browser. No data leaves the device.
export async function ocrImage(file: File | Blob, onProgress?: (p: number) => void): Promise<string> {
  const worker = await getWorker();
  onProgressCb = onProgress ?? null;
  try {
    const { data } = await worker.recognize(file);
    return data.text;
  } finally {
    onProgressCb = null;
  }
}
