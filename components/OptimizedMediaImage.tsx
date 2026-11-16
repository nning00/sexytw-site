"use client";

import Image, { type ImageProps } from "next/image";
import { isResumeMediaPublicRoute } from "@/lib/resume-media-url.mjs";
import { isSupabaseMedia, supabaseImageLoader } from "@/lib/media-image";

type OptimizedMediaImageProps = Omit<ImageProps, "loader" | "src"> & {
  src: string;
};

export default function OptimizedMediaImage({ src, alt, ...props }: OptimizedMediaImageProps) {
  return <Image {...props} src={src} alt={alt} unoptimized={props.unoptimized || isResumeMediaPublicRoute(src)} loader={isSupabaseMedia(src) ? supabaseImageLoader : undefined} />;
}
