"use client";
import { Player } from "@profullstack/player/react";
import "@profullstack/player/player.css";

/**
 * The house player (@profullstack/player): one control bar that hides itself,
 * full screen on every device including iPhone, MP4/HLS/MPEG-TS/audio sniffed
 * from the URL. Server components render this instead of a raw <video>/<audio>.
 */
export default function VideoPlayer({
  src,
  poster,
  audio,
  className,
}: {
  src: string;
  poster?: string | null;
  audio?: boolean;
  className?: string;
}) {
  return (
    <Player
      src={src}
      poster={poster || undefined}
      audio={audio}
      className={className}
      shareable={false}
      useTimeParam={false}
    />
  );
}
