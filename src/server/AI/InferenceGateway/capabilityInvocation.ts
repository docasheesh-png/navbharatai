/** Server-derived operation payloads. None of these descriptive shapes grants dispatch authority. */
import type { GatewayTextPayload } from './textTransport';
import type { VisionFormat } from './types';
export interface GatewayEmbeddingPayload { readonly kind: 'embedding'; readonly text: string; }
export interface GatewayGroundingPayload { readonly kind: 'grounding-search'; readonly query: string; readonly maxResults: number; readonly domains?: readonly string[]; }
export interface GatewayVisionPayload {
  readonly kind: 'vision-pdf'; readonly prompt: string; readonly systemPrompt?: string;
  readonly attachments: readonly { readonly mimeType: VisionFormat; readonly data: string }[];
  readonly streaming: boolean;
}
export type GatewayInvocationPayload = (GatewayTextPayload & { readonly kind?: 'text' })
  | GatewayEmbeddingPayload | GatewayGroundingPayload | GatewayVisionPayload;
export type GatewayOperationPolicy =
  | { readonly kind: 'embedding'; readonly maxInputBytes: number; readonly dimensions: 768; readonly vectorSpaceId: string }
  | { readonly kind: 'grounding-search'; readonly maxQueryBytes: number; readonly maxResults: number }
  | { readonly kind: 'vision-pdf'; readonly maxImages: number; readonly maxPdfPages: 0 | 1000;
      readonly formats: readonly VisionFormat[]; readonly maxAttachmentBytes: number };
