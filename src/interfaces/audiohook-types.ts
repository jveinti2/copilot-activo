// Tipos esenciales para la funcionalidad de la aplicación
export interface ServerWebSocket {
  on(event: string, listener: Function): this;
  send(data: string | Uint8Array): void;
  close(): void;
}

export interface JsonObject {
  [key: string]: any;
}

export interface MediaParameter {
  coding: string;
  rate: number;
  channels: number;
}

export interface Duration {
  hours: number;
  minutes: number;
  seconds: number;
  milliseconds: number;
}

export interface StreamDuration {
  withAdded(other: StreamDuration): StreamDuration;
  withAddedDuration(duration: Duration): StreamDuration;
  asDuration(): Duration;
}

export namespace StreamDuration {
  export const zero: StreamDuration = {
    withAdded: () => zero,
    withAddedDuration: () => zero,
    asDuration: () => ({ hours: 0, minutes: 0, seconds: 0, milliseconds: 0 }),
  };

  export function fromSamples(samples: number, rate: number): StreamDuration {
    return zero; // Implementación simplificada
  }

  export function fromMilliseconds(ms: number): StreamDuration {
    return zero; // Implementación simplificada
  }
}

export type OpenHandler = (params: {
  session: any;
  selectedMedia: MediaParameter | null;
}) => Function;
export type OnAudioHandler = (frame: any) => void;
export type OnDiscardedHandler = (param: any) => void;
export type OnResumedHandler = (param: any) => void;
