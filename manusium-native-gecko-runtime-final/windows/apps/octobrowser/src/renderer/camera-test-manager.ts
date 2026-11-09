/** Own only Octo's short host-camera tests, never Windows devices or other apps. */
export interface StoppableStream { getTracks(): Array<{ stop(): void }> }
export class CameraTestManager {
  enabled = false;
  generation = 0;
  private leases = new Set<() => void>();
  private listeners = new Set<() => void>();
  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    this.generation++;
    if (!enabled) for (const close of [...this.leases]) close();
    for (const listener of this.listeners) listener();
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  begin(): { signal: AbortSignal; track(stream: StoppableStream): void; close(): void } | null {
    if (!this.enabled) return null;
    const abort = new AbortController();
    const streams = new Set<StoppableStream>();
    const close = () => {
      if (abort.signal.aborted) return;
      for (const stream of streams) stream.getTracks().forEach(track => track.stop());
      streams.clear();
      this.leases.delete(close);
      abort.abort();
    };
    this.leases.add(close);
    return { signal: abort.signal, close, track: stream => {
      // A driver may answer getUserMedia after the manager was disabled.
      if (abort.signal.aborted) stream.getTracks().forEach(track => track.stop());
      else streams.add(stream);
    } };
  }
}
