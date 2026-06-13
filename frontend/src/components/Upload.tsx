import { useCallback, useRef, useState } from 'react';
import { getJob, uploadVideo, type JobStatus } from '../api';
import './Upload.css';

interface UploadProps {
  onReady: (trackId: string) => void;
}

const STAGE_LABELS: Record<string, string> = {
  extracting: 'Extracting audio',
  separating: 'Separating stems (this is the slow part)',
  mixing: 'Mixing stems',
  encoding: 'Encoding audio',
  analysing: 'Analysing intensity',
};

export function Upload({ onReady }: UploadProps) {
  const [dragging, setDragging] = useState(false);
  const [job, setJob] = useState<JobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const poll = useCallback(
    (jobId: string) => {
      const tick = async () => {
        try {
          const status = await getJob(jobId);
          setJob(status);
          if (status.state === 'done' && status.track_id) {
            onReady(status.track_id);
            return;
          }
          if (status.state === 'error') {
            setError(status.error ?? 'Processing failed');
            return;
          }
          setTimeout(tick, 1000);
        } catch (e) {
          setError(String(e));
        }
      };
      tick();
    },
    [onReady]
  );

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      setJob({ id: '', state: 'queued', stage: '', progress: 0, track_id: null, error: null });
      try {
        const jobId = await uploadVideo(file);
        poll(jobId);
      } catch (e) {
        setError(String(e));
        setJob(null);
      }
    },
    [poll]
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  if (job) {
    const pct = Math.round(job.progress * 100);
    const label =
      job.state === 'queued'
        ? 'Queued…'
        : STAGE_LABELS[job.stage] ?? 'Processing…';
    return (
      <div className="upload processing">
        <h2>Processing your video</h2>
        <div className="bar">
          <div className="fill" style={{ width: `${pct}%` }} />
        </div>
        <p className="stage">
          {label} · {pct}%
        </p>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="upload">
      <div
        className={`dropzone ${dragging ? 'over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
      >
        <p className="big">Drop a dance video here</p>
        <p className="small">or click to choose · mp4 / mov / webm · up to 200 MB</p>
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
