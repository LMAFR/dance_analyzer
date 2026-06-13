// Backend API client (proxied through Vite to http://localhost:8000).

export interface JobStatus {
  id: string;
  state: 'queued' | 'processing' | 'done' | 'error';
  stage: string;
  progress: number;
  track_id: string | null;
  error: string | null;
}

export interface Manifest {
  id: string;
  duration: number;
  video: string;
  stems: { id: string; url: string }[];
  envelopes: string;
}

export interface EnvelopeDoc {
  duration: number;
  fps: number;
  stems: Record<string, number[]>;
}

export async function uploadVideo(file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/uploads', { method: 'POST', body: form });
  if (!res.ok) throw new Error((await res.json()).detail ?? 'Upload failed');
  return (await res.json()).job_id;
}

export async function getJob(jobId: string): Promise<JobStatus> {
  const res = await fetch(`/api/jobs/${jobId}`);
  if (!res.ok) throw new Error('Job not found');
  return res.json();
}

export async function getManifest(trackId: string): Promise<Manifest> {
  const res = await fetch(`/api/tracks/${trackId}`);
  if (!res.ok) throw new Error('Track not found');
  return res.json();
}

export async function getEnvelopes(
  trackId: string,
  filename: string
): Promise<EnvelopeDoc> {
  const res = await fetch(`/api/tracks/${trackId}/${filename}`);
  if (!res.ok) throw new Error('Envelopes not found');
  return res.json();
}

export const trackFileUrl = (trackId: string, filename: string) =>
  `/api/tracks/${trackId}/${filename}`;
